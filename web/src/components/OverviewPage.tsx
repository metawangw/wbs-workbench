import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { App as AntApp, Button, Segmented, Select } from 'antd';
import {
  FolderAddOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  PushpinOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { normalizeProjectTags, type ProjectSummary } from '@wbs/shared';
import { useStore } from '../store';
import { ProjectStatusChip } from './atoms';
import FocusBoard from './FocusBoard';

function dirOf(project: ProjectSummary): string {
  const parts = project.path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

/**
 * 总览的排序与左侧项目栏保持同一顺序：根目录项目在前，其余按文件夹顺序，
 * 文件夹内部沿用服务端返回的手工顺序（不足时再按名称）。服务端已经排好
 * 每个文件夹内部的顺序，这里只做「按分组重排」，不再按任务数重排。
 */
function sortProjects(
  projects: ProjectSummary[],
  folders: string[],
): ProjectSummary[] {
  const rank = new Map(folders.map((folder, index) => [folder, index]));
  return projects
    .map((project, index) => ({ project, index }))
    .sort((a, b) => {
      const dirA = dirOf(a.project);
      const dirB = dirOf(b.project);
      if (dirA !== dirB) {
        if (!dirA) return -1;
        if (!dirB) return 1;
        const rankA = rank.get(dirA);
        const rankB = rank.get(dirB);
        if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
        if (rankA !== undefined) return -1;
        if (rankB !== undefined) return 1;
        return dirA.localeCompare(dirB, 'zh-Hans-CN');
      }
      return a.index - b.index;
    })
    .map((entry) => entry.project);
}

type OverviewTab = 'focus' | 'projects';

const OVERVIEW_TAB_KEY = 'wbs.overviewTab';

function loadOverviewTab(): OverviewTab | null {
  try {
    const saved = localStorage.getItem(OVERVIEW_TAB_KEY);
    if (saved === 'focus' || saved === 'projects') return saved;
  } catch {
    /* storage may be unavailable */
  }
  return null;
}

type OverviewColumnKey =
  | 'project'
  | 'tags'
  | 'status'
  | 'progress'
  | 'open'
  | 'p0'
  | 'p1'
  | 'p2'
  | 'overdue';

interface OverviewColumn {
  key: OverviewColumnKey;
  label: string;
  width: number;
  min: number;
  max: number;
  num?: boolean;
}

const OVERVIEW_COLUMNS: OverviewColumn[] = [
  { key: 'project', label: '项目', width: 340, min: 160, max: 720 },
  { key: 'tags', label: '标签', width: 190, min: 90, max: 420 },
  { key: 'status', label: '状态', width: 110, min: 84, max: 220 },
  { key: 'progress', label: '进度', width: 150, min: 96, max: 260 },
  { key: 'open', label: '未完成', width: 62, min: 56, max: 140, num: true },
  { key: 'p0', label: 'P0', width: 46, min: 40, max: 120, num: true },
  { key: 'p1', label: 'P1', width: 46, min: 40, max: 120, num: true },
  { key: 'p2', label: 'P2', width: 46, min: 40, max: 120, num: true },
  { key: 'overdue', label: '超时', width: 50, min: 44, max: 120, num: true },
];

const OVERVIEW_COLS_KEY = 'wbs.overviewCols';
/** 与 CSS 的列间距保持一致，用于把「容器宽度」换算成「列宽总和」。 */
const OVERVIEW_GAP = 8;
const OVERVIEW_GAP_TOTAL = OVERVIEW_GAP * (OVERVIEW_COLUMNS.length - 1);

type OverviewWidths = Record<OverviewColumnKey, number>;

function defaultOverviewWidths(): OverviewWidths {
  return OVERVIEW_COLUMNS.reduce((acc, column) => {
    acc[column.key] = column.width;
    return acc;
  }, {} as OverviewWidths);
}

function clampOverviewWidth(column: OverviewColumn, value: number): number {
  return Math.min(column.max, Math.max(column.min, value));
}

function sumOverviewWidths(widths: OverviewWidths): number {
  return OVERVIEW_COLUMNS.reduce(
    (total, column) => total + widths[column.key],
    0,
  );
}

/**
 * 把多出来（或不足）的宽度按现有比例分摊给其他列，并遵守各自的上下限。
 * 这样表格始终刚好铺满卡片：拖动一列只会挤占/让出邻居，不会突然出现横向滚动条。
 */
function spreadOverviewWidth(
  widths: OverviewWidths,
  residual: number,
  exclude?: OverviewColumnKey,
): OverviewWidths {
  const next = { ...widths };
  let rest = residual;
  for (let round = 0; round < 4 && Math.abs(rest) > 0.5; round += 1) {
    const targets = OVERVIEW_COLUMNS.filter(
      (column) =>
        column.key !== exclude &&
        (rest > 0
          ? next[column.key] < column.max
          : next[column.key] > column.min),
    );
    if (!targets.length) break;
    const weight = targets.reduce(
      (total, column) => total + next[column.key],
      0,
    );
    if (weight <= 0) break;
    let consumed = 0;
    for (const column of targets) {
      const before = next[column.key];
      next[column.key] = clampOverviewWidth(
        column,
        before + (rest * before) / weight,
      );
      consumed += next[column.key] - before;
    }
    rest -= consumed;
  }
  return next;
}

/** 容器宽度变化时按比例缩放列宽，让总量重新等于可用宽度。 */
function fitOverviewWidths(
  widths: OverviewWidths,
  available: number,
): OverviewWidths {
  if (available <= 0) return widths;
  const total = sumOverviewWidths(widths);
  if (!total) return widths;
  const scale = available / total;
  const scaled = OVERVIEW_COLUMNS.reduce((acc, column) => {
    acc[column.key] = clampOverviewWidth(column, widths[column.key] * scale);
    return acc;
  }, {} as OverviewWidths);
  return spreadOverviewWidth(scaled, available - sumOverviewWidths(scaled));
}

function loadOverviewWidths(): OverviewWidths {
  const widths = defaultOverviewWidths();
  try {
    const raw = localStorage.getItem(OVERVIEW_COLS_KEY);
    if (!raw) return widths;
    const parsed = JSON.parse(raw) as Partial<Record<OverviewColumnKey, unknown>>;
    for (const column of OVERVIEW_COLUMNS) {
      const value = parsed?.[column.key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      widths[column.key] = Math.min(
        column.max,
        Math.max(column.min, Math.round(value)),
      );
    }
  } catch {
    // 本地存储损坏时回到默认列宽，不影响页面。
  }
  return widths;
}

function saveOverviewWidths(widths: OverviewWidths) {
  try {
    localStorage.setItem(OVERVIEW_COLS_KEY, JSON.stringify(widths));
  } catch {
    // 忽略无法写入的情况（隐私模式等）。
  }
}

/**
 * Inline tag editor in the overview table. Tags live in the project Front
 * Matter (`tags: [a, b]`), so they persist in the Markdown file itself. The
 * value comes straight from the store (optimistically patched on save), which
 * keeps two quick edits in a row from overwriting each other.
 */
function ProjectTags({
  project,
  suggestions,
}: {
  project: ProjectSummary;
  suggestions: string[];
}) {
  const setProjectTags = useStore((state) => state.setProjectTags);
  const { message } = AntApp.useApp();
  const tags = project.tags ?? [];

  const commit = (next: string[]) => {
    const normalized = normalizeProjectTags(next);
    if (normalized.join('\u0000') === tags.join('\u0000')) return;
    void setProjectTags(project.id, normalized).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '保存标签失败');
    });
  };

  return (
    <span
      className="index-tags"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Select
        mode="tags"
        size="small"
        variant="borderless"
        value={tags}
        placeholder="＋ 标签"
        // 单元格本身就是输入框：不需要右侧下拉箭头（无候选时那只是个空盒子）。
        suffixIcon={null}
        maxTagCount={2}
        maxTagPlaceholder={(omitted) => `+${omitted.length}`}
        tokenSeparators={[',', '，', ' ']}
        popupMatchSelectWidth={false}
        notFoundContent={null}
        options={suggestions
          .filter((tag) => !tags.includes(tag))
          .map((tag) => ({ value: tag, label: tag }))}
        onChange={(next) => commit(next as string[])}
      />
    </span>
  );
}


