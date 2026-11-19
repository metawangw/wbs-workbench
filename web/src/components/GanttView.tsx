import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  App as AntApp,
  Button,
  Checkbox,
  Segmented,
  Switch,
} from 'antd';
import {
  AimOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { collectCodes, dueDiff, type TaskNode } from '@wbs/shared';
import { useStore } from '../store';
import { filterTree } from '../lib/filters';
import { NoMatches } from './EmptyStates';

/** Timeline granularity. Day width changes with the zoom level. */
type Zoom = 'day' | 'week' | 'month';

/** Visual state of a Gantt bar. */
type BarTone = 'done' | 'active' | 'planned' | 'overdue';

const ZOOM_DAY_WIDTH: Record<Zoom, number> = { day: 36, week: 14, month: 4 };
const ZOOM_PADDING_DAYS: Record<Zoom, number> = { day: 3, week: 7, month: 10 };
/** Smallest window per zoom so a 1-day project still fills the panel nicely. */
const MIN_RANGE_DAYS: Record<Zoom, number> = { day: 28, week: 84, month: 366 };
const ZOOM_OPTIONS: { value: Zoom; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
];

const LEFT_WIDTH = 336;
const ROW_HEIGHT = 40;
const HEAD_TIER_HEIGHT = 24;
const GRID_LINE_MIN_WIDTH = 12;
const MIN_BAR_WIDTH = 8;
/** Tasks that only carry a due date get a synthetic 3-day bar (due − 2 … due). */
const DEFAULT_DURATION_DAYS = 3;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const TONE_LABEL: Record<BarTone, string> = {
  done: '已完成',
  active: '进行中',
  planned: '未开始',
  overdue: '已超时',
};

/** One header cell (a month, a year, a day or a week chunk). */
interface Segment {
  key: string;
  label: string;
  sub?: string;
  /** Day index relative to the range start. */
  startIdx: number;
  days: number;
  isToday: boolean;
}

interface DateBounds {
  min: Dayjs | null;
  max: Dayjs | null;
}

/** Bar geometry resolved from `start` / `due`, expressed in day indexes. */
interface BarGeometry {
  startIdx: number;
  endIdx: number;
  startDate: string;
  endDate: string;
  days: number;
}

interface GanttRowData {
  task: TaskNode;
  code: string;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** Parse a stored `YYYY-MM-DD` value; returns null for anything unusable. */
function toDay(value?: string): Dayjs | null {
  if (!value) return null;
  const parsed = dayjs(value.slice(0, 10));
  return parsed.isValid() ? parsed.startOf('day') : null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Calendar-day distance between two days, computed in UTC so daylight-saving
 * transitions can never shift a bar by one day.
 */
function dayIndex(day: Dayjs, origin: Dayjs): number {
  const target = Date.UTC(day.year(), day.month(), day.date());
  const base = Date.UTC(origin.year(), origin.month(), origin.date());
  return Math.round((target - base) / MS_PER_DAY);
}

/** Monday-based week start (dayjs' default week starts on Sunday). */
function startOfMonday(day: Dayjs): Dayjs {
  return day.subtract((day.day() + 6) % 7, 'day').startOf('day');
}

function buildMonthSegments(start: Dayjs, end: Dayjs, today: Dayjs): Segment[] {
  const segments: Segment[] = [];
  let cursor = start.startOf('month');

  while (!cursor.isAfter(end, 'day')) {
    const segmentStart = cursor.isAfter(start, 'day') ? cursor : start;
    const monthEnd = cursor.endOf('month').startOf('day');
    const segmentEnd = monthEnd.isAfter(end, 'day') ? end : monthEnd;
    const isFirst = segments.length === 0;

    segments.push({
      key: `month-${cursor.format('YYYY-MM')}`,
      label:
        isFirst || cursor.month() === 0
          ? `${cursor.year()}年${cursor.month() + 1}月`
          : `${cursor.month() + 1}月`,
      startIdx: dayIndex(segmentStart, start),
      days: dayIndex(segmentEnd, segmentStart) + 1,
      isToday: !today.isBefore(segmentStart, 'day') && !today.isAfter(segmentEnd, 'day'),
    });

    cursor = segmentEnd.add(1, 'day');
  }

  return segments;
}

function buildYearSegments(start: Dayjs, end: Dayjs, today: Dayjs): Segment[] {
  const segments: Segment[] = [];
  let cursor = start.startOf('year');

  while (!cursor.isAfter(end, 'day')) {
    const segmentStart = cursor.isAfter(start, 'day') ? cursor : start;
    const yearEnd = cursor.endOf('year').startOf('day');
    const segmentEnd = yearEnd.isAfter(end, 'day') ? end : yearEnd;

    segments.push({
      key: `year-${cursor.year()}`,
      label: `${cursor.year()}年`,
      startIdx: dayIndex(segmentStart, start),
      days: dayIndex(segmentEnd, segmentStart) + 1,
      isToday: !today.isBefore(segmentStart, 'day') && !today.isAfter(segmentEnd, 'day'),
    });

    cursor = segmentEnd.add(1, 'day');
  }

  return segments;
}

function buildDaySegments(start: Dayjs, end: Dayjs, today: Dayjs): Segment[] {
  const total = dayIndex(end, start) + 1;
  const segments: Segment[] = [];

  for (let index = 0; index < total; index++) {
    const day = start.add(index, 'day');
    segments.push({
      key: `day-${day.format('YYYY-MM-DD')}`,
      label: String(day.date()),
      sub: WEEKDAY_LABELS[day.day()],
      startIdx: index,
      days: 1,
      isToday: day.isSame(today, 'day'),
    });
  }

  return segments;
}

function buildWeekSegments(start: Dayjs, end: Dayjs, today: Dayjs): Segment[] {
  const segments: Segment[] = [];
  let cursor = start;

  while (!cursor.isAfter(end, 'day')) {
    const chunkEnd = cursor.add(6, 'day');
    const segmentEnd = chunkEnd.isAfter(end, 'day') ? end : chunkEnd;
    const monday = startOfMonday(cursor);

    segments.push({
      key: `week-${cursor.format('YYYY-MM-DD')}`,
      label: `${monday.month() + 1}/${monday.date()}`,
      sub: '周',
      startIdx: dayIndex(cursor, start),
      days: dayIndex(segmentEnd, cursor) + 1,
      isToday: !today.isBefore(cursor, 'day') && !today.isAfter(segmentEnd, 'day'),
    });

    cursor = segmentEnd.add(1, 'day');
  }

  return segments;
}

/** Earliest / latest scheduled day across the whole tree (ignores filters). */
function collectBounds(roots: TaskNode[]): DateBounds {
  let min: Dayjs | null = null;
  let max: Dayjs | null = null;

  const walk = (node: TaskNode) => {
    for (const value of [node.fields.start, node.fields.due]) {
      const day = toDay(value);
      if (!day) continue;
      if (min === null || day.isBefore(min, 'day')) min = day;
      if (max === null || day.isAfter(max, 'day')) max = day;
    }
    node.children.forEach(walk);
  };

  roots.forEach(walk);
  return { min, max };
}

/** Visible window: data bounds ± padding, snapped to the current zoom unit. */
function computeRange(
  bounds: DateBounds,
  zoom: Zoom,
  today: Dayjs,
): { start: Dayjs; end: Dayjs } {
  const padding = ZOOM_PADDING_DAYS[zoom];
  let from = (bounds.min ?? today).subtract(padding, 'day');
  let to = (bounds.max ?? today).add(padding, 'day');

  if (to.isBefore(from, 'day')) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (today.isBefore(from, 'day')) from = today;
  if (today.isAfter(to, 'day')) to = today;

  if (zoom === 'week') {
    from = startOfMonday(from);
    to = startOfMonday(to).add(6, 'day');
  } else if (zoom === 'month') {
    from = from.startOf('month');
    to = to.endOf('month').startOf('day');
  }

  // Guarantee a readable canvas even for a single-day project.
  const minimum = MIN_RANGE_DAYS[zoom];
  if (dayIndex(to, from) + 1 < minimum) {
    to = from.add(minimum - 1, 'day');
  }

  return { start: from, end: to };
}

/**
 * Resolve a task's bar. Only `due` → 3-day bar ending on the due date; only
 * `start` → 1-day bar; both → inclusive span; neither → no bar at all.
 */
function resolveBar(task: TaskNode, rangeStart: Dayjs): BarGeometry | null {
  const start = toDay(task.fields.start);
  const due = toDay(task.fields.due);
  if (!start && !due) return null;

  let from: Dayjs;
  let to: Dayjs;

  if (start && due) {
    const reversed = start.isAfter(due, 'day');
    from = reversed ? due : start;
    to = reversed ? start : due;
  } else if (due) {
    from = due.subtract(DEFAULT_DURATION_DAYS - 1, 'day');
    to = due;
  } else {
    from = start as Dayjs;
    to = start as Dayjs;
  }

  const startIdx = dayIndex(from, rangeStart);
  const endIdx = dayIndex(to, rangeStart);

  return {
    startIdx,
    endIdx,
    startDate: from.format('YYYY-MM-DD'),
    endDate: to.format('YYYY-MM-DD'),
    days: endIdx - startIdx + 1,
  };
}

/**
 * Finish-to-start elbow connector between a predecessor bar's right edge and
 * a successor bar's left edge. Stays in the timeline area (x >= LEFT_WIDTH)
 * so it never crosses the sticky task-name column.
 */
function elbowPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const gap = 9;
  const tipGap = 5;
  const bendX = fromX + gap;
  const tipX = toX - tipGap;
  if (tipX <= bendX) {
    // Successor starts before the predecessor ends: route around the rows.
    const midY = fromY === toY ? fromY + ROW_HEIGHT / 2 : fromY + (toY > fromY ? 8 : -8);
    return `M ${fromX} ${fromY} H ${bendX} V ${midY} H ${tipX} V ${toY} H ${toX}`;
  }
  return `M ${fromX} ${fromY} H ${bendX} V ${toY} H ${toX}`;
}

function barTone(task: TaskNode, today: Dayjs): BarTone {
  if (task.done) return 'done';

  const due = toDay(task.fields.due);
  if (due && due.isBefore(today, 'day')) return 'overdue';

  const start = toDay(task.fields.start);
  if (start && start.isAfter(today, 'day')) return 'planned';

  return 'active';
}

/** Parse a stored `progress` field into a clamped 0-100 number, or null. */
function parseProgress(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

/** Parse a stored `deps` field into a list of predecessor task IDs. */
function parseDeps(value?: string): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[,\s]+/).filter(Boolean))];
}

