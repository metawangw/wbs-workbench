import { App as AntApp, Button, Dropdown, Segmented, Tooltip, type MenuProps } from 'antd';
import {
  AppstoreOutlined,
  CodeOutlined,
  EditOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  ProjectOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { api, type ProjectExportFormat } from '../api';
import { useStore, type ViewMode } from '../store';
import { ProjectStatusChip } from './atoms';

/** Trigger a same-origin download for the rendered project document. */
function downloadProject(projectId: string, format: ProjectExportFormat): void {
  const link = document.createElement('a');
  link.href = api.exportProjectUrl(projectId, format);
  link.rel = 'noopener';
  // Ask the browser to download instead of navigating the current tab; the
  // final filename still comes from the server's Content-Disposition header.
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function Topbar({
  onMenu,
  onCreate,
}: {
  onMenu: () => void;
  onCreate: () => void;
}) {
  const page = useStore((state) => state.page);
  const project = useStore((state) => state.project);
  const loadingProject = useStore((state) => state.loadingProject);
  const loadingProjects = useStore((state) => state.loadingProjects);
  const view = useStore((state) => state.view);
  const setView = useStore((state) => state.setView);
  const refreshActive = useStore((state) => state.refreshActive);
  const refreshProjects = useStore((state) => state.refreshProjects);
  const openProjectEdit = useStore((state) => state.openProjectEdit);
  const openNewSection = useStore((state) => state.openNewSection);
  const openProjectDetail = useStore((state) => state.openProjectDetail);
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useStore((state) => state.toggleSidebar);
  const { message } = AntApp.useApp();

  const isOverview = page === 'overview';
  const stats = project?.stats;
  const percent = stats?.total ? Math.round((stats.done / stats.total) * 100) : 0;

  const moreItems: MenuProps['items'] = [
    { key: 'open-file', icon: <FileTextOutlined />, label: '打开任务 Markdown 源文件' },
    { key: 'open-folder', icon: <FolderOpenOutlined />, label: '打开文件目录' },
    { type: 'divider' },
    { key: 'export-html', icon: <CodeOutlined />, label: '另存为 HTML' },
    { key: 'export-pdf', icon: <FilePdfOutlined />, label: '另存为 PDF' },
  ];

  const handleMoreClick: MenuProps['onClick'] = ({ key }) => {
    if (!project) return;
    const projectId = project.id;

    if (key === 'export-html' || key === 'export-pdf') {
      downloadProject(projectId, key === 'export-html' ? 'html' : 'pdf');
      return;
    }

    void (async () => {
      try {
        if (key === 'open-file') {
          await api.openProjectFile(projectId);
          message.success('已用默认程序打开 Markdown 源文件');
        } else if (key === 'open-folder') {
          await api.openProjectFolder(projectId);
          message.success('已在文件管理器中打开目录');
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : '操作失败');
      }
    })();
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Button
          className="mobile-menu"
          type="text"
          icon={<MenuOutlined />}
          onClick={onMenu}
          aria-label="打开项目导航"
        />
        <Button
          className="sidebar-toggle"
          type="text"
          icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        />
        <div className="topbar-heading">
          {isOverview ? (
            <div className="topbar-title-row">
              <h1>项目总览</h1>
              <span className="topbar-sep" />
              <div className="topbar-stats">
                <span className="topbar-stat">本地 Markdown · 项目组合视图</span>
              </div>
            </div>
          ) : (
            <div className="topbar-title-row">
              <h1
                className="project-title-click"
                role="button"
                tabIndex={0}
                title="点击查看项目详情"
                onClick={() => project && openProjectDetail(project.id)}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && project) {
                    event.preventDefault();
                    openProjectDetail(project.id);
                  }
                }}
              >
                {project?.name ?? 'WBS 工作台'}
              </h1>
              {project?.code ? <span className="code-chip">{project.code}</span> : null}
              <ProjectStatusChip status={project?.status} />
              <Tooltip title="编辑项目信息">
                <Button
                  className="project-edit-btn"
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={openProjectEdit}
                  disabled={!project}
                  aria-label="编辑项目信息"
                />
              </Tooltip>

              <span className="topbar-sep" />

              <div className="topbar-stats">
                {project && stats ? (
                  <>
                    <span className="topbar-stat">
                      共 <b>{stats.total}</b> 条
                    </span>
                    <span className="stat-sep">·</span>
                    <span className="topbar-stat">
                      未完成 <b>{stats.open}</b>
                    </span>
                    <span className="stat-sep">·</span>
                    <span className={`topbar-stat${stats.p0 > 0 ? ' is-danger' : ''}`}>
                      P0 <b>{stats.p0}</b>
                    </span>
                    {stats.overdue > 0 ? (
                      <>
                        <span className="stat-sep topbar-overdue">·</span>
                        <span className="topbar-stat is-danger topbar-overdue">
                          超时 <b>{stats.overdue}</b>
                        </span>
                      </>
                    ) : null}
                    {stats.today > 0 ? (
                      <>
                        <span className="stat-sep topbar-today">·</span>
                        <span className="topbar-stat is-warning topbar-today">
                          今日 <b>{stats.today}</b>
                        </span>
                      </>
                    ) : null}
                    <span className="stat-sep topbar-completion">·</span>
                    <span className="topbar-stat topbar-completion">
                      完成率 <b>{percent}%</b>
                    </span>
                  </>
                ) : (
                  <span className="topbar-stat">本地 Markdown 项目跟进</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="topbar-actions">
        {isOverview ? (
          <Button
            className="topbar-icon-btn"
            type="text"
            size="small"
            icon={<ReloadOutlined spin={loadingProjects} />}
            onClick={() => void refreshProjects()}
            aria-label="重新读取项目列表"
          />
        ) : (
          <>
            <Segmented
              className="view-switch"
              size="small"
              value={view}
              onChange={(value) => setView(value as ViewMode)}
              options={[
                {
                  value: 'board',
                  label: (
                    <span className="segment-label">
                      <AppstoreOutlined />
                      看板
                    </span>
                  ),
                },
                {
                  value: 'list',
                  label: (
                    <span className="segment-label">
                      <UnorderedListOutlined />
                      列表
                    </span>
                  ),
                },
                {
                  value: 'gantt',
                  label: (
                    <span className="segment-label">
                      <ProjectOutlined />
                      甘特图
                    </span>
                  ),
                },
              ]}
            />
            <Tooltip title="重新读取当前项目">
              <Button
                className="topbar-icon-btn"
                type="text"
                size="small"
                icon={<ReloadOutlined spin={loadingProject} />}
                onClick={() => void refreshActive()}
                disabled={!project}
                aria-label="重新读取当前项目"
              />
            </Tooltip>
            <Button
              className="topbar-primary"
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={onCreate}
              disabled={!project}
            >
              <span className="btn-label">新建任务</span>
            </Button>
            <Button
              className="topbar-primary"
              type="primary"
              size="small"
              icon={<FolderAddOutlined />}
              onClick={() => {
                // Group management lives in the list view; make sure its
                // modal host is mounted before raising the store flag.
                setView('list');
                openNewSection();
              }}
              disabled={!project}
            >
              <span className="btn-label">新建分组</span>
            </Button>
            <Dropdown
              menu={{ items: moreItems, onClick: handleMoreClick }}
              trigger={['click']}
              placement="bottomRight"
              disabled={!project}
            >
              <Button
                className="topbar-icon-btn"
                type="text"
                size="small"
                icon={<MoreOutlined />}
                disabled={!project}
                aria-label="更多操作"
              />
            </Dropdown>
          </>
        )}
      </div>
    </header>
  );
}