function EmptyOverview() {
  const openNewProject = useStore((state) => state.openNewProject);
  const openNewFolder = useStore((state) => state.openNewFolder);

  return (
    <div className="overview-empty">
      <div className="overview-empty-icon">
        <FolderOpenOutlined />
      </div>
      <h2>还没有项目</h2>
      <p>创建一份 Markdown 项目文件，或先建好文件夹开始整理。</p>
      <div className="overview-empty-actions">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openNewProject()}>
          新建项目
        </Button>
        <Button icon={<FolderAddOutlined />} onClick={openNewFolder}>
          新建文件夹
        </Button>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const projects = useStore((state) => state.projects);
  const folders = useStore((state) => state.folders);
  const selectProject = useStore((state) => state.selectProject);
  const openProjectDetail = useStore((state) => state.openProjectDetail);
  const statuses = useStore((state) => state.statuses);
  const [tab, setTab] = useState<OverviewTab | null>(loadOverviewTab);

  const changeTab = (next: OverviewTab) => {
    setTab(next);
    try {
      localStorage.setItem(OVERVIEW_TAB_KEY, next);
    } catch {
      /* storage may be unavailable */
    }
  };

  const focusCount = useMemo(
    () => projects.reduce((total, project) => total + (project.focusTasks?.length ?? 0), 0),
    [projects],
  );

  // 未手动切换过时：有标记就默认看今日关注，否则保持原来的项目列表。
  const activeTab: OverviewTab = tab ?? (focusCount > 0 ? 'focus' : 'projects');

  const sorted = useMemo(() => sortProjects(projects, folders), [projects, folders]);
  const totals = useMemo(() => {
    return projects.reduce(
      (acc, project) => ({
        total: acc.total + project.stats.total,
        done: acc.done + project.stats.done,
        open: acc.open + project.stats.open,
        overdue: acc.overdue + project.stats.overdue,
        today: acc.today + project.stats.today,
      }),
      { total: 0, done: 0, open: 0, overdue: 0, today: 0 },
    );
  }, [projects]);

  const tableRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<OverviewWidths>(loadOverviewWidths);
  const [available, setAvailable] = useState(0);
  const [resizing, setResizing] = useState<OverviewColumnKey | null>(null);
  const dragRef = useRef<{
    key: OverviewColumnKey;
    x: number;
    width: number;
    snapshot: OverviewWidths;
  } | null>(null);

  // 列宽以像素保存，但总和要跟住卡片宽度：测量 → 等比缩放。
  useEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const measure = () => {
      const head = element.querySelector<HTMLElement>('.index-head');
      if (!head) {
        setAvailable(0);
        return;
      }
      const style = getComputedStyle(head);
      // 表头（与数据行同一套栅格）除去左右内边距后的宽度，才是列轨道的总长。
      const inner =
        head.clientWidth -
        parseFloat(style.paddingLeft || '0') -
        parseFloat(style.paddingRight || '0');
      const next = Math.max(0, inner - OVERVIEW_GAP_TOTAL);
      setAvailable((previous) => (previous === next ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [projects.length, activeTab]);

  useEffect(() => {
    if (!available) return;
    setWidths((previous) => fitOverviewWidths(previous, available));
  }, [available]);

  // 拖动期间把移动监听到 window 上：指针滑出表头甚至窗口边缘时仍然跟手。
  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const column = OVERVIEW_COLUMNS.find((item) => item.key === drag.key);
      if (!column) return;
      const target = clampOverviewWidth(
        column,
        drag.width + event.clientX - drag.x,
      );
      const base = { ...drag.snapshot, [drag.key]: target };
      // 目标列不动，其余列按比例承接差额，总量保持铺满。
      setWidths(
        available
          ? spreadOverviewWidth(base, available - sumOverviewWidths(base), drag.key)
          : base,
      );
    };
    const onUp = () => {
      dragRef.current = null;
      setResizing(null);
      setWidths((previous) => {
        saveOverviewWidths(previous);
        return previous;
      });
    };
    document.body.classList.add('ov-col-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      document.body.classList.remove('ov-col-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizing, available]);

  const startResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    column: OverviewColumn,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      key: column.key,
      x: event.clientX,
      width: widths[column.key] ?? column.width,
      snapshot: widths,
    };
    setResizing(column.key);
  };

  const resetColumnWidth = (column: OverviewColumn) => {
    setWidths((previous) => {
      const base = { ...previous, [column.key]: column.width };
      const next = available
        ? spreadOverviewWidth(
            base,
            available - sumOverviewWidths(base),
            column.key,
          )
        : base;
      saveOverviewWidths(next);
      return next;
    });
  };

  const gridTemplate = useMemo(
    () =>
      OVERVIEW_COLUMNS.map(
        (column) => `${Math.round(widths[column.key] ?? column.width)}px`,
      ).join(' '),
    [widths],
  );

  if (!projects.length) return <EmptyOverview />;

  const tagSuggestions = [...new Set(projects.flatMap((project) => project.tags ?? []))].sort(
    (a, b) => a.localeCompare(b, 'zh-Hans-CN'),
  );

  const completion = totals.total
    ? Math.round((totals.done / totals.total) * 100)
    : 0;

  return (
    <div className="overview-page">
      <div className="overview-kpis">
        <div className="overview-kpi">
          <div className="overview-kpi-label">项目</div>
          <div className="overview-kpi-value">{projects.length}</div>
          <div className="overview-kpi-sub">本地 Markdown 项目</div>
        </div>
        <div className="overview-kpi">
          <div className="overview-kpi-label">总任务</div>
          <div className="overview-kpi-value">{totals.total}</div>
          <div className="overview-kpi-sub">已完成 {totals.done} 项</div>
        </div>
        <div className="overview-kpi">
          <div className="overview-kpi-label">未完成</div>
          <div className="overview-kpi-value accent">{totals.open}</div>
          <div className="overview-kpi-sub">整体完成率 {completion}%</div>
        </div>
        <div className="overview-kpi">
          <div className="overview-kpi-label">已超时</div>
          <div className={`overview-kpi-value${totals.overdue > 0 ? ' danger' : ''}`}>
            {totals.overdue}
          </div>
          <div className="overview-kpi-sub">今天到期 {totals.today} 项</div>
        </div>
      </div>

      <section className="overview-card">
        <header className="overview-card-head overview-list-head">
          <div>
            <h2 className="overview-card-title">
              {activeTab === 'focus' ? '今日关注' : '项目列表'}
            </h2>
          </div>
          <div className="overview-head-tools">
            <Segmented
              size="small"
              value={activeTab}
              onChange={(value) => changeTab(value as OverviewTab)}
              options={[
                {
                  label: (
                    <span className="overview-tab-label">
                      <PushpinOutlined />
                      今日关注
                    </span>
                  ),
                  value: 'focus',
                },
                {
                  label: (
                    <span className="overview-tab-label">
                      <UnorderedListOutlined />
                      项目列表
                    </span>
                  ),
                  value: 'projects',
                },
              ]}
            />
            <span className="chart-unit">
              {activeTab === 'focus' ? `${focusCount} 项标记` : `${projects.length} 个项目`}
            </span>
          </div>
        </header>

        {activeTab === 'focus' ? (
          <FocusBoard
            projects={sorted}
            statuses={statuses}
            onShowProjects={() => changeTab('projects')}
          />
        ) : (
          <div
            className="index-table"
            ref={tableRef}
            style={
              available
                ? ({ '--ov-cols': gridTemplate } as CSSProperties)
                : undefined
            }
          >
            <div className="index-head">
              {OVERVIEW_COLUMNS.map((column) => (
                <span
                  key={column.key}
                  className={`index-col${column.num ? ' num' : ''}`}
                >
                  {column.label}
                  <span
                    className={`ov-col-resizer${resizing === column.key ? ' is-active' : ''}`}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`调整「${column.label}」列宽`}
                    title="拖动调整列宽，双击恢复默认"
                    onPointerDown={(event) => startResize(event, column)}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      resetColumnWidth(column);
                    }}
                  />
                </span>
              ))}
            </div>
  
          {sorted.map((project) => {
            const progress = project.stats.total
              ? Math.round((project.stats.done / project.stats.total) * 100)
              : 0;
  
            return (
              <div
                className="index-row"
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => void selectProject(project.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  void selectProject(project.id);
                }}
                aria-label={`打开项目 ${project.name}`}
              >
                <span className="index-project">
                  <span
                    className="index-project-name"
                    role="button"
                    title="点击查看项目详情"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProjectDetail(project.id);
                    }}
                  >
                    {project.name}
                  </span>
                  {project.code ? (
                    <span className="index-project-meta">{project.code}</span>
                  ) : null}
                </span>
                <span className="index-tags-cell">
                  <ProjectTags project={project} suggestions={tagSuggestions} />
                </span>
                <span className="index-status">
                  <ProjectStatusChip status={project.status} />
                </span>
                <span className="index-progress">
                  <span className="index-progress-track">
                    <span style={{ width: `${progress}%` }} />
                  </span>
                  <span className="index-progress-label">
                    {project.stats.done}/{project.stats.total}
                  </span>
                </span>
                <span className="index-open num">
                  {project.stats.open}
                  <span className="index-unit"> 项</span>
                </span>
                <span className={`index-p0 num${project.stats.p0 > 0 ? ' danger' : ''}`}>
                  {project.stats.p0 || '—'}
                </span>
                <span
                  className={`index-p1 num${(project.stats.byPriority.P1 ?? 0) > 0 ? ' warn' : ''}`}
                >
                  {project.stats.byPriority.P1 || '—'}
                </span>
                <span className={`index-p2 num${(project.stats.byPriority.P2 ?? 0) > 0 ? ' warn2' : ''}`}>
                  {project.stats.byPriority.P2 || '—'}
                </span>
                <span
                  className={`index-overdue num${
                    project.stats.overdue > 0 ? ' danger' : ''
                  }`}
                >
                  {project.stats.overdue || '—'}
                </span>
              </div>
            );
          })}
          </div>
        )}
      </section>
    </div>
  );
}
