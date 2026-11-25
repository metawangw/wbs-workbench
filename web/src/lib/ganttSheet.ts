/**
 * Gantt → Excel.
 *
 * Mirrors the on-screen Gantt as closely as a spreadsheet allows: the same
 * rows (filters, collapsed state and「隐藏已完成」 all applied), the same day
 * timeline, and the same colours — priority pills, title-task rows, due-date
 * tones and the four bar tones (已完成 / 进行中 / 未开始 / 已超时).
 */
import dayjs from 'dayjs';
import {
  DEFAULT_P0_COLOR,
  DEFAULT_P1_COLOR,
  DEFAULT_P2_COLOR,
  DEFAULT_TITLE_COLOR,
  dueDiff,
  isTitleTask,
  priorityMeta,
  type AppearanceSettings,
  type ProjectDetail,
  type TaskFields,
} from '@wbs/shared';
import { buildXlsxBlob, type XCell, type XRow, type XSheet, type XStyle } from './xlsx';

export interface GanttExportRow {
  code: string;
  title: string;
  level: number;
  done: boolean;
  hasChildren: boolean;
  fields: TaskFields;
}

export interface GanttSnapshot {
  rows: GanttExportRow[];
  rangeStart: string;
  rangeEnd: string;
}

/**
 * The Gantt view owns zoom / "hide completed" state that only exists inside the
 * component. It publishes a snapshot here so the Topbar menu can export exactly
 * what is on screen without duplicating that state in the store.
 */
let snapshot: GanttSnapshot | null = null;

export function setGanttSnapshot(next: GanttSnapshot | null): void {
  snapshot = next;
}

export function getGanttSnapshot(): GanttSnapshot | null {
  return snapshot;
}

/** Screen colours of the four bar tones (see gantt.css). */
const BAR_TONE: Record<'done' | 'active' | 'planned' | 'overdue', { bg: string; fill: string }> = {
  done: { bg: '#7fd8ad', fill: '#067647' },
  active: { bg: '#a894f0', fill: '#5925dc' },
  planned: { bg: '#8fb4f5', fill: '#175cd3' },
  overdue: { bg: '#f28b82', fill: '#b42318' },
};

const INK = '#101828';
const INK_2 = '#475467';
const INK_3 = '#667085';
const INK_4 = '#98a2b3';
const LINE = '#eaecf0';
const LINE_SOFT = '#f2f4f7';
const SOFT = '#f9fafb';
const DUE_SOON = '#b54708';
const DUE_DANGER = '#b42318';
/** 页面上的「今天」竖线：rgba(217,45,32,.55) */
const TODAY_LINE = '#d92d20';

