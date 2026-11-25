import { useMemo, useState } from 'react';
import { App as AntApp, Button, Modal, Tag, Tooltip } from 'antd';
import {
  AccountBookOutlined,
  EditOutlined,
  FileTextOutlined,
  FlagOutlined,
  HolderOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  PROJECT_PAGE_LABELS,
  buildTaskRefIndex,
  lookupTaskRef,
  normalizeProjectPageOrder,
  type ProjectPageKey,
} from '@wbs/shared';
import MarkdownText, { type EmbedResolver, type ImageResolver } from './MarkdownText';
import { ProjectStatusChip } from './atoms';
import { taskRefCardHtml } from '../lib/taskRef';
import { useStore } from '../store';

const PAGE_ICONS: Record<ProjectPageKey, React.ReactNode> = {
  intro: <FileTextOutlined />,
  milestone: <FlagOutlined />,
  risk: <WarningOutlined />,
  cost: <AccountBookOutlined />,
  stakeholder: <TeamOutlined />,
};

/**
 * 项目信息弹窗：点击项目名称时打开。
 *
 * 简介、里程碑、风险、成本、相关方 全部铺在**一个页面**里顺序阅读（不再分
 * Tab），没有录入内容的板块直接不显示；各板块的先后
 * 顺序可在标题上拖动调整，顺序写回项目 Front Matter 的 `pageOrder`，因此
 * 顶部的页面按钮也跟着同一顺序排列。
 */
