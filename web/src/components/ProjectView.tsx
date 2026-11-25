import { Button, Tooltip } from 'antd';
import {
  EditOutlined,
  FileAddOutlined,
  PlusOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { isProjectPageKey, type ProjectPageKey } from '@wbs/shared';
import { useStore } from '../store';
import FilterBar from './FilterBar';
import BoardView from './BoardView';
import ListView from './ListView';
import GanttView from './GanttView';
import PageView from './PageView';

export default function ProjectView() {
  const project = useStore((state) => state.project);
  const view = useStore((state) => state.view);
  const openCreate = useStore((state) => state.openCreate);
  const openProjectEdit = useStore((state) => state.openProjectEdit);
  // Global switch: hide the quick settings bar across board / list / gantt.
  const showQuickBar = useStore((state) => state.appearance.showQuickBar !== false);
  // 里程碑 / 风险 / 成本是文档页，不参与任务筛选，也不显示快捷设置栏。
  const pageKey: ProjectPageKey | null = isProjectPageKey(view) ? view : null;

  if (!project) return null;

  const warnings =
    project.warnings.length > 0 ? (
      <Tooltip
        title={
          <div className="warning-tooltip">
            {project.warnings.map((warning, index) => (
              <div key={`${warning}-${index}`}>{warning}</div>
            ))}
          </div>
        }
      >
        <div className="warning-strip">
          <WarningOutlined />
          <span>解析提醒 {project.warnings.length} 条</span>
          <span className="warning-first">{project.warnings[0]}</span>
        </div>
      </Tooltip>
    ) : null;

  // 文档页即使项目还没有任务也要正常展示（简介/里程碑等页面独立存在）。
  if (!pageKey && project.roots.length === 0) {
    return (
      <div className="project-view">
        {warnings}
        <div className="empty-block project-empty">
          <div className="empty-icon">
            <FileAddOutlined />
          </div>
          <h3>项目还没有任务</h3>
          <p>
            添加第一个任务，会自动写入 <code>{project.path}</code>。
          </p>
          <div className="empty-actions">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openCreate(null)}
            >
              新建第一个任务
            </Button>
            <Button icon={<EditOutlined />} onClick={openProjectEdit}>
              编辑项目信息
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="project-view">
      {warnings}
      {showQuickBar && !pageKey ? <FilterBar /> : null}
      {pageKey ? (
        <PageView pageKey={pageKey} />
      ) : view === 'board' ? (
        <BoardView />
      ) : view === 'list' ? (
        <ListView />
      ) : (
        <GanttView />
      )}
    </div>
  );
}