function parseHex(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Blend a colour towards white — stands in for `color-mix(… , #fff)`. */
function mixWhite(color: string, ratio: number): string {
  const rgb = parseHex(color);
  if (!rgb) return '#f4f5f7';
  const out = rgb.map((channel) => Math.round(channel + (255 - channel) * ratio));
  return `#${out.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function toDay(value?: string): dayjs.Dayjs | null {
  if (!value) return null;
  const parsed = dayjs(value.slice(0, 10));
  return parsed.isValid() ? parsed.startOf('day') : null;
}

function dayDiff(from: dayjs.Dayjs, to: dayjs.Dayjs): number {
  const a = Date.UTC(from.year(), from.month(), from.date());
  const b = Date.UTC(to.year(), to.month(), to.date());
  return Math.round((b - a) / 86_400_000);
}

function parseProgress(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

const RIGHT = 'right';
const CENTER = 'center';

interface CellCtx {
  title: string;
  p: { p0: string; p1: string; p2: string };
}

function headerStyle(ctx: CellCtx): XStyle {
  return {
    bold: true,
    color: INK_3,
    fill: SOFT,
    size: 9,
    middle: true,
    border: { bottom: LINE, top: LINE },
    align: 'center',
  };
}

function rowLabelStyle(ctx: CellCtx, extra: Partial<XStyle> = {}): XStyle {
  return { size: 9.5, middle: true, border: { bottom: LINE_SOFT }, color: INK, ...extra };
}

function priorityStyle(priority: string | undefined, ctx: CellCtx): XStyle {
  if (!priority) return { size: 9, color: INK_4, middle: true, align: CENTER };
  const meta = priorityMeta(priority);
  const color = meta.tone === 'p0' ? ctx.p.p0 : meta.tone === 'p1' ? ctx.p.p1 : meta.tone === 'p2' ? ctx.p.p2 : INK_3;
  return {
    bold: true,
    size: 9,
    color,
    fill: mixWhite(color, 0.9),
    middle: true,
    align: CENTER,
  };
}

function dueStyle(due: string | undefined, done: boolean): XStyle {
  if (!due) return { size: 9, color: INK_4, middle: true, align: CENTER };
  const diff = dueDiff(due);
  if (done) return { size: 9, color: INK_4, middle: true, align: CENTER };
  if (Number.isNaN(diff)) return { size: 9, color: INK_3, middle: true, align: CENTER };
  if (diff < 0) return { size: 9, bold: true, color: DUE_DANGER, middle: true, align: CENTER };
  if (diff <= 3) return { size: 9, bold: true, color: DUE_SOON, middle: true, align: CENTER };
  return { size: 9, color: INK_3, middle: true, align: CENTER };
}

/** Build the worksheet description for the current Gantt snapshot. */
export function buildGanttSheet(
  project: ProjectDetail,
  snap: GanttSnapshot,
  appearance: AppearanceSettings,
): XSheet {
  const start = toDay(snap.rangeStart) ?? dayjs().startOf('day');
  const end = toDay(snap.rangeEnd) ?? start;
  const totalDays = Math.max(1, dayDiff(start, end) + 1);
  const today = dayjs().startOf('day');
  const todayIdx = dayDiff(start, today);

  const ctx: CellCtx = {
    title: (appearance.titleColor || DEFAULT_TITLE_COLOR).toLowerCase(),
    p: {
      p0: (appearance.p0Color || DEFAULT_P0_COLOR).toLowerCase(),
      p1: (appearance.p1Color || DEFAULT_P1_COLOR).toLowerCase(),
      p2: (appearance.p2Color || DEFAULT_P2_COLOR).toLowerCase(),
    },
  };

  const LEFT_COLUMNS = 8; // 编号 / 任务 / 联系人 / 优先级 / 开始 / 截止 / 工期 / 进度
  const firstTimeCol = LEFT_COLUMNS; // zero-based index of the first day column

  const rows: XRow[] = [];
  const merges: string[] = [];

  const colLetterFor = (index: number): string => {
    let value = index + 1;
    let out = '';
    while (value > 0) {
      const rest = (value - 1) % 26;
      out = String.fromCharCode(65 + rest) + out;
      value = Math.floor((value - 1) / 26);
    }
    return out;
  };
  const lastTimeCol = firstTimeCol + totalDays - 1;

  /* ---- row 1-2: document head ------------------------------------------ */
  const headCells: XCell[] = Array.from({ length: LEFT_COLUMNS + totalDays }, () => ({ v: null }));
  headCells[0] = { v: project.name, s: { bold: true, size: 15, color: INK, middle: true } };
  headCells[firstTimeCol] = {
    v: `${start.format('YYYY-MM-DD')} → ${end.format('YYYY-MM-DD')} · 共 ${totalDays} 天`,
    s: { size: 9, color: INK_4, align: RIGHT, middle: true },
  };
  rows.push({ cells: headCells, height: 26 });
  merges.push(`A1:${colLetterFor(LEFT_COLUMNS - 1)}1`);
  merges.push(`${colLetterFor(firstTimeCol)}1:${colLetterFor(lastTimeCol)}1`);

  const metaBits = [project.code ? `编号 ${project.code}` : '', project.status ?? '', `共 ${snap.rows.length} 行`]
    .filter(Boolean)
    .join(' · ');
  const metaCells: XCell[] = Array.from({ length: LEFT_COLUMNS + totalDays }, () => ({ v: null }));
  metaCells[0] = { v: metaBits, s: { size: 9, color: INK_3, middle: true } };
  metaCells[firstTimeCol] = {
    v: `今日 ${today.format('YYYY-MM-DD')} · 导出自 WBS 工作台`,
    s: { size: 9, color: INK_4, align: RIGHT, middle: true },
  };
  rows.push({ cells: metaCells, height: 16 });
  merges.push(`A2:${colLetterFor(LEFT_COLUMNS - 1)}2`);
  merges.push(`${colLetterFor(firstTimeCol)}2:${colLetterFor(lastTimeCol)}2`);

  /* ---- row 3-4: column head + time axis -------------------------------- */
  const HEAD_LABELS = ['编号', '任务', '联系人', '优先级', '开始', '截止', '工期', '进度'];
  const headRow: XCell[] = HEAD_LABELS.map((label) => ({ v: label, s: headerStyle(ctx) }));
  for (let index = 0; index < totalDays; index += 1) headRow.push({ v: null });
  rows.push({ cells: headRow, height: 16 });
  for (let index = 0; index < LEFT_COLUMNS; index += 1) {
    merges.push(`${colLetterFor(index)}3:${colLetterFor(index)}4`);
  }

  // Month band above the day numbers.
  const monthRow: XCell[] = [
    { v: null },
    { v: null },
    { v: null },
    { v: null },
    { v: null },
    { v: null },
    { v: null },
    { v: null },
  ];
  let cursor = 0;
  while (cursor < totalDays) {
    const day = start.add(cursor, 'day');
    const monthEnd = day.endOf('month').startOf('day');
    const span = Math.min(
      totalDays - cursor,
      dayDiff(day, monthEnd.isAfter(end, 'day') ? end : monthEnd) + 1,
    );
    monthRow.push({
      v:
        cursor === 0 || day.month() === 0
          ? `${day.year()}年${day.month() + 1}月`
          : `${day.month() + 1}月`,
      s: {
        size: 8,
        color: INK_3,
        fill: '#f4f6f9',
        align: CENTER,
        middle: true,
        border: { left: LINE, bottom: LINE_SOFT },
      },
    });
    for (let index = 1; index < span; index += 1) monthRow.push({ v: null });
    if (span > 1) {
      merges.push(
        `${colLetterFor(firstTimeCol + cursor)}3:${colLetterFor(firstTimeCol + cursor + span - 1)}3`,
      );
    }
    cursor += span;
  }
  rows.push({ cells: monthRow, height: 14 });

  const dayRow: XCell[] = [
    { v: null },
    { v: null },
    { v: null },
    { v: null },
    { v: null },
    { v: null },
    { v: null },
    { v: null },
  ];
  for (let index = 0; index < totalDays; index += 1) {
    const day = start.add(index, 'day');
    const isToday = day.isSame(today, 'day');
    const weekend = day.day() === 0 || day.day() === 6;
    dayRow.push({
      v: day.date(),
      s: {
        size: 7.5,
        color: isToday ? '#2563eb' : weekend ? '#c3c9d4' : INK_4,
        bold: isToday,
        fill: isToday ? '#eef4ff' : undefined,
        align: CENTER,
        middle: true,
        border: { right: LINE_SOFT, bottom: LINE, left: index === todayIdx ? TODAY_LINE : undefined },
      },
    });
  }
  rows.push({ cells: dayRow, height: 14 });

  /* ---- data rows ------------------------------------------------------- */
  for (const row of snap.rows) {
    const titleTask = isTitleTask(row.fields);
    const due = toDay(row.fields.due);
    const barStart = toDay(row.fields.start);
    const onlyOne = Boolean(barStart) !== Boolean(due);

    let tone: keyof typeof BAR_TONE = 'active';
    if (row.done) tone = 'done';
    else if (due && due.isBefore(today, 'day')) tone = 'overdue';
    else if (barStart && barStart.isAfter(today, 'day')) tone = 'planned';

    const toneColors = BAR_TONE[tone];
    const barColors = titleTask
      ? { bg: mixWhite(ctx.title, 0.55), fill: ctx.title }
      : toneColors;

    const titleStyle: XStyle = {
      size: 9.5,
      bold: titleTask || row.hasChildren,
      color: row.done ? INK_4 : titleTask ? ctx.title : INK,
      strike: row.done,
      middle: true,
      border: { bottom: LINE_SOFT },
      fill: titleTask ? mixWhite(ctx.title, 0.93) : undefined,
    };
    const codeStyle: XStyle = {
      size: 8.5,
      color: row.done ? '#c3c9d4' : INK_4,
      middle: true,
      align: CENTER,
      border: { bottom: LINE_SOFT },
      fill: titleTask ? mixWhite(ctx.title, 0.93) : undefined,
    };

    const duration = barStart && due ? Math.abs(dayDiff(barStart, due)) + 1 : barStart || due ? 1 : null;

    const cells: XCell[] = [
      { v: row.code, s: codeStyle },
      {
        v: `${'    '.repeat(Math.min(row.level, 6))}${row.title}`,
        s: titleStyle,
      },
      {
        v: row.fields.owner ?? '',
        s: rowLabelStyle(ctx, {
          size: 9,
          color: INK_2,
          align: CENTER,
          fill: titleTask ? mixWhite(ctx.title, 0.93) : undefined,
        }),
      },
      {
        v: row.fields.priority ?? '',
        s: { ...priorityStyle(row.fields.priority, ctx), fill: titleTask ? mixWhite(ctx.title, 0.93) : priorityStyle(row.fields.priority, ctx).fill },
      },
      {
        v: row.fields.start ?? '',
        s: rowLabelStyle(ctx, {
          size: 9,
          color: INK_3,
          align: CENTER,
          fill: titleTask ? mixWhite(ctx.title, 0.93) : undefined,
        }),
      },
      {
        v: row.fields.due ?? '',
        s: { ...dueStyle(row.fields.due, row.done), fill: titleTask ? mixWhite(ctx.title, 0.93) : undefined },
      },
      {
        v: duration ? `${duration} 天` : '—',
        s: rowLabelStyle(ctx, {
          size: 9,
          color: INK_3,
          align: CENTER,
          fill: titleTask ? mixWhite(ctx.title, 0.93) : undefined,
        }),
      },
      {
        v: parseProgress(row.fields.progress) === null ? '—' : `${parseProgress(row.fields.progress)}%`,
        s: rowLabelStyle(ctx, {
          size: 9,
          color: INK_2,
          align: CENTER,
          fill: titleTask ? mixWhite(ctx.title, 0.93) : undefined,
        }),
      },
    ];

    // Timeline cells: light tone for the span, darker tone for the completed part.
    const span = barStart || due
      ? {
          from: Math.min(
            barStart ? dayDiff(start, barStart) : dayDiff(start, due!),
            due ? dayDiff(start, due) : dayDiff(start, barStart!),
          ),
          to: Math.max(
            barStart ? dayDiff(start, barStart) : dayDiff(start, due!),
            due ? dayDiff(start, due) : dayDiff(start, barStart!),
          ),
        }
      : null;

    const progress = parseProgress(row.fields.progress);
    const spanDays = span ? span.to - span.from + 1 : 0;
    const filledDays =
      progress !== null && progress > 0 && spanDays > 0
        ? Math.min(spanDays, Math.max(1, Math.round((spanDays * progress) / 100)))
        : 0;

    for (let index = 0; index < totalDays; index += 1) {
      const inBar = span !== null && index >= span.from && index <= span.to;
      if (inBar) {
        const offset = index - span.from;
        const isFill = filledDays > 0 && offset < filledDays;
        cells.push({
          v: null,
          s: {
            // Single-date markers read as a solid tick, like the on-screen pill.
            fill: onlyOne || isFill ? barColors.fill : barColors.bg,
            ...(index === todayIdx ? { border: { left: TODAY_LINE } } : null),
          },
        });
        continue;
      }
      const day = start.add(index, 'day');
      const weekend = day.day() === 0 || day.day() === 6;
      cells.push({
        v: null,
        s: {
          fill: weekend ? '#fcfcfd' : undefined,
          border: {
            right: LINE_SOFT,
            bottom: LINE_SOFT,
            left: index === todayIdx ? TODAY_LINE : undefined,
          },
        },
      });
    }

    rows.push({ cells, height: titleTask ? 20 : 18 });
  }

  /* ---- legend ---------------------------------------------------------- */
  const legendGap: XCell[] = Array.from({ length: LEFT_COLUMNS + totalDays }, () => ({ v: null }));
  rows.push({ cells: legendGap, height: 10 });

  const legendItems: Array<{ label: string; bg: string; color: string }> = [
    { label: '已完成', bg: BAR_TONE.done.bg, color: BAR_TONE.done.fill },
    { label: '进行中', bg: BAR_TONE.active.bg, color: BAR_TONE.active.fill },
    { label: '未开始', bg: BAR_TONE.planned.bg, color: BAR_TONE.planned.fill },
    { label: '已超时', bg: BAR_TONE.overdue.bg, color: BAR_TONE.overdue.fill },
    { label: '标题类型', bg: mixWhite(ctx.title, 0.55), color: ctx.title },
  ];
  const legendCells: XCell[] = [{ v: '图例', s: { size: 9, color: INK_4, middle: true, align: RIGHT } }];
  for (const item of legendItems) {
    legendCells.push({
      v: item.label,
      s: {
        size: 8.5,
        color: item.color,
        bold: true,
        fill: item.bg,
        align: CENTER,
        middle: true,
        border: { left: '#ffffff', right: '#ffffff' },
      },
    });
  }
  rows.push({ cells: legendCells, height: 16 });

  const columns = [
    { width: 7 },
    { width: 44 },
    { width: 9 },
    { width: 8 },
    { width: 10.5 },
    { width: 10.5 },
    { width: 6.5 },
    { width: 6.5 },
    ...Array.from({ length: totalDays }, () => ({ width: 3.4 })),
  ];

  return {
    name: '甘特图',
    columns,
    rows,
    merges,
    freeze: { xSplit: LEFT_COLUMNS, ySplit: 4, topLeft: `${colLetterFor(LEFT_COLUMNS)}5` },
  };
}

export function buildGanttWorkbook(
  project: ProjectDetail,
  appearance: AppearanceSettings,
): { blob: Blob; filename: string } | null {
  const snap = getGanttSnapshot();
  if (!snap) return null;
  const sheet = buildGanttSheet(project, snap, appearance);
  const name = `${project.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'wbs'}-甘特图`;
  return { blob: buildXlsxBlob(sheet), filename: `${name}.xlsx` };
}
