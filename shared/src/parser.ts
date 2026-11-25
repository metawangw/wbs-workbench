import matter from 'gray-matter';
import {
  PROJECT_PAGE_KEYS,
  normalizeMilestoneTaskIds,
  normalizeProjectPageOrder,
  projectPageEnd,
  projectPageStart,
  type ProjectPageKey,
} from './pages';
import type { ProjectDoc, TaskFields, TaskNode } from './types';

const FIELD_ALIASES: Record<string, string> = {
  负责人: 'owner',
  联系人: 'owner',
  优先级: 'priority',
  重要性: 'importance',
  重要度: 'importance',
  开始: 'start',
  开始日期: 'start',
  截止: 'due',
  截止日期: 'due',
  周期: 'cycle',
  确认人: 'confirm',
  关联人: 'confirm',
  进度: 'progress',
  完成度: 'progress',
  依赖: 'deps',
  前置: 'deps',
  前置任务: 'deps',
  创建日期: 'created',
  建档日期: 'created',
  创建时间: 'created',
  created: 'created',
  showCreated: 'showCreated',
  显示创建日期: 'showCreated',
  显示建档日期: 'showCreated',
  isTitle: 'isTitle',
  标题任务: 'isTitle',
  标题类型: 'isTitle',
  isVersion: 'isVersion',
  版本任务: 'isVersion',
  版本类型: 'isVersion',
  version: 'version',
  版本: 'version',
  所属版本: 'version',
  版本号: 'version',
  今日关注: 'focus',
  关注: 'focus',
  标记: 'focus',
  focus: 'focus',
  贴纸颜色: 'focusColor',
  focusColor: 'focusColor',
};

const TASK_LINE = /^([ \t]*)- \[([ xX])\](?:[ \t]+(.*))?$/;
const PROGRESS_LINE =
  /^([ \t]*)-[ \t]+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?[ \t]+(.+)$/;
