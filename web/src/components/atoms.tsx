import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { CalendarOutlined, CheckCircleFilled, TagOutlined } from '@ant-design/icons';
import {
  dueBadge,
  importanceTone,
  priorityMeta,
  splitOwners,
  type ProgressEntry,
} from '@wbs/shared';
import { projectStatusColor } from '../lib/settings';
import { useStore } from '../store';
import MarkdownText from './MarkdownText';

/**
 * 单行展示用的行内 Markdown：只保留 **加粗**、*斜体*、`代码`、[链接]、
 * ~~删除线~~ 这些行内标记。列表里的最新进展要挤在一行里，块级语法（标题、
 * 列表、表格）的标记符号直接按原文显示，避免撑破行高。
 */
export function InlineMarkdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const rendered = marked.parseInline(text, {
      gfm: true,
      breaks: false,
    }) as string;
    return DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
  }, [text]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

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

export function OwnerChip({ name }: { name?: string }) {
  const owners = splitOwners(name);
  if (owners.length === 0) return null;
  const text = owners.join('、');
  return (
    <span className="owner-chip">
      <span className="owner-name" title={text}>
        {text}
      </span>
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
  // Same visual language as the priority pill: colour carries the meaning,
  // no icon needed.
  return (
    <span
      className={`importance-chip imp-${importanceTone(importance)}`}
      title={`重要性：${importance}`}
    >
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

/** Creation date shown before a task name: calendar icon + short MM-DD. */
export function CreatedChip({ created }: { created?: string }) {
  if (!created || !/^\d{4}-\d{2}-\d{2}$/.test(created)) return null;
  return (
    <span className="created-chip" title={`创建日期 ${created}`}>
      <CalendarOutlined />
      <span className="created-chip-date">{created.slice(5)}</span>
    </span>
  );
}

function progressTime(entry: ProgressEntry): string {
  return `${entry.date} ${entry.time ?? ''}`.trim();
}

interface FloatPosition {
  x: number;
  y: number;
}

function clampFloatPosition(x: number, y: number): FloatPosition {
  const margin = 12;
  const width = Math.min(340, window.innerWidth - margin * 2);
  const estimatedHeight = 300;
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
        <span className="latest-progress-text">
          <InlineMarkdown text={latest.text} />
        </span>
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
              <MarkdownText text={latest.text} className="progress-float-md" />
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

/** 普通任务上的「版本」标识：点一下跳到所属版本任务。 */
export function VersionChip({
  title,
  onClick,
}: {
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="version-chip"
      title={`版本：${title}（点击跳转）`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <TagOutlined />
      <span>版本</span>
    </button>
  );
}

/** 版本任务自身的类型标记，跟标题任务一样只是「它是什么」。 */
export function VersionTypeTag() {
  return (
    <span className="version-type-tag">
      <TagOutlined />
      版本
    </span>
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
  const statuses = useStore((state) => state.statuses);
  if (!status) return null;
  const color = projectStatusColor(status, statuses);
  return (
    <span className="status-chip" style={{ '--chip': color } as CSSProperties}>
      <span className="status-chip-dot" />
      {status}
    </span>
  );
}