/** Local (view-only) filtering: "hide completed". Search is handled by the shared FilterBar. */
function filterNodes(nodes: TaskNode[], hideDone: boolean): TaskNode[] {
  const out: TaskNode[] = [];

  for (const node of nodes) {
    const children = filterNodes(node.children, hideDone);
    // A completed parent stays visible only while it still holds visible children.
    const matchesDone = !hideDone || !node.done || children.length > 0;
    if (matchesDone || children.length > 0) {
      out.push({ ...node, children });
    }
  }

  return out;
}

/** Flatten the tree into rows while honouring the shared collapse state. */
function buildRows(
  nodes: TaskNode[],
  codes: Map<string, string>,
  collapsed: Record<string, boolean>,
  level = 0,
  out: GanttRowData[] = [],
): GanttRowData[] {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const expanded = !collapsed[node.id];
    out.push({
      task: node,
      code: codes.get(node.id) ?? '',
      level,
      hasChildren,
      expanded,
    });
    if (hasChildren && expanded) {
      buildRows(node.children, codes, collapsed, level + 1, out);
    }
  }
  return out;
}

export default function GanttView() {
  const project = useStore((state) => state.project);
  const filters = useStore((state) => state.filters);
  const collapsed = useStore((state) => state.collapsed);
  const toggleCollapsed = useStore((state) => state.toggleCollapsed);
  const toggleDone = useStore((state) => state.toggleDone);
  const openTask = useStore((state) => state.openTask);
  const resetFilters = useStore((state) => state.resetFilters);
  const { message } = AntApp.useApp();

  const [zoom, setZoom] = useState<Zoom>('week');
  const [hideDone, setHideDone] = useState(false);
  const [showDeps, setShowDeps] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const roots = project?.roots ?? [];
  // Recomputed once per mount: a moving "today" would fight the scroll sync.
  const today = useMemo(() => dayjs().startOf('day'), []);
  const codes = useMemo(() => collectCodes(roots), [roots]);
  const bounds = useMemo(() => collectBounds(roots), [roots]);
  const range = useMemo(() => computeRange(bounds, zoom, today), [bounds, zoom, today]);

  const dayWidth = ZOOM_DAY_WIDTH[zoom];
  const totalDays = Math.max(1, dayIndex(range.end, range.start) + 1);
  const timelineWidth = totalDays * dayWidth;
  const canvasWidth = LEFT_WIDTH + timelineWidth;
  const gridSize = zoom === 'day' ? dayWidth : zoom === 'week' ? dayWidth * 7 : 0;
  const todayOffset = dayIndex(today, range.start) * dayWidth + dayWidth / 2;

  const monthSegments = useMemo(
    () => buildMonthSegments(range.start, range.end, today),
    [range, today],
  );
  const yearSegments = useMemo(
    () => buildYearSegments(range.start, range.end, today),
    [range, today],
  );
  const daySegments = useMemo(
    () => (zoom === 'day' ? buildDaySegments(range.start, range.end, today) : []),
    [zoom, range, today],
  );
  const weekSegments = useMemo(
    () => (zoom === 'week' ? buildWeekSegments(range.start, range.end, today) : []),
    [zoom, range, today],
  );

  const tierOne = zoom === 'month' ? yearSegments : monthSegments;
  const tierTwo = zoom === 'day' ? daySegments : zoom === 'week' ? weekSegments : monthSegments;

  const hasScheduled = bounds.min !== null || bounds.max !== null;

  const visibleRoots = useMemo(
    () => filterNodes(filterTree(roots, filters), hideDone),
    [roots, filters, hideDone],
  );
  const rows = useMemo(
    () => buildRows(visibleRoots, codes, collapsed),
    [visibleRoots, codes, collapsed],
  );

  /**
   * Dependency arrows. Bars are resolved once per row here and shared with the
   * render loop below, so an arrow always lands exactly on its bar edges.
   * Arrows are drawn only when both tasks are visible (expanded + not filtered
   * out), keeping the SVG in sync with the rows actually on screen.
   */
  const dependencyLinks = useMemo(() => {
    if (!showDeps) return [];

    const rowIndexById = new Map<string, number>();
    rows.forEach((row, index) => rowIndexById.set(row.task.id, index));

    const edges: Array<{
      key: string;
      path: string;
      title: string;
    }> = [];

    rows.forEach((row, toIndex) => {
      const deps = parseDeps(row.task.fields.deps);
      if (!deps.length) return;
      const toBar = resolveBar(row.task, range.start);
      if (!toBar) return;

      const toFirst = Math.max(0, toBar.startIdx);
      const toLast = Math.min(totalDays - 1, toBar.endIdx);
      if (toLast < toFirst) return;
      const toX = LEFT_WIDTH + toFirst * dayWidth;
      const toY = toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

      for (const depId of deps) {
        const fromIndex = rowIndexById.get(depId);
        if (fromIndex === undefined) continue;
        const fromRow = rows[fromIndex];
        const fromBar = resolveBar(fromRow.task, range.start);
        if (!fromBar) continue;

        const fromFirst = Math.max(0, fromBar.startIdx);
        const fromLast = Math.min(totalDays - 1, fromBar.endIdx);
        if (fromLast < fromFirst) continue;
        const fromX = LEFT_WIDTH + (fromLast + 1) * dayWidth;
        const fromY = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

        const path = elbowPath(fromX, fromY, toX, toY);
        edges.push({
          key: `${depId}->${row.task.id}`,
          path,
          title: `${fromRow.code} ${fromRow.task.title} → ${row.code} ${row.task.title}`,
        });
      }
    });

    return edges;
  }, [showDeps, rows, range.start, totalDays, dayWidth]);

  const jumpToToday = useCallback(
    (behavior: ScrollBehavior) => {
      const element = scrollRef.current;
      if (!element) return;
      const visible = Math.max(240, element.clientWidth - LEFT_WIDTH);
      const target = Math.max(0, dayIndex(today, range.start) * dayWidth - visible * 0.3);
      element.scrollTo({ left: target, behavior });
    },
    [dayWidth, range, today],
  );

  // Re-centre on today whenever the visible window or the zoom changes. The
  // callback is read through a ref so a background data refresh (which creates
  // a new `range` object) never yanks the user back from where they scrolled.
  const jumpRef = useRef(jumpToToday);
  useEffect(() => {
    jumpRef.current = jumpToToday;
  }, [jumpToToday]);

  const rangeKey = `${range.start.format('YYYY-MM-DD')}~${range.end.format('YYYY-MM-DD')}@${zoom}`;
  useEffect(() => {
    const handle = window.setTimeout(() => jumpRef.current('auto'), 0);
    return () => window.clearTimeout(handle);
  }, [rangeKey]);

  if (!project) return null;

  const resetLocalFilters = () => {
    setHideDone(false);
    resetFilters();
  };

  if (rows.length === 0) {
    return <NoMatches onReset={resetLocalFilters} />;
  }

  const handleToggleDone = (task: TaskNode) => {
    void toggleDone(task).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '更新失败');
    });
  };

  return (
    <div className="gantt-panel">
      <div className="gantt-toolbar">
        <Segmented
          className="gantt-zoom"
          size="small"
          value={zoom}
          options={ZOOM_OPTIONS}
          onChange={(value) => setZoom(value as Zoom)}
        />
        <Button size="small" icon={<AimOutlined />} onClick={() => jumpToToday('smooth')}>
          今天
        </Button>
        <span className="gantt-toggle">
          <Switch size="small" checked={showDeps} onChange={setShowDeps} />
          <span
            className="gantt-toggle-label"
            role="button"
            tabIndex={0}
            onClick={() => setShowDeps((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setShowDeps((value) => !value);
              }
            }}
          >
            依赖线
          </span>
        </span>

        <span className="gantt-toggle">
          <Switch size="small" checked={hideDone} onChange={setHideDone} />
          <span
            className="gantt-toggle-label"
            role="button"
            tabIndex={0}
            onClick={() => setHideDone((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setHideDone((value) => !value);
              }
            }}
          >
            仅未完成
          </span>
        </span>

        <div className="gantt-spacer" />

        <div className="gantt-legend">
          {(['done', 'active', 'planned', 'overdue'] as BarTone[]).map((tone) => (
            <span className="gantt-legend-item" key={tone}>
              <i className={`gantt-legend-dot ${tone}`} />
              {TONE_LABEL[tone]}
            </span>
          ))}
        </div>
      </div>

      {hasScheduled ? null : (
        <div className="gantt-notice">
          还没有任务填写日期。在任务详情的「开始日期 / 截止日期」里补上，甘特条就会出现在这里。
        </div>
      )}

      <div className="gantt-scroll" ref={scrollRef}>
        <div className="gantt-canvas" style={{ width: canvasWidth }}>
          <div className="gantt-head" style={{ width: canvasWidth }}>
            <div
              className="gantt-head-left"
              style={{ width: LEFT_WIDTH, height: HEAD_TIER_HEIGHT * 2 }}
            >
              <span className="gantt-head-title">任务</span>
              <span className="gantt-head-count">{rows.length} 项</span>
            </div>
            <div className="gantt-head-time" style={{ width: timelineWidth }}>
              <div className="gantt-head-row" style={{ height: HEAD_TIER_HEIGHT }}>
                {tierOne.map((segment) => (
                  <div
                    key={segment.key}
                    className={`gantt-head-cell${segment.isToday ? ' is-today' : ''}`}
                    style={{ width: segment.days * dayWidth }}
                    title={segment.label}
                  >
                    {segment.label}
                  </div>
                ))}
              </div>
              <div
                className="gantt-head-row is-second"
                style={{ height: HEAD_TIER_HEIGHT }}
              >
                {tierTwo.map((segment) => (
                  <div
                    key={segment.key}
                    className={`gantt-head-cell is-unit${segment.isToday ? ' is-today' : ''}`}
                    style={{ width: segment.days * dayWidth }}
                    title={segment.label}
                  >
                    <span className="gantt-head-unit-label">{segment.label}</span>
                    {segment.sub ? (
                      <span className="gantt-head-unit-sub">{segment.sub}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="gantt-body">
            <div
              className="gantt-grid"
              style={{ left: LEFT_WIDTH, width: timelineWidth }}
              aria-hidden="true"
            >
              {gridSize >= GRID_LINE_MIN_WIDTH ? (
                <div
                  className="gantt-grid-days"
                  style={{ backgroundSize: `${gridSize}px 100%` }}
                />
              ) : null}
              {monthSegments.map((segment) => (
                <div
                  key={`grid-${segment.key}`}
                  className="gantt-grid-month"
                  style={{ left: segment.startIdx * dayWidth }}
                />
              ))}
              <div className="gantt-grid-today" style={{ left: todayOffset }} />
            </div>

            {dependencyLinks.length > 0 ? (
              <svg
                className="gantt-deps"
                width={canvasWidth}
                height={rows.length * ROW_HEIGHT}
                style={{ width: canvasWidth, height: rows.length * ROW_HEIGHT }}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="gantt-dep-arrow"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="#7a5af8" />
                  </marker>
                </defs>
                {dependencyLinks.map((link) => (
                  <path key={link.key} d={link.path} className="gantt-dep-line">
                    <title>{link.title}</title>
                  </path>
                ))}
              </svg>
            ) : null}

            {rows.map((row) => {
              const bar = resolveBar(row.task, range.start);
              const tone = barTone(row.task, today);
              // Real overdue days come from the due date, not the bar span —
              // a task with an early start may span many days yet be 1 day late.
              const due = toDay(row.task.fields.due);
              const overdueDays =
                due && due.isBefore(today, 'day') && row.task.fields.due
                  ? -dueDiff(row.task.fields.due, today.toDate())
                  : 0;
              const progress = parseProgress(row.task.fields.progress);
              const baseLabel = bar
                ? row.task.done
                  ? '已完成'
                  : tone === 'overdue'
                    ? `超时 · ${overdueDays} 天`
                    : `${bar.days} 天`
                : '未排期';
              const label =
                progress === null ? baseLabel : `${baseLabel} · ${progress}%`;

              let barStyle: CSSProperties | null = null;
              if (bar) {
                const first = Math.max(0, bar.startIdx);
                const last = Math.min(totalDays - 1, bar.endIdx);
                if (last >= first) {
                  barStyle = {
                    left: first * dayWidth,
                    width: Math.max(MIN_BAR_WIDTH, (last - first + 1) * dayWidth),
                  };
                }
              }

              const tooltip = bar
                ? `${row.code} ${row.task.title}\n${bar.startDate} → ${bar.endDate} · ${bar.days} 天 · ${TONE_LABEL[tone]}${
                    tone === 'overdue' ? ` ${overdueDays} 天` : ''
                  }${progress === null ? '' : ` · 完成 ${progress}%`}${
                    row.task.fields.owner ? ` · ${row.task.fields.owner}` : ''
                  }`
                : `${row.code} ${row.task.title}\n未排期${
                    progress === null ? '' : ` · 完成 ${progress}%`
                  }`;

              // A label clipped to "已…" reads worse than no label at all.
              const barWidth = typeof barStyle?.width === 'number' ? barStyle.width : 0;
              const showLabel = barWidth >= 46;

              return (
                <div
                  className={`gantt-row${row.task.done ? ' is-done' : ''}`}
                  key={row.task.id}
                  style={{ width: canvasWidth, height: ROW_HEIGHT }}
                >
                  <div
                    className="gantt-cell-left"
                    style={{ width: LEFT_WIDTH, paddingLeft: 8 + row.level * 14 }}
                    role="button"
                    tabIndex={0}
                    title={row.task.title}
                    onClick={() => openTask(row.task.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openTask(row.task.id);
                      }
                    }}
                  >
                    {row.hasChildren ? (
                      <button
                        type="button"
                        className="gantt-chevron"
                        aria-label={row.expanded ? '收起子任务' : '展开子任务'}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCollapsed(row.task.id);
                        }}
                      >
                        <CaretRightOutlined className={row.expanded ? 'is-open' : ''} />
                      </button>
                    ) : (
                      <span className="gantt-chevron-spacer" />
                    )}

                    <span
                      className="gantt-check"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={row.task.done}
                        onChange={() => handleToggleDone(row.task)}
                      />
                    </span>

                    <span className="gantt-code">{row.code}</span>
                    <span className="gantt-row-title">{row.task.title}</span>
                  </div>

                  <div
                    className="gantt-cell-time"
                    style={{ width: timelineWidth, height: ROW_HEIGHT }}
                  >
                    {barStyle ? (
                      <button
                        type="button"
                        className={`gantt-bar is-${tone}${
                          progress === null ? ' no-progress' : ''
                        }${bar && bar.days === 1 ? ' is-milestone' : ''}${
                          row.hasChildren ? ' is-summary' : ''
                        }`}
                        style={barStyle}
                        title={tooltip}
                        aria-label={tooltip}
                        onClick={() => openTask(row.task.id)}
                      >
                        {progress !== null && progress > 0 ? (
                          <span
                            className="gantt-bar-progress"
                            style={{ width: `${progress}%` }}
                            aria-hidden="true"
                          />
                        ) : null}
                        <span className="gantt-bar-label">{showLabel ? label : ''}</span>
                      </button>
                    ) : (
                      <span className="gantt-unscheduled" title={tooltip}>
                        {bar ? `${bar.startDate} 起` : '未排期'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
