/**
 * WYSIWYG HTML/PDF export.
 *
 * Instead of dumping the raw Markdown, the exported document re-renders the
 * *current view* — board columns or the list table, with the same filters,
 * title-task switch and expanded/collapsed state — so the file looks like what
 * the user is looking at. The Gantt view is exported as the list layout.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  DEFAULT_CREATED_COLOR,
  DEFAULT_IMP_HIGH_COLOR,
  DEFAULT_IMP_LOW_COLOR,
  DEFAULT_IMP_MID_COLOR,
  DEFAULT_P0_COLOR,
  DEFAULT_P1_COLOR,
  DEFAULT_P2_COLOR,
  DEFAULT_TITLE_COLOR,
  collectCodes,
  collectStats,
  dueBadge,
  importanceTone,
  isTitleTask,
  isVersionTask,
  priorityMeta,
  normalizeProjectPageOrder,
  PROJECT_PAGE_LABELS,
  projectStatusColor,
  showsCreated,
  splitOwners,
  buildTaskRefIndex,
  lookupTaskRef,
  type AppearanceSettings,
  type ProgressEntry,
  type ProjectDetail,
  type ProjectStatusDef,
  type TaskNode,
  type TaskRefIndex,
} from '@wbs/shared';
import {
  DEFAULT_FILTERS,
  DUE_LABELS,
  STATUS_LABELS,
  TASK_TYPE_LABELS,
  buildBoard,
  filterByTypes,
  filterTree,
  groupBySection,
  type Filters,
  type TaskTypeFilter,
} from './filters';
import { taskRefStaticHtml } from './taskRef';
import { hoistTableEmbeds } from './embed';
import { DEFAULT_LIST_COLUMNS, type ListColumns } from './columns';

export type ExportView = 'board' | 'list' | 'gantt';

export interface ExportDocInput {
  project: ProjectDetail;
  view: ExportView;
  filters: Filters;
  boardTypes: TaskTypeFilter;
  collapsed: Record<string, boolean>;
  appearance: AppearanceSettings;
  /** Configurable project statuses, used for the header chip colour. */
  statuses?: ProjectStatusDef[];
  /** Optional columns shown by the list view; defaults to all. */
  listColumns?: ListColumns;
}

export interface ExportDoc {
  /** Filename without extension. */
  name: string;
  html: string;
  layout: 'board' | 'list';
}