const HEADING_LINE = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
/** 分组描述写在 H2 标题行尾：`## 名称 <!-- desc:描述 -->`。 */
const SECTION_DESC_COMMENT = /[ \t]*<!--\s*desc:\s*([\s\S]*?)\s*-->[ \t]*$/;
const ID_COMMENT = /[ \t]*<!--\s*id:\s*([A-Za-z0-9_-]+)\s*-->[ \t]*$/;
const FIELD_TOKEN = /\[([\w一-鿿-]+)::([^\]]*)\]/g;
const FIELD_TOKEN_STRIP = /\[[\w一-鿿-]+::[^\]]*\]/g;
const FENCE_LINE = /^[ \t]*(```|~~~)/;
const DESCRIPTION_START = '<!-- description:start -->';
const DESCRIPTION_END = '<!-- description:end -->';

/** 页面块标记（里程碑 / 风险 / 成本），供分节收集时整块跳过。 */
function isPageStart(line: string): boolean {
  const match = /^<!--\s*page:[\w-]+:start\s*-->$/.exec(line);
  return Boolean(match);
}

function isPageEnd(line: string): boolean {
  const match = /^<!--\s*page:[\w-]+:end\s*-->$/.exec(line);
  return Boolean(match);
}

/**
 * Parse a project markdown file.
 *
 * The parser is deliberately line-based: every task keeps its absolute source
 * line so the repository layer can replace exactly one line on write instead of
 * re-serializing (and reformatting) the whole document.
 */
export function parseProject(relPath: string, input: string): ProjectDoc {
  const source = input.replace(/^﻿/, '');
  const eol: '\n' | '\r\n' = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const warnings: string[] = [];

  // ---- Front matter: metadata only; line numbers still refer to the full file ----
  let fmEnd = -1;
  if (lines[0]?.trim() === '---') {
    fmEnd = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (fmEnd < 0) warnings.push('Front Matter 缺少结束的 ---');
  }

  let meta: Record<string, unknown> = {};
  if (fmEnd > 0) {
    try {
      meta = (matter(source).data ?? {}) as Record<string, unknown>;
    } catch (error) {
      warnings.push(`Front Matter 解析失败：${(error as Error).message}`);
    }
  }

  // ---- Project description: the marker block between front matter and H1 ----
  let description: string | undefined;
  const descStart = lines.findIndex(
    (line, index) => index > fmEnd && line.trim() === DESCRIPTION_START,
  );
  if (descStart >= 0) {
    const descEnd = lines.findIndex(
      (line, index) => index > descStart && line.trim() === DESCRIPTION_END,
    );
    if (descEnd > descStart) {
      description = lines.slice(descStart + 1, descEnd).join('\n').trim();
    }
  }

  // ---- 里程碑 / 风险 / 成本：各自一个标记块，内容与简介一样只作文档 ----
  const pages: Partial<Record<ProjectPageKey, string>> = {};
  const blockRanges: Array<[number, number]> = [];
  if (descStart >= 0 && description !== undefined) {
    const descEnd = lines.findIndex(
      (line, index) => index > descStart && line.trim() === DESCRIPTION_END,
    );
    blockRanges.push([descStart, descEnd]);
  }
  // 简介没有独立的 page:intro 标记块，内容就在上面的 description 块里。
  if (description?.trim()) pages.intro = description;
  for (const key of PROJECT_PAGE_KEYS) {
    if (key === 'intro') continue;
    const start = lines.findIndex(
      (line, index) => index > fmEnd && line.trim() === projectPageStart(key),
    );
    if (start < 0) continue;
    const end = lines.findIndex(
      (line, index) => index > start && line.trim() === projectPageEnd(key),
    );
    if (end <= start) continue;
    blockRanges.push([start, end]);
    pages[key] = lines.slice(start + 1, end).join('\n').trim();
  }
  const inBlock = (index: number) =>
    blockRanges.some(([start, end]) => index >= start && index <= end);

  const roots: TaskNode[] = [];
  const byId = new Map<string, TaskNode>();
  const stack: TaskNode[] = [];
  const syntheticSeed = new Map<string, number>();
  let title: string | undefined;
  let section: string | undefined;
  let inFence = false;
  // 上一条进展（含它所在行的缩进），用来把后续更深缩进的行并进同一条记录。
  let lastProgress: { entry: { text: string }; indent: number } | null = null;
  // 进展续行之间可能出现的空行（写入端保留缩进的纯空格行），合并时还原成段落分隔。
  let pendingBlank = false;

  for (let lineNo = Math.max(0, fmEnd + 1); lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
    // 简介与三个页面块都是纯文档：里面的标题、任务标记一律不参与解析。
    if (inBlock(lineNo)) continue;
    if (!raw.trim()) {
      // 空白行不打断多条进展的续行：只挂起归属，遇到更深缩进的行再接回去。
      pendingBlank = true;
      continue;
    }

    if (FENCE_LINE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING_LINE.exec(raw);
    if (heading) {
      stack.length = 0;
      lastProgress = null;
      if (heading[1].length === 1 && !title) title = heading[2];
      if (heading[1].length === 2) section = parseSectionHeading(heading[2]).name;
      continue;
    }

    const taskMatch = TASK_LINE.exec(raw);
    if (taskMatch) {
      lastProgress = null;
      const indent = indentWidth(taskMatch[1]);
      const node = buildTask(
        relPath,
        taskMatch[3] ?? '',
        taskMatch[2],
        lineNo,
        indent,
        syntheticSeed,
        warnings,
      );

      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(node);
      } else {
        node.section = section;
        roots.push(node);
      }

      if (byId.has(node.id)) {
        warnings.push(`第 ${lineNo + 1} 行：任务 ID 重复 ${node.id}`);
      } else {
        byId.set(node.id, node);
      }
      stack.push(node);
      continue;
    }

    const progressMatch = PROGRESS_LINE.exec(raw);
    if (progressMatch) {
      const indent = indentWidth(progressMatch[1]);
      const owner = [...stack].reverse().find((node) => node.indent < indent);
      if (!owner) {
        warnings.push(`第 ${lineNo + 1} 行：进展记录找不到所属任务`);
        continue;
      }

      const body = progressMatch[4];
      const author = /\[by::([^\]]*)\]/.exec(body)?.[1]?.trim();
      const entry = {
        date: progressMatch[2],
        time: progressMatch[3],
        author,
        text: body
          .replace(FIELD_TOKEN_STRIP, '')
          .replace(/\s+/g, ' ')
          .trim(),
        line: lineNo,
      };
      owner.progress.push(entry);
      lastProgress = { entry, indent };
      pendingBlank = false;
      continue;
    }

    // 更深缩进的普通行属于上一条进展的续行（多行进展），原样接在后面；
    // 中间若跨过空行，用一个空行还原段落分隔，避免两段文字黏在一起。
    if (lastProgress && indentWidth(raw) > lastProgress.indent) {
      const extra = raw.trim().replace(FIELD_TOKEN_STRIP, '').trim();
      if (extra) {
        const gap = pendingBlank ? '\n\n' : '\n';
        lastProgress.entry.text = `${lastProgress.entry.text}${gap}${extra}`;
        pendingBlank = false;
        continue;
      }
    }

    // Quotes, paragraphs and plain lists are intentionally preserved but not parsed.
  }

  const hasPages = Object.keys(pages).length > 0;
  // 只在文件里显式写过 pageOrder 时才带出去，否则交给默认顺序。
  const pageOrder =
    meta.pageOrder === undefined ? undefined : normalizeProjectPageOrder(meta.pageOrder);
  const milestoneTasks = normalizeMilestoneTaskIds(meta.milestoneTasks);
  return {
    meta,
    title,
    description,
    pages: hasPages ? pages : undefined,
    pageOrder,
    milestoneTasks: milestoneTasks.length ? milestoneTasks : undefined,
    roots,
    byId,
    lines,
    eol,
    warnings,
  };
}

function buildTask(
  relPath: string,
  body: string,
  mark: string,
  line: number,
  indent: number,
  seed: Map<string, number>,
  warnings: string[],
): TaskNode {
  let text = body;
  let id: string | undefined;

  const idMatch = ID_COMMENT.exec(text);
  if (idMatch) {
    id = idMatch[1];
    text = text.slice(0, idMatch.index);
  }

  const fields: TaskFields = {};
  const title = text
    .replace(FIELD_TOKEN, (_match, key: string, value: string) => {
      const canonical = FIELD_ALIASES[key] ?? key.toLowerCase();
      fields[canonical] = value.trim();
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (fields.priority && /^p\d$/i.test(fields.priority)) {
    fields.priority = fields.priority.toUpperCase();
  }
  if (fields.due && !/^\d{4}-\d{2}-\d{2}$/.test(fields.due)) {
    warnings.push(`第 ${line + 1} 行：due 应为 YYYY-MM-DD（当前 ${fields.due}）`);
  }

  let synthetic = false;
  if (!id) {
    synthetic = true;
    const key = `${relPath}\u0000${body.trim()}`;
    const occurrence = (seed.get(key) ?? 0) + 1;
    seed.set(key, occurrence);
    id = `s_${fnv1a(`${key}\u0000${occurrence}`)}`;
  }

  return {
    id,
    synthetic,
    line,
    indent,
    title: title || '（未命名任务）',
    done: mark.toLowerCase() === 'x',
    fields,
    progress: [],
    children: [],
  };
}

const FIELD_ORDER = [
  'owner',
  'priority',
  'importance',
  'start',
  'due',
  'created',
  'showCreated',
  'isTitle',
  'isVersion',
  'focus',
  'focusColor',
  'cycle',
  'confirm',
  'progress',
  'deps',
  'version',
];

/** Serialize one task line. Untouched lines are never passed through this. */
export function serializeTaskLine(task: {
  indent: number;
  done: boolean;
  title: string;
  fields: TaskFields;
  id?: string;
}): string {
  const keys = Object.keys(task.fields)
    .filter((key) => task.fields[key]?.trim())
    .sort((a, b) => fieldRank(a) - fieldRank(b));

  const tokens = keys
    .map((key) => `[${key}::${sanitizeFieldValue(task.fields[key]!)}]`)
    .join(' ');

  return [
    ' '.repeat(Math.max(0, task.indent)),
    `- [${task.done ? 'x' : ' '}] ${task.title.trim()}`,
    tokens ? ` ${tokens}` : '',
    task.id ? ` <!-- id:${task.id} -->` : '',
  ].join('');
}

function fieldRank(key: string): number {
  const index = FIELD_ORDER.indexOf(key);
  return index < 0 ? FIELD_ORDER.length : index;
}

function sanitizeFieldValue(value: string): string {
  return value.replace(/[[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function indentWidth(whitespace: string): number {
  return whitespace.replace(/\t/g, '  ').length;
}

/**
 * 从 H2 标题文本里拆出「分组名 + 可选描述」。描述以行尾的
 * `<!-- desc:… -->` 注释承载，不占正文行，也不会被当成任务或新分组。
 */
export function parseSectionHeading(text: string): {
  name: string;
  description?: string;
} {
  const match = SECTION_DESC_COMMENT.exec(text);
  if (!match) return { name: text.trim() };
  return {
    name: text.slice(0, match.index).trim(),
    description: match[1].trim() || undefined,
  };
}

/** 拼回带描述的 H2 标题行。 */
export function formatSectionHeading(name: string, description?: string): string {
  const desc = description?.replace(/-->/g, '').trim();
  return `## ${name}${desc ? ` <!-- desc:${desc} -->` : ''}`;
}

