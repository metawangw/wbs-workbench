import { App as AntApp, Button, Popover, Tooltip } from 'antd';
import type { CSSProperties } from 'react';
import {
  BgColorsOutlined,
  CheckOutlined,
  CloseOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';
import {
  dueBadge,
  isLockedProjectStatus,
  type FocusTask,
  type ProjectSummary,
} from '@wbs/shared';
import { useStore } from '../store';
import { InlineMarkdown } from './atoms';

/** Soft paper colours used when a sticker has no explicit background. */
const PAPER_COLORS = [
  '#FFF3C4',
  '#E3EEFF',
  '#DFF5E5',
  '#FBE4EF',
  '#E9E4FF',
  '#FFE6D5',
  '#F1F5F9',
];

/** Stable paper colour per task id, so closing one note never recolours others. */
function paperIndex(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) % 9973;
  }
  return hash % PAPER_COLORS.length;
}

/** Pick light or dark ink so custom paper colours stay readable. */
function inkFor(background: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(background);
  if (!match) return '#1f2937';
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 132 ? '#f8fafc' : '#1f2937';
}

function NoteActions({
  project,
  task,
  paper,
}: {
  project: ProjectSummary;
  task: FocusTask;
  paper: string;
}) {
  const setFocusColor = useStore((state) => state.setFocusColor);
  const toggleFocus = useStore((state) => state.toggleFocus);
  const { message } = AntApp.useApp();
  const locked = isLockedProjectStatus(project.status);

  const color = (next: string) => {
    if (locked) {
      message.info('项目已归档或终止，仅可修改项目信息');
      return;
    }
    void setFocusColor(project.id, task.id, next).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '设置底色失败');
    });
  };

  const dismiss = () => {
    if (locked) {
      message.info('项目已归档或终止，仅可修改项目信息');
      return;
    }
    void toggleFocus(project.id, task.id, true)
      .then(() => message.success('已从今日关注移除'))
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : '移除失败');
      });
  };

  return (
    <span className="focus-note-actions" onClick={(event) => event.stopPropagation()}>
      <Popover
        trigger="click"
        placement="bottomRight"
        title="贴纸底色"
        content={
          <div className="focus-palette">
            <div className="focus-palette-grid">
              {PAPER_COLORS.map((option) => (
                <button
                  type="button"
                  key={option}
                  title={option}
                  className={`focus-palette-swatch${
                    paper.toLowerCase() === option.toLowerCase() ? ' is-active' : ''
                  }`}
                  style={{ background: option }}
                  onClick={() => color(option)}
                >
                  {paper.toLowerCase() === option.toLowerCase() ? <CheckOutlined /> : null}
                </button>
              ))}
            </div>
            <div className="focus-palette-foot">
              <label className="focus-palette-custom">
                自定义
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(paper) ? paper : '#fff3c4'}
                  onChange={(event) => color(event.target.value)}
                />
              </label>
              <button type="button" className="focus-palette-reset" onClick={() => color('')}>
                自动
              </button>
            </div>
          </div>
        }
      >
        <button type="button" className="focus-note-icon" aria-label="设置贴纸底色" disabled={locked}>
          <BgColorsOutlined />
        </button>
      </Popover>
      <Tooltip title="从今日关注移除">
        <button
          type="button"
          className="focus-note-icon"
          aria-label="从今日关注移除"
          disabled={locked}
          onClick={dismiss}
        >
          <CloseOutlined />
        </button>
      </Tooltip>
    </span>
  );
}

function FocusNote({
  project,
  task,
  paper,
}: {
  project: ProjectSummary;
  task: FocusTask;
  paper: string;
}) {
  const openFocusTask = useStore((state) => state.openFocusTask);
  const due = dueBadge(task.due);
  const ink = inkFor(paper);

  const open = () => openFocusTask(project.id, task.id);

  return (
    <article
      className={`focus-note${task.done ? ' is-done' : ''}`}
      style={{ background: paper, '--ink': ink } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`${task.code} ${task.title}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="focus-note-head">
        <span className="focus-note-code">{task.code}</span>
        {task.done ? <span className="focus-note-done">已完成</span> : null}
        <NoteActions project={project} task={task} paper={paper} />
      </div>

      <h3 className="focus-note-title" title={task.title}>
        {task.title}
      </h3>

      {task.latest ? (
        <p className="focus-note-latest" title={`${task.latestDate ?? ''} ${task.latest}`}>
          <InlineMarkdown text={task.latest} />
        </p>
      ) : null}

      <div className="focus-note-foot">
        {task.priority ? (
          <span className={`focus-note-priority tone-${task.priority.toLowerCase()}`}>
            {task.priority}
          </span>
        ) : null}
        {task.owner ? <span>@{task.owner}</span> : null}
        {due ? (
          <span className={`focus-note-due tone-${due.tone}`}>{due.label}</span>
        ) : null}
        {!task.owner && !due && !task.priority ? <span>—</span> : null}
      </div>
    </article>
  );
}

export default function FocusBoard({
  projects,
  onShowProjects,
}: {
  projects: ProjectSummary[];
  onShowProjects: () => void;
}) {
  const columns = projects.filter((project) => (project.focusTasks?.length ?? 0) > 0);

  if (columns.length === 0) {
    return (
      <div className="focus-empty">
        <div className="focus-empty-icon">
          <PushpinOutlined />
        </div>
        <h3>今日关注还是空的</h3>
        <p>
          在项目列表（列表视图）中悬停任务，点击任务编号后的图钉标记，
          它就会以贴纸形式投射到这里。
        </p>
        <Button onClick={onShowProjects}>去项目列表</Button>
      </div>
    );
  }

  return (
    <div className="focus-board">
      {columns.map((project) => {
        const tasks = project.focusTasks ?? [];
        return (
          <section className="focus-col" key={project.id}>
            <header className="focus-col-head">
              <PushpinFilled className="focus-col-pin" />
              <span className="focus-col-name" title={project.name}>
                {project.name}
              </span>
            </header>
            <div className="focus-col-body">
              {tasks.map((task) => {
                const paper = task.color || PAPER_COLORS[paperIndex(task.id)];
                return (
                  <FocusNote
                    key={task.id}
                    project={project}
                    task={task}
                    paper={paper}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