const DUE_SOON = '#b54708';
const DUE_DANGER = '#b42318';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `#rrggbb` + alpha → `rgba(...)` so tinted pills print as real colours. */
function alpha(hex: string, opacity: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return hex;
  const num = parseInt(match[1], 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'wbs';
}

const CALENDAR_ICON =
  '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M4.5 1.5v1H3a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 3 13.5h10a1.5 1.5 0 0 0 1.5-1.5V4A1.5 1.5 0 0 0 13 2.5h-1.5v-1h-1.2v1h-5v-1H4.5Zm8.3 4v6.5a.3.3 0 0 1-.3.3H3.5a.3.3 0 0 1-.3-.3V5.5h9.6Z"/></svg>';

function progressTime(entry: ProgressEntry): string {
  return `${entry.date} ${entry.time ?? ''}`.trim();
}

function progressPlainText(entry: ProgressEntry): string {
  return entry.text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function latestProgress(node: TaskNode): ProgressEntry | null {
  if (!node.progress.length) return null;
  return [...node.progress].sort((a, b) =>
    progressTime(b).localeCompare(progressTime(a)),
  )[0];
}

/** Meta chips shared by the board card and the list cells. */
function priorityPill(priority?: string): string {
  if (!priority) return '';
  const meta = priorityMeta(priority);
  return `<span class="pill ${meta.tone}">${esc(priority)}</span>`;
}

function dueChip(due: string | undefined, done: boolean): string {
  if (!due) return '';
  if (done) {
    return `<span class="due done"><b>${esc(due)}</b><i>·</i>已完成</span>`;
  }
  const badge = dueBadge(due);
  if (!badge) return '';
  return `<span class="due ${badge.tone}"><b>${esc(due)}</b><i>·</i>${esc(badge.label)}</span>`;
}

function createdChip(created?: string): string {
  if (!created || !/^\d{4}-\d{2}-\d{2}$/.test(created)) return '';
  return `<span class="created">${CALENDAR_ICON}${esc(created.slice(5))}</span>`;
}

function ownerChip(name?: string): string {
  const owners = splitOwners(name);
  if (owners.length === 0) return '<span class="muted">—</span>';
  return `<span class="owner">${esc(owners.join('、'))}</span>`;
}

function importanceChip(value?: string): string {
  if (!value) return '';
  // 与页面一致：只用颜色区分等级，不再画五角星。
  return `<span class="imp imp-${importanceTone(value)}">${esc(value)}</span>`;
}

function progressLine(node: TaskNode): string {
  if (node.done) return '';
  // 标题卡片只作分组标识，和页面内一致，不展示最新进展。
  if (isTitleTask(node.fields)) return '';
  const latest = latestProgress(node);
  if (!latest) return '';
  const count = node.progress.length > 1 ? `<em>共 ${node.progress.length} 条</em>` : '';
  return `<div class="prog"><span class="prog-label">最新进展</span><span class="prog-date">${esc(
    latest.date.slice(5),
  )}</span><span class="prog-text">${esc(progressPlainText(latest))}</span>${count}</div>`;
}

function checkBox(done: boolean): string {
  return `<span class="check${done ? ' on' : ''}"></span>`;
}

/* -------------------------------------------------------------------------- */
/* Board layout                                                               */
/* -------------------------------------------------------------------------- */

function renderBoardCard(
  node: TaskNode,
  codes: Map<string, string>,
  collapsed: Record<string, boolean>,
): string {
  const title = isTitleTask(node.fields);
  const classes = ['card'];
  if (title) classes.push('is-title');
  if (isVersionTask(node.fields)) classes.push('is-version-task');
  if (node.done) classes.push('is-done');

  // 优先级 / 重要性跟在编号后面，和页面一处；其余元信息仍占单独一行。
  const badges = [priorityPill(node.fields.priority), importanceChip(node.fields.importance)]
    .filter(Boolean)
    .join('');

  const metaBits = [
    node.fields.cycle ? `<span class="cycle">${esc(node.fields.cycle)}</span>` : '',
    dueChip(node.fields.due, node.done),
    // A card has no empty slots, so an absent owner is simply left out.
    node.fields.owner ? ownerChip(node.fields.owner) : '',
  ]
    .filter(Boolean)
    .join('');

  const expanded = !collapsed[node.id];
  const children =
    node.children.length && expanded
      ? `<div class="children">${node.children
          .map((child) => renderBoardCard(child, codes, collapsed))
          .join('')}</div>`
      : '';

  return `<div class="node"><div class="${classes.join(' ')}">
  <div class="card-line">${checkBox(node.done)}<span class="code">${esc(
    codes.get(node.id) ?? '',
  )}</span>${createdChip(node.fields.created)}${
    badges ? `<span class="badges">${badges}</span>` : ''
  }<span class="title">${esc(node.title)}</span></div>
  ${metaBits ? `<div class="meta">${metaBits}</div>` : ''}
  ${progressLine(node)}
</div>${children}</div>`;
}

function renderBoard(
  project: ProjectDetail,
  input: ExportDocInput,
  codes: Map<string, string>,
): string {
  const groups = buildBoard(project.roots, input.filters, {
    types: input.boardTypes,
  });

  if (groups.length === 0) {
    return '<p class="empty">当前条件下没有任务。</p>';
  }

  const columns = groups
    .map((group) => {
      const meta = priorityMeta(group.priority);
      const stats = collectStats(group.tasks);
      return `<section class="col">
  <div class="col-head"><span class="dot ${meta.tone}"></span><span class="col-title tone-${meta.tone}">${esc(
    meta.label,
  )}</span><span class="col-hint">共 ${stats.total} 项 · 未完成 ${stats.open}</span></div>
  <div class="cards">${group.tasks
    .map((task) => renderBoardCard(task, codes, input.collapsed))
    .join('')}</div>
</section>`;
    })
    .join('');

  return `<div class="board">${columns}</div>`;
}

/* -------------------------------------------------------------------------- */
/* List layout                                                                */
/* -------------------------------------------------------------------------- */

function renderListRow(
  node: TaskNode,
  codes: Map<string, string>,
  collapsed: Record<string, boolean>,
  cols: ListColumns,
): string {
  const level = Math.max(0, Math.floor(node.indent / 2));
  const isTitle = isTitleTask(node.fields);
  const classes: string[] = [];
  if (isTitle) classes.push('is-title');
  if (isVersionTask(node.fields)) classes.push('is-version-task');
  if (node.done) classes.push('is-done');

  // 标题行与普通行共用同一缩进规则，次级标题才不会顶到父级左侧。
  const pad = 8 + level * 15;
  const code = `<span class="code">${esc(codes.get(node.id) ?? '')}</span>`;
  const created = createdChip(node.fields.created);
  const title = `<span class="tt">${esc(node.title)}</span>`;
  // Every row keeps the same left-aligned order (code → created → title), so
  // heading rows sit on the same rail as the tasks below them.
  const taskCell = `<td class="c-task" style="padding-left:${pad}px">${code}${created}${title}</td>`;

  const cells = [taskCell];
  if (cols.owner) {
    cells.push(`<td class="c-owner">${ownerChip(node.fields.owner)}</td>`);
  }
  if (cols.priority) {
    cells.push(
      `<td class="c-prio">${node.fields.priority ? priorityPill(node.fields.priority) : '<span class="muted">—</span>'}</td>`,
    );
  }
  if (cols.importance) {
    cells.push(
      `<td class="c-imp">${node.fields.importance ? importanceChip(node.fields.importance) : '<span class="muted">—</span>'}</td>`,
    );
  }
  if (cols.due) {
    cells.push(
      `<td class="c-due">${node.fields.due ? dueChip(node.fields.due, node.done) : '<span class="muted">—</span>'}</td>`,
    );
  }
  if (cols.cycle) {
    cells.push(
      `<td class="c-cycle">${node.fields.cycle ? `<span class="cycle">${esc(node.fields.cycle)}</span>` : '<span class="muted">—</span>'}</td>`,
    );
  }
  if (cols.status) {
    cells.push(
      `<td class="c-status">${
        node.done
          ? '<span class="status done">已完成</span>'
          : '<span class="status open">进行中</span>'
      }</td>`,
    );
  }

  const row = `<tr${classes.length ? ` class="${classes.join(' ')}"` : ''}>${cells.join('')}</tr>`;

  if (!node.children.length || collapsed[node.id]) return row;
  return (
    row +
    node.children
      .map((child) => renderListRow(child, codes, collapsed, cols))
      .join('')
  );
}

function renderList(project: ProjectDetail, input: ExportDocInput): string {
  // 行序与序号都取文件顺序，和界面上的列表完全一致。
  const roots = filterByTypes(filterTree(project.roots, input.filters), input.boardTypes);
  const groups = groupBySection(roots, project.sections, project.sectionDescriptions);
  const codes = collectCodes(project.roots);
  const cols = input.listColumns ?? DEFAULT_LIST_COLUMNS;

  const heads = ['<th class="c-task">任务</th>'];
  if (cols.owner) heads.push('<th class="c-owner">联系人</th>');
  if (cols.priority) heads.push('<th class="c-prio">优先级</th>');
  if (cols.importance) heads.push('<th class="c-imp">重要性</th>');
  if (cols.due) heads.push('<th class="c-due">截止</th>');
  if (cols.cycle) heads.push('<th class="c-cycle">周期</th>');
  if (cols.status) heads.push('<th class="c-status">状态</th>');

  const rendered = groups
    .filter((group) => group.roots.length > 0)
    .map((group) => {
      const count = group.roots.reduce((total, root) => {
        const walk = (node: TaskNode): number =>
          1 + node.children.reduce((sum, child) => sum + walk(child), 0);
        return total + walk(root);
      }, 0);

      const head = group.hideHead
        ? ''
        : `<h2 class="section-head">${esc(group.name)}<span class="count">共 ${count} 项</span>${
            group.description
              ? `<span class="gdesc">${esc(group.description)}</span>`
              : ''
          }</h2>`;

      const rows = group.roots
        .map((root) => renderListRow(root, codes, input.collapsed, cols))
        .join('');

      return `<section class="group">${head}
<table>
  <thead><tr>
    ${heads.join('\n    ')}
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
</section>`;
    })
    .join('');

  return groups.length === 0 || !rendered
    ? '<p class="empty">当前条件下没有任务。</p>'
    : rendered;
}

/* -------------------------------------------------------------------------- */
/* Document shell                                                             */
/* -------------------------------------------------------------------------- */

function describeFilters(filters: Filters): string {
  const bits: string[] = [];
  if (filters.q.trim()) bits.push(`搜索「${filters.q.trim()}」`);
  if (filters.owner.length > 0) bits.push(`联系人 ${filters.owner.join('、')}`);
  if (filters.due.length > 0) {
    bits.push(filters.due.map((key) => DUE_LABELS[key] ?? key).join(' / '));
  }
  if (filters.status.length > 0) {
    bits.push(filters.status.map((key) => STATUS_LABELS[key] ?? key).join(' / '));
  }
  return bits.length ? bits.join(' · ') : '全部任务';
}

function paletteCss(appearance: AppearanceSettings): string {
  const titleColor = appearance.titleColor || DEFAULT_TITLE_COLOR;
  const createdColor = appearance.createdColor || DEFAULT_CREATED_COLOR;
  const p0 = appearance.p0Color || DEFAULT_P0_COLOR;
  const p1 = appearance.p1Color || DEFAULT_P1_COLOR;
  const p2 = appearance.p2Color || DEFAULT_P2_COLOR;
  const impHigh = appearance.impHighColor || DEFAULT_IMP_HIGH_COLOR;
  const impMid = appearance.impMidColor || DEFAULT_IMP_MID_COLOR;
  const impLow = appearance.impLowColor || DEFAULT_IMP_LOW_COLOR;
  return `:root{
  --ink:#101828; --ink-2:#475467; --ink-3:#667085; --ink-4:#98a2b3;
  --line:#eaecf0; --line-soft:#f2f4f7; --soft:#f9fafb;
  --p0:${p0}; --p0-weak:${alpha(p0, 0.08)};
  --p1:${p1}; --p1-weak:${alpha(p1, 0.08)};
  --p2:${p2}; --p2-weak:${alpha(p2, 0.08)};
  --imp-high:${impHigh}; --imp-high-weak:${alpha(impHigh, 0.08)};
  --imp-mid:${impMid}; --imp-mid-weak:${alpha(impMid, 0.08)};
  --imp-low:${impLow}; --imp-low-weak:${alpha(impLow, 0.08)};
  --title:${titleColor}; --title-weak:${alpha(titleColor, 0.07)};
  --created:${createdColor}; --created-weak:${alpha(createdColor, 0.08)};
}`;
}

const DOC_CSS = `
*{box-sizing:border-box}
body{margin:0;padding:22px 26px 26px;background:#fff;color:var(--ink);
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
  font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
.doc-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;border-bottom:2px solid var(--line);padding-bottom:10px}
h1{margin:0;font-size:20px;font-weight:700;letter-spacing:.2px}
.badge{font-size:11px;font-weight:600;color:#2563eb;background:rgba(37,99,235,.08);
  border:1px solid rgba(37,99,235,.24);border-radius:4px;padding:1px 6px}
.doc-status{font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;
  border:1px solid var(--line);color:var(--ink-2);background:var(--soft)}
.doc-status.active{color:#2563eb;border-color:rgba(37,99,235,.3);background:rgba(37,99,235,.06)}
.doc-status.ok{color:#067647;border-color:rgba(18,183,106,.35);background:rgba(18,183,106,.08)}
.doc-meta,.doc-scope{margin:6px 0 0;color:var(--ink-3);font-size:11.5px}
.doc-scope{color:var(--ink-4)}
main{margin-top:14px}
.empty{color:var(--ink-3);font-size:12px}
.doc-foot{margin-top:20px;padding-top:8px;border-top:1px solid var(--line-soft);color:var(--ink-4);font-size:10.5px}

/* ---- shared chips ---- */
.pill{display:inline-block;font-size:10.5px;font-weight:600;line-height:16px;padding:0 5px;border-radius:3px}
.pill.p0{color:var(--p0);background:var(--p0-weak)}
.pill.p1{color:var(--p1);background:var(--p1-weak)}
.pill.p2{color:var(--p2);background:var(--p2-weak)}
.pill.other{color:var(--ink-3);background:var(--line-soft)}
.code{font-family:Consolas,"SFMono-Regular",Menlo,monospace;font-size:10.5px;color:var(--ink-4);
  letter-spacing:.01em;min-width:26px;flex:none}
.created{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--created);
  background:var(--created-weak);border:1px solid var(--created-line);border-radius:3px;padding:0 4px;line-height:15px;flex:none}
.due{display:inline-flex;align-items:baseline;gap:3px;font-size:11px;color:var(--ink-3);white-space:nowrap}
.due b{font-weight:600;color:var(--ink-2)}
.due i{color:#d0d5dd;font-style:normal}
.due.soon,.due.soon b{color:${DUE_SOON}}
.due.today,.due.today b,.due.danger,.due.danger b{color:${DUE_DANGER}}
.due.done,.due.done b{color:var(--ink-4);font-weight:500}
.imp{font-size:10px;font-weight:600;border-radius:3px;padding:0 5px;line-height:15px;
  white-space:nowrap}
.imp.imp-high{color:var(--imp-high);background:var(--imp-high-weak)}
.imp.imp-mid{color:var(--imp-mid);background:var(--imp-mid-weak)}
.imp.imp-low{color:var(--imp-low);background:var(--imp-low-weak)}
.cycle{font-size:11px;color:var(--ink-3);white-space:nowrap}
.owner{display:inline-flex;align-items:center;font-size:11px;color:var(--ink-2);white-space:nowrap;
  max-width:100%;overflow:hidden;text-overflow:ellipsis}
.muted{color:var(--ink-4)}
.status{font-size:10.5px;font-weight:600;padding:0 6px;border-radius:99px;line-height:16px;
  display:inline-block;white-space:nowrap}
.status.open{color:#2563eb;background:rgba(37,99,235,.07)}
.status.done{color:#067647;background:rgba(18,183,106,.1)}

/* ---- board ---- */
.board{display:flex;align-items:flex-start;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.col{flex:1 1 0;min-width:0}
.col+.col{border-left:1px solid var(--line)}
.col-head{display:flex;align-items:center;gap:6px;padding:5px 10px;background:var(--soft);
  border-bottom:1px solid var(--line-soft)}
.dot{width:6px;height:6px;border-radius:50%;flex:none}
.dot.p0{background:var(--p0)}.dot.p1{background:var(--p1)}.dot.p2{background:var(--p2)}
.dot.other{background:var(--ink-4)}
.col-title{font-size:12px;font-weight:650}
.col-title.tone-p0{color:var(--p0)}.col-title.tone-p1{color:var(--p1)}
.col-title.tone-p2{color:var(--p2)}.col-title.tone-other{color:var(--ink-2)}
.col-hint{margin-left:auto;font-size:10.5px;color:var(--ink-4);white-space:nowrap}
.card{padding:8px 10px 9px;break-inside:avoid;page-break-inside:avoid}
.card+.card{border-top:1px solid var(--line-soft)}
.card.is-title{background:var(--title-weak)}
.card-line{display:flex;align-items:flex-start;gap:6px;min-width:0}
.badges{display:inline-flex;align-items:center;gap:4px;flex:none;margin-top:1px}
.badges .pill,.badges .imp{line-height:14px}
.check{width:11px;height:11px;border:1.5px solid #cfd4dc;border-radius:3px;flex:none;margin-top:3px;
  display:inline-grid;place-items:center;font-size:9px;line-height:1;color:#fff}
.check.on{background:#12b76a;border-color:#12b76a}
.check.on:after{content:"✓"}
.card .title{flex:1;min-width:0;font-size:12.5px;font-weight:600;line-height:1.5;word-break:break-word}
.card.is-done .title{color:var(--ink-4);text-decoration:line-through;text-decoration-color:#d0d5dd}
.card.is-done.is-version-task .title{text-decoration:none}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:5px;padding-left:17px}
.prog{display:flex;align-items:baseline;gap:5px;margin-top:5px;padding-left:17px;
  font-size:10.5px;color:var(--ink-3);min-width:0}
.prog-label{color:#2563eb;background:rgba(37,99,235,.07);border-radius:3px;padding:0 4px;flex:none;line-height:15px}
.prog-date{color:var(--ink-4);flex:none}
.prog-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prog em{flex:none;color:var(--ink-4);font-style:normal}
.children{margin-left:12px;padding-left:6px;border-left:1px dashed var(--line)}
.children .card{border-top:1px solid var(--line-soft)}
.children .card:first-child{border-top:0}

/* ---- list ---- */
.group{margin:0 0 16px}
.section-head{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:12.5px;
  font-weight:650;color:var(--ink-2)}
.section-head .count{font-weight:400;color:var(--ink-4);font-size:10.5px}
.section-head .gdesc{font-weight:400;color:var(--ink-3);font-size:10.5px}
table{width:100%;border-collapse:collapse;table-layout:fixed}
thead{display:table-header-group}
th{background:var(--soft);color:var(--ink-3);font-weight:600;font-size:10.5px;text-align:center;
  padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:5px 8px;font-size:12px;border-bottom:1px solid var(--line-soft);vertical-align:top}
tr{break-inside:avoid;page-break-inside:avoid}
tr.is-title td{background:var(--title-weak)}
.c-task{width:auto}
th.c-owner,td.c-owner{width:88px}th.c-prio,td.c-prio{width:58px}
th.c-imp,td.c-imp{width:56px}
th.c-due,td.c-due{width:132px}
th.c-cycle,td.c-cycle{width:52px}
th.c-status,td.c-status{width:70px}
td.c-task .code{margin-right:6px}
td.c-task .created{margin-right:6px;vertical-align:1px}
.tt{font-weight:600;word-break:break-word}
tr.is-done .tt{color:var(--ink-4);text-decoration:line-through;text-decoration-color:#d0d5dd}
tr.is-done.is-version-task .tt{text-decoration:none}
tr.is-title .tt{color:var(--title)}

@media print{
  body{padding:0}
  .board{border-radius:0}
  .doc-scope{color:#98a2b3}
}
`;


/* -------------------------------------------------------------------------- */
/* 完整项目文档（项目详情 + 任务清单）                                          */
/* -------------------------------------------------------------------------- */

/** Markdown → 安全 HTML；Obsidian 图片语法换成可直接访问的绝对地址。 */
function renderMarkdown(
  text: string,
  imageBase?: string,
  taskRefs?: TaskRefIndex,
): string {
  const withImages = hoistTableEmbeds(text).replace(
    /!\[\[([^\]]+)\]\]/g,
    (whole, inner: string) => {
      // `![[2.1]]` 先按任务序号解析，命中就写成静态的「序号 标题」。
      if (taskRefs) {
        const hit = lookupTaskRef(taskRefs, inner);
        if (hit) return taskRefStaticHtml(hit.task, hit.code);
      }
      if (!imageBase) return whole;
      const [rawName, rawWidth] = inner.split('|');
      const name = (rawName ?? '').trim();
      if (!name) return whole;
      const width = Number(rawWidth);
      const size = Number.isFinite(width) && width > 0 ? ` width="${width}"` : '';
      return `<img src="${imageBase}${encodeURIComponent(name)}" alt="${esc(name)}"${size}>`;
    },
  );
  const html = marked.parse(withImages, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

/** 完整文档里的最新进展：不省略、不隐藏（完成的任务也保留）。 */
function fullProgressLine(node: TaskNode): string {
  const latest = latestProgress(node);
  if (!latest) return '';
  const count = node.progress.length > 1 ? `<em>共 ${node.progress.length} 条</em>` : '';
  return `<div class="prog ft-prog"><span class="prog-label">最新进展</span><span class="prog-date">${esc(
    latest.date.slice(5),
  )}</span><span class="prog-text">${esc(progressPlainText(latest))}</span>${count}</div>`;
}

function renderFullTaskRow(node: TaskNode, codes: Map<string, string>): string {
  const level = Math.max(0, Math.floor(node.indent / 2));
  const isTitle = isTitleTask(node.fields);
  const classes: string[] = [];
  if (isTitle) classes.push('is-title');
  if (isVersionTask(node.fields)) classes.push('is-version-task');
  if (node.done) classes.push('is-done');

  const subBits = [
    node.fields.created ? `<span>创建 ${esc(node.fields.created)}</span>` : '',
    node.fields.start ? `<span>开始 ${esc(node.fields.start)}</span>` : '',
    node.fields.cycle ? `<span>周期 ${esc(node.fields.cycle)}</span>` : '',
    node.fields.confirm ? `<span>确认人 ${esc(node.fields.confirm)}</span>` : '',
  ]
    .filter(Boolean)
    .join('<i>·</i>');

  const row = `<tr${classes.length ? ` class="${classes.join(' ')}"` : ''}>
  <td class="c-id">${esc(codes.get(node.id) ?? '')}</td>
  <td class="c-task">
    <div class="ft-title" style="padding-left:${level * 14}px">${esc(node.title)}</div>
    ${subBits ? `<div class="ft-sub">${subBits}</div>` : ''}
    ${fullProgressLine(node)}
  </td>
  <td class="c-owner">${ownerChip(node.fields.owner)}</td>
  <td class="c-prio">${node.fields.priority ? priorityPill(node.fields.priority) : '<span class="muted">—</span>'}</td>
  <td class="c-imp">${node.fields.importance ? importanceChip(node.fields.importance) : '<span class="muted">—</span>'}</td>
  <td class="c-due">${node.fields.due ? dueChip(node.fields.due, node.done) : '<span class="muted">—</span>'}</td>
  <td class="c-status">${
    node.done ? '<span class="status done">已完成</span>' : '<span class="status open">进行中</span>'
  }</td>
</tr>`;

  if (!node.children.length) return row;
  return row + node.children.map((child) => renderFullTaskRow(child, codes)).join('');
}

/** 任务清单：所有分组、所有层级、所有字段（含最新进展），不受当前筛选影响。 */
function renderFullTasks(project: ProjectDetail): string {
  const roots = filterTree(project.roots, DEFAULT_FILTERS);
  const groups = groupBySection(
    roots,
    project.sections,
    project.sectionDescriptions,
  ).filter(
    (group) => group.roots.length > 0,
  );
  if (groups.length === 0) return '<p class="empty">项目还没有任务。</p>';

  const codes = collectCodes(project.roots);
  const heads = [
    '<th class="c-id">编号</th>',
    '<th class="c-task">任务</th>',
    '<th class="c-owner">联系人</th>',
    '<th class="c-prio">优先级</th>',
    '<th class="c-imp">重要性</th>',
    '<th class="c-due">截止</th>',
    '<th class="c-status">状态</th>',
  ].join('');

  return groups
    .map((group) => {
      const count = group.roots.reduce((total, root) => {
        const walk = (node: TaskNode): number =>
          1 + node.children.reduce((sum, child) => sum + walk(child), 0);
        return total + walk(root);
      }, 0);
      const title = group.hideHead
        ? ''
        : `<h2 class="section-head">${esc(group.name)}<span class="count">共 ${count} 项</span>${
            group.description
              ? `<span class="gdesc">${esc(group.description)}</span>`
              : ''
          }</h2>`;
      const rows = group.roots
        .map((root) => renderFullTaskRow(root, codes))
        .join('');
      return `<section class="group">${title}
<table class="ft-table">
  <thead><tr>${heads}</tr></thead>
  <tbody>${rows}</tbody>
</table>
</section>`;
    })
    .join('');
}

const PROJECT_CSS = `
.psec{margin:0 0 16px}
.psec-title{display:flex;align-items:baseline;gap:8px;margin:0 0 7px;padding-left:8px;
  border-left:3px solid #2563eb;font-size:14px;font-weight:700;color:var(--ink);line-height:1.4}
.psec-count{font-weight:400;font-size:10.5px;color:var(--ink-4)}
.md{font-size:12px;line-height:1.75;color:var(--ink-2)}
/* 页面里的 ![[2.1]] 引用：导出后是静态的「序号 标题」 */
.task-ref-static{display:inline-block;padding:0 5px;border:1px solid #d0d5dd;border-radius:5px;
  background:#f9fafb;font-size:.94em}
.task-ref-static b{color:#175cd3;font-variant-numeric:tabular-nums}
.md>:first-child{margin-top:0}
.md h1,.md h2,.md h3,.md h4{margin:12px 0 6px;color:var(--ink);line-height:1.45}
.md h1{font-size:15px}.md h2{font-size:13.5px}.md h3{font-size:12.5px}.md h4{font-size:12px}
.md p{margin:0 0 7px}
.md ul,.md ol{margin:0 0 7px;padding-left:20px}
.md li{margin:2px 0}
.md table{width:100%;border-collapse:collapse;margin:6px 0 10px;table-layout:auto;font-size:11.5px}
.md th{background:var(--soft);text-align:left;padding:5px 8px;border:1px solid var(--line);
  font-weight:600;color:var(--ink-2);white-space:normal}
.md td{padding:5px 8px;border:1px solid var(--line-soft);vertical-align:top}
.md code{font-family:Consolas,"SFMono-Regular",Menlo,monospace;font-size:11px;
  background:var(--line-soft);border-radius:3px;padding:0 4px}
.md pre{background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:8px 10px;
  overflow:auto;font-size:11px}
.md pre code{background:none;padding:0}
.md blockquote{margin:6px 0;padding:2px 0 2px 10px;border-left:2px solid var(--line);color:var(--ink-3)}
.md img{max-width:100%;height:auto;border-radius:6px}
.md a{color:#2563eb}
.ft-table{table-layout:fixed}
.ft-table th.c-id,.ft-table td.c-id{width:64px}
.ft-table th.c-task,.ft-table td.c-task{width:auto}
.ft-table th.c-owner,.ft-table td.c-owner{width:84px}
.ft-table th.c-prio,.ft-table td.c-prio{width:56px}
.ft-table th.c-imp,.ft-table td.c-imp{width:58px}
.ft-table th.c-due,.ft-table td.c-due{width:104px}
.ft-table th.c-status,.ft-table td.c-status{width:68px}
.ft-table td.c-id{font-family:Consolas,"SFMono-Regular",Menlo,monospace;font-size:10px;color:var(--ink-3)}
.ft-title{font-size:12px;font-weight:600;color:var(--ink);word-break:break-word}
.ft-sub{display:flex;flex-wrap:wrap;gap:2px 6px;margin-top:2px;font-size:10px;color:var(--ink-4)}
.ft-sub i{font-style:normal;color:var(--ink-4)}
.ft-prog{padding-left:0;margin-top:3px;white-space:normal}
.ft-prog .prog-text{white-space:normal;overflow:visible;text-overflow:clip;word-break:break-word}
.ft-table tr.is-done .ft-title{color:var(--ink-4);text-decoration:line-through;
  text-decoration-color:#d0d5dd}
.ft-table tr.is-done.is-version-task .ft-title{text-decoration:none}
.ft-table tr.is-title .ft-title{color:var(--title)}
@media print{
  body{padding:12mm 10mm}
  .psec-title,.section-head{break-after:avoid;page-break-after:avoid}
  .psec{break-inside:auto}
}
`;

export interface ProjectDocumentInput {
  project: ProjectDetail;
  appearance: AppearanceSettings;
  statuses?: ProjectStatusDef[];
}

/**
 * 导出「项目完整信息」：项目简介 + 里程碑 / 风险 / 成本 / 相关方（按用户拖动
 * 后的顺序，空的不导出）+ 任务清单（全部分组、全部层级、全部字段）。
 */
export function buildProjectDocument(input: ProjectDocumentInput): ExportDoc {
  const { project } = input;
  const stats = collectStats(project.roots);
  const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  const imageBase = `${window.location.origin}/api/projects/${encodeURIComponent(
    project.id,
  )}/images/`;
  // 页面里的 `![[2.1]]` 导出成静态的「序号 标题」。
  const taskRefs = buildTaskRefIndex(project.roots);

  const metaBits: string[] = [];
  if (project.code) metaBits.push(`编号 ${esc(project.code)}`);
  metaBits.push(`共 ${stats.total} 条任务`);
  metaBits.push(`未完成 ${stats.open}`);
  metaBits.push(`已完成 ${stats.done}`);
  metaBits.push(`完成率 ${percent}%`);
  if (project.owners.length) {
    const shown = project.owners.slice(0, 6).join('、');
    metaBits.push(
      `联系人 ${esc(shown)}${project.owners.length > 6 ? ` 等 ${project.owners.length} 人` : ''}`,
    );
  }
  if (project.updated) metaBits.push(`更新 ${esc(project.updated.slice(0, 10))}`);

  const scopeBits = [`文件 ${esc(project.path)}`];
  if (project.tags?.length) scopeBits.push(`标签 ${esc(project.tags.join('、'))}`);
  scopeBits.push(`导出于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`);

  const sections: string[] = [];
  // 简介也是 pageOrder 的一环，统一在这里输出，避免和简介页重复。
  for (const key of normalizeProjectPageOrder(project.pageOrder)) {
    const text = project.pages?.[key]?.trim() ?? '';
    if (!text) continue;
    sections.push(
      `<section class="psec"><h2 class="psec-title">${esc(
        PROJECT_PAGE_LABELS[key],
      )}</h2><div class="md">${renderMarkdown(text, imageBase, taskRefs)}</div></section>`,
    );
  }
  sections.push(
    `<section class="psec"><h2 class="psec-title">任务清单<span class="psec-count">共 ${stats.total} 项 · 未完成 ${stats.open}</span></h2>${renderFullTasks(
      project,
    )}</section>`,
  );

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(project.name)} · 项目完整信息</title>
<style>${paletteCss(input.appearance)}
${DOC_CSS}
${PROJECT_CSS}
/* 页边距交给 body 内边距：@page 边距为 0 时浏览器才不会在页边写出
   「日期 / 文件路径 / 页码」这类默认页眉页脚。 */
@page{size:A4 landscape;margin:0}
</style>
</head>
<body>
<header class="doc-head">
  <h1>${esc(project.name)}</h1>
  <span class="badge">项目完整信息</span>
  ${project.status ? statusChipHtml(project.status, input.statuses ?? []) : ''}
  <p class="doc-meta">${metaBits.join(' · ')}</p>
  <p class="doc-scope">${scopeBits.join(' · ')}</p>
</header>
<main>
${sections.join('\n')}
</main>
<footer class="doc-foot">导出自 WBS 工作台 · 含项目详情全部内容与任务清单全部字段</footer>
</body>
</html>
`;

  return {
    name: safeFilename(`${project.name}-完整信息`),
    html,
    layout: 'list',
  };
}

function statusChipHtml(status: string, statuses: ProjectStatusDef[]): string {
  const color = projectStatusColor(status, statuses);
  return `<span class="doc-status" style="color:${color};border-color:${color}47;background:${color}18">${esc(
    status,
  )}</span>`;
}

export function buildViewDocument(input: ExportDocInput): ExportDoc {
  const { project } = input;
  const layout: 'board' | 'list' = input.view === 'board' ? 'board' : 'list';
  const kindLabel = input.view === 'board' ? '看板' : '列表';
  const codes = collectCodes(project.roots);
  const stats = collectStats(project.roots);
  const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  const metaBits: string[] = [];
  if (project.code) metaBits.push(`编号 ${esc(project.code)}`);
  metaBits.push(`共 ${stats.total} 条任务`);
  metaBits.push(`未完成 ${stats.open}`);
  metaBits.push(`已完成 ${stats.done}`);
  metaBits.push(`完成率 ${percent}%`);
  if (project.updated) metaBits.push(`更新 ${esc(project.updated.slice(0, 10))}`);

  const scopeBits = [`筛选：${esc(describeFilters(input.filters))}`];
  if (layout === 'board') {
    const typeNames = (['plain', 'title', 'version'] as const)
      .filter((key) => input.boardTypes[key])
      .map((key) => TASK_TYPE_LABELS[key]);
    scopeBits.push(
      typeNames.length === 3 && input.boardTypes.versionChildren
        ? '含全部任务类型'
        : typeNames.length
          ? `仅 ${typeNames.join(' / ')}${
              input.boardTypes.versionChildren ? '' : '（不含版本子任务）'
            }`
          : '不含任何任务类型',
    );
  }
  if (input.view === 'gantt') scopeBits.push('甘特图按列表导出');
  scopeBits.push(
    `导出于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  );

  const groupCount =
    layout === 'board'
      ? buildBoard(project.roots, input.filters, {
          types: input.boardTypes,
        }).length
      : groupBySection(
          filterByTypes(filterTree(project.roots, input.filters), input.boardTypes),
          project.sections,
          project.sectionDescriptions,
        ).filter((group) => group.roots.length > 0).length;
  if (layout === 'board' && groupCount > 0) {
    scopeBits.splice(1, 0, `${groupCount} 个优先级分组`);
  }

  const body =
    layout === 'board'
      ? renderBoard(project, input, codes)
      : renderList(project, input);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(project.name)} · ${kindLabel}</title>
<style>${paletteCss(input.appearance)}
${DOC_CSS}
@page{size:A4 ${layout === 'board' ? 'landscape' : 'portrait'};margin:11mm 10mm}
</style>
</head>
<body>
<header class="doc-head">
  <h1>${esc(project.name)}</h1>
  <span class="badge">${kindLabel}</span>
  ${project.status ? statusChipHtml(project.status, input.statuses ?? []) : ''}
  <p class="doc-meta">${metaBits.join(' · ')}</p>
  <p class="doc-scope">${scopeBits.join(' · ')}</p>
</header>
<main>
${body}
</main>
<footer class="doc-foot">导出自 WBS 工作台 · 内容与当前${kindLabel}页面一致</footer>
</body>
</html>
`;

  return {
    name: safeFilename(`${project.name}-${kindLabel}`),
    html,
    layout,
  };
}