/** 分组名 → 描述 的映射，供前端在分组标题行右侧展示。 */
export function collectSectionDescriptions(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let inFence = false;
  let blockDepth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === DESCRIPTION_START || isPageStart(trimmed)) {
      blockDepth += 1;
      continue;
    }
    if (trimmed === DESCRIPTION_END || isPageEnd(trimmed)) {
      blockDepth = Math.max(0, blockDepth - 1);
      continue;
    }
    if (blockDepth > 0) continue;
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = HEADING_LINE.exec(line);
    if (heading && heading[1].length === 2) {
      const { name, description } = parseSectionHeading(heading[2]);
      if (name && description) out[name] = description;
    }
  }
  return out;
}

/**
 * Ordered list of H2 group names (`## name`). Fence-aware and block-aware:
 * headings inside the description or a page block are documentation, never
 * real groups. Empty groups are included so the UI can show them while
 * managing task sections.
 */
export function collectSections(lines: string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let blockDepth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === DESCRIPTION_START || isPageStart(trimmed)) {
      blockDepth += 1;
      continue;
    }
    if (trimmed === DESCRIPTION_END || isPageEnd(trimmed)) {
      blockDepth = Math.max(0, blockDepth - 1);
      continue;
    }
    if (blockDepth > 0) continue;
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = HEADING_LINE.exec(line);
    if (heading && heading[1].length === 2) {
      const { name } = parseSectionHeading(heading[2]);
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}
