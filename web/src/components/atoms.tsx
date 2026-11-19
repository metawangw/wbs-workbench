import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircleFilled, StarFilled } from '@ant-design/icons';
import {
  dueBadge,
  priorityMeta,
  type ProgressEntry,
} from '@wbs/shared';

export const IMPORTANCE_OPTIONS = ['高', '中', '低'];

/**
 * A two-character Chinese brand glyph used to wrap inside the small square
 * mark (26px sidebar / 42px preview) and get clipped to a single character.
 * Scale the font by glyph count and forbid wrapping so the whole label fits.
 */
export function brandGlyphStyle(icon: string, baseSize: number): CSSProperties {
  const count = Math.max(1, Array.from(icon || 'W').length);
  const ratio = count === 1 ? 1 : count === 2 ? 0.78 : Math.max(0.5, 1.55 / count);
  return {
    fontSize: `calc(${Math.round(baseSize * ratio)}px + var(--fs-bump))`,
    whiteSpace: 'nowrap',
    lineHeight: 1,
  };
}

const AVATAR_COLORS = [
  '#2563eb',
  '#0ea5e9',
  '#12b76a',
  '#f79009',
  '#f04438',
  '#7a5af8',
  '#0ba5ec',
  '#ee46bc',
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function OwnerChip({ name }: { name?: string }) {
  if (!name) return null;
  return (
    <span className="owner-chip">
      <span
        className="owner-avatar"
        style={{ background: avatarColor(name) }}
        aria-hidden="true"
      >
        {name.slice(0, 1)}
      </span>
      <span className="owner-name">{name}</span>
    </span>
  );
}

export function PriorityPill({ priority }: { priority?: string }) {
  if (!priority) return null;
  const meta = priorityMeta(priority);
  return (
    <span className={`prio-pill ${meta.tone}`} title={meta.label}>
      {priority}
    </span>
  );
}

export function ImportanceChip({ importance }: { importance?: string }) {
  if (!importance) return null;
  return (
    <span className="importance-chip" title={`重要性：${importance}`}>
      <StarFilled />
      {importance}
    </span>
  );
}

export function DueChip({ due, done = false }: { due?: string; done?: boolean }) {
  if (!due) return null;

  if (done) {
    return (
      <span className="due-meta completed">
        <span className="due-date">{due}</span>
        <span className="due-sep">·</span>
        <span className="due-label">已完成</span>
      </span>
    );
  }

  const badge = dueBadge(due);
  if (!badge) return null;

  return (
    <span className={`due-meta ${badge.tone}`}>
      <span className="due-date">{due}</span>
      <span className="due-sep">·</span>
      <span className="due-label">{badge.label}</span>
    </span>
  );
}

export function CycleChip({ cycle }: { cycle?: string }) {
  if (!cycle) return null;
  return <span className="cycle-chip">{cycle}</span>;
}

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

interface FloatPosition {
  x: number;
  y: number;
}

function clampFloatPosition(x: number, y: number): FloatPosition {
  const margin = 12;
  const width = Math.min(340, window.innerWidth - margin * 2);
  const estimatedHeight = 170;
  const left = Math.min(
    Math.max(margin, x + 16),
    window.innerWidth - width - margin,
  );
  const top =
    y + estimatedHeight + 18 > window.innerHeight - margin
      ? Math.max(margin, y - estimatedHeight - 12)
      : y + 18;

  return { x: left, y: top };
}

export function LatestProgress({
  progress,
  compact = false,
  inline = false,
}: {
  progress: ProgressEntry[];
  compact?: boolean;
  inline?: boolean;
}) {
  const [position, setPosition] = useState<FloatPosition | null>(null);
  const frame = useRef<number | null>(null);
  const visible = position !== null;

  useEffect(() => {
    if (!visible) return;
    const hide = () => setPosition(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [visible]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  if (!progress.length) return null;

  const latest = [...progress].sort((a, b) =>
    progressTime(b).localeCompare(progressTime(a)),
  )[0];
  const plain = progressPlainText(latest);
  const date = latest.date.slice(5);

  const move = (x: number, y: number) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setPosition(clampFloatPosition(x, y));
    });
  };

  return (
    <>
      <div
        className={`latest-progress${compact ? ' is-compact' : ''}${
          inline ? ' is-inline' : ''
        }`}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') return;
          move(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse') return;
          move(event.clientX, event.clientY);
        }}
        onPointerLeave={() => {
          if (frame.current !== null) {
            cancelAnimationFrame(frame.current);
            frame.current = null;
          }
          setPosition(null);
        }}
      >
        <span className="latest-progress-label">最新进展</span>
        <span className="latest-progress-date">{date}</span>
        <span className="latest-progress-text">{plain}</span>
        {progress.length > 1 ? (
          <span className="latest-progress-count">共 {progress.length} 条</span>
        ) : null}
      </div>

      {position && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="progress-float"
              style={{ left: position.x, top: position.y }}
              role="tooltip"
            >
              <div className="progress-float-head">
                <span className="progress-float-label">最新进展</span>
                <span className="progress-float-date">
                  {latest.date}
                  {latest.time ? ` ${latest.time}` : ''}
                  {latest.author ? ` · ${latest.author}` : ''}
                </span>
              </div>
              <div className="progress-float-text">{plain}</div>
              {progress.length > 1 ? (
                <div className="progress-float-foot">共 {progress.length} 条进展</div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function StatusPill({ done }: { done: boolean }) {
  return (
    <span className={`status-pill ${done ? 'done' : 'open'}`}>
      {done ? <CheckCircleFilled /> : <span className="status-pulse" />}
      {done ? '已完成' : '进行中'}
    </span>
  );
}

export function ProjectStatusChip({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <span className={`status-chip ${statusTone(status)}`}>
      <span className="status-chip-dot" />
      {status}
    </span>
  );
}

export function statusTone(status?: string): 'ok' | 'active' | 'muted' {
  if (!status) return 'muted';
  if (/稳定|运营|完成|正常/.test(status)) return 'ok';
  if (/归档|停止|暂停|下线/.test(status)) return 'muted';
  return 'active';
}
