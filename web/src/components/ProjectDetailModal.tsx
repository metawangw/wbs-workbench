import { useMemo } from 'react';
import { Modal } from 'antd';
import MarkdownText, { type ImageResolver } from './MarkdownText';
import { useStore } from '../store';

/**
 * Project detail popup shown when a project name is clicked. Renders the
 * Markdown description with Obsidian `![[…]]` image embeds enabled.
 */
export default function ProjectDetailModal() {
  const open = useStore((state) => state.projectDetailOpen);
  const detailId = useStore((state) => state.projectDetailId);
  const close = useStore((state) => state.closeProjectDetail);
  const projects = useStore((state) => state.projects);
  const active = useStore((state) => state.project);

  const target = useMemo(() => {
    if (!detailId) return null;
    if (active?.id === detailId) {
      return {
        id: active.id,
        name: active.name,
        description: active.description,
      };
    }
    const summary = projects.find((project) => project.id === detailId);
    return summary
      ? {
          id: summary.id,
          name: summary.name,
          description: summary.description,
        }
      : null;
  }, [detailId, projects, active]);

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
  }, [target]);

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      width="66vw"
      className="project-detail-modal workspace-modal"
      title={<span className="modal-title">{target?.name ?? '项目详情'}</span>}
    >
      {target?.description?.trim() ? (
        <MarkdownText
          text={target.description}
          resolveImage={resolveImage}
          className="project-detail-md"
        />
      ) : (
        <div className="project-detail-empty">暂无项目简介</div>
      )}
    </Modal>
  );
}