export default function ProjectDetailModal() {
  const open = useStore((state) => state.projectDetailOpen);
  const detailId = useStore((state) => state.projectDetailId);
  const close = useStore((state) => state.closeProjectDetail);
  const projects = useStore((state) => state.projects);
  const active = useStore((state) => state.project);
  const setView = useStore((state) => state.setView);
  const setProjectPageOrder = useStore((state) => state.setProjectPageOrder);
  const jumpToTask = useStore((state) => state.jumpToTask);
  const { message } = AntApp.useApp();

  const [dragKey, setDragKey] = useState<ProjectPageKey | null>(null);
  const [overKey, setOverKey] = useState<ProjectPageKey | null>(null);

  const isActive = Boolean(detailId) && active?.id === detailId;
  const target = useMemo<
    | {
        id: string;
        name: string;
        code?: string;
        status?: string;
        tags?: string[];
        pages?: Partial<Record<ProjectPageKey, string>>;
        pageOrder?: ProjectPageKey[];
      }
    | null
  >(() => {
    if (!detailId) return null;
    if (isActive && active) {
      return {
        id: active.id,
        name: active.name,
        code: active.code,
        status: active.status,
        tags: active.tags,
        pages: active.pages,
        pageOrder: active.pageOrder,
      };
    }
    const summary = projects.find((project) => project.id === detailId);
    return summary
      ? {
          id: summary.id,
          name: summary.name,
          code: summary.code,
          status: summary.status,
          tags: summary.tags,
          // 未打开的项目只有摘要，简介从 description 带过来即可展示。
          pages: summary.description?.trim()
            ? { intro: summary.description }
            : undefined,
          pageOrder: undefined,
        }
      : null;
  }, [detailId, projects, active, isActive]);

  const resolveImage = useMemo<ImageResolver | undefined>(() => {
    if (!target) return undefined;
    const baseUrl = `/api/projects/${encodeURIComponent(target.id)}/images/`;
    return (raw: string) => {
      const match = /^([^|]+)(?:\|(\d+))?$/.exec(raw.trim());
      if (!match) return null;
      const file = match[1].trim();
      if (!file) return null;
      return {
        src: `${baseUrl}${encodeURIComponent(file)}`,
        width: match[2] ? Number(match[2]) : undefined,
      };
    };
  }, [target?.id]);

  const order = useMemo(
    () => normalizeProjectPageOrder(target?.pageOrder),
    [target?.pageOrder],
  );

  // `![[2.1]]` → 任务卡片。只有打开的是当前项目时才有任务树可用。
  const refIndex = useMemo(
    () => buildTaskRefIndex(isActive && active ? active.roots : []),
    [isActive, active?.roots],
  );

  const resolveTask = useMemo<EmbedResolver | undefined>(() => {
    if (!isActive || !active) return undefined;
    return (raw) => {
      const hit = lookupTaskRef(refIndex, raw);
      return hit ? taskRefCardHtml(hit.task, hit.code) : null;
    };
  }, [isActive, active?.id, refIndex]);

  const openTaskRef = (taskId: string) => {
    close();
    jumpToTask(taskId);
  };

  const openPage = (key: ProjectPageKey) => {
    close();
    setView(key);
  };

  // 只有真正录入了内容的板块才显示（含「简介」）。
  const sections = order
    .map((key) => ({ key, text: target?.pages?.[key]?.trim() ?? '' }))
    .filter((section) => section.text.length > 0);

  const isEmpty = sections.length === 0;

  const movePage = (source: ProjectPageKey, targetKey: ProjectPageKey) => {
    if (!isActive || source === targetKey) return;
    const next = [...order];
    const from = next.indexOf(source);
    const to = next.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, source);
    void setProjectPageOrder(next).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '保存顺序失败');
    });
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      width="68vw"
      className="project-detail-modal workspace-modal"
      title={
        <span className="modal-title-row">
          <span className="modal-title">{target?.name ?? '项目信息'}</span>
          {target?.code ? <span className="code-chip">{target.code}</span> : null}
          <ProjectStatusChip status={target?.status} />
        </span>
      }
    >
      {target?.tags?.length ? (
        <div className="project-detail-tags">
          <span className="project-detail-tags-label">标签</span>
          {target.tags.map((tag) => (
            <Tag key={tag} className="project-detail-tag">
              {tag}
            </Tag>
          ))}
        </div>
      ) : null}

      <div className="pd-body">
        {sections.map((section) => {
          const key = section.key;
          const dragging = dragKey === key;
          const hovered = overKey === key && dragKey !== null && dragKey !== key;
          return (
            <section
              key={key}
              className={`pd-section${dragging ? ' is-dragging' : ''}${hovered ? ' is-drop' : ''}`}
              onDragOver={(event) => {
                if (!isActive || !dragKey) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (overKey !== key) setOverKey(key);
              }}
              onDragLeave={() => {
                if (overKey === key) setOverKey(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragKey) movePage(dragKey, key);
                setDragKey(null);
                setOverKey(null);
              }}
            >
              <h3
                className="pd-section-title is-draggable"
                draggable={isActive}
                title={isActive ? '拖动标题可调整这一块的先后顺序' : undefined}
                onDragStart={(event) => {
                  if (!isActive) return;
                  setDragKey(key);
                  event.dataTransfer.effectAllowed = 'move';
                  // Firefox 需要写入数据，拖拽才会真正开始。
                  event.dataTransfer.setData('text/plain', key);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setOverKey(null);
                }}
              >
                {isActive ? (
                  <span className="pd-drag" aria-hidden="true">
                    <HolderOutlined />
                  </span>
                ) : null}
                {PAGE_ICONS[key]}
                <span>{PROJECT_PAGE_LABELS[key]}</span>
                {isActive ? (
                  <Tooltip title="打开这一页并编辑">
                    <Button
                      className="pd-section-edit"
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        openPage(key);
                      }}
                    >
                      <span className="btn-label">编辑</span>
                    </Button>
                  </Tooltip>
                ) : null}
              </h3>
              <div className="pd-section-body">
                <MarkdownText
                  text={section.text}
                  resolveImage={resolveImage}
                  resolveTask={resolveTask}
                  onTaskClick={openTaskRef}
                  className="project-detail-md"
                />
              </div>
            </section>
          );
        })}

        {isEmpty ? (
          <div className="project-detail-empty pd-empty">
            <FileTextOutlined className="pd-empty-icon" />
            <div>还没有简介、里程碑、风险、成本、相关方内容</div>
            {isActive ? (
              <Button icon={<EditOutlined />} onClick={() => openPage('intro')}>
                编辑简介
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="project-detail-foot">
        <FileTextOutlined />
        <span>
          内容都保存在项目 Markdown 内；拖动板块标题可调整顺序，顺序写入 Front Matter
        </span>
      </div>
    </Modal>
  );
}
