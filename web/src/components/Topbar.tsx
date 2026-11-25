import { useMemo, useState } from 'react';
import { App as AntApp, Button, Dropdown, Segmented, type MenuProps } from 'antd';
import {
  AccountBookOutlined,
  AppstoreOutlined,
  CodeOutlined,
  ColumnWidthOutlined,
  EditOutlined,
  FilePdfOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  FlagOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  ProjectOutlined,
  PushpinOutlined,
  ReloadOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  PROJECT_PAGE_KEYS,
  PROJECT_PAGE_LABELS,
  isProjectPageKey,
  normalizeProjectPageOrder,
  type ProjectPageKey,
} from '@wbs/shared';
import { api } from '../api';
import { useStore, type SidebarMode, type ViewMode } from '../store';
import { buildProjectDocument, buildViewDocument } from '../lib/exportDoc';
import { buildGanttWorkbook } from '../lib/ganttSheet';
import { ProjectStatusChip } from './atoms';

/** Hand a generated blob to the browser as a file download. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Snapshot exactly what the current view shows, as a standalone document. */
function buildExport() {
  const state = useStore.getState();
  if (!state.project) return null;
  return buildViewDocument({
    project: state.project,
    view: isProjectPageKey(state.view) ? 'list' : state.view,
    filters: state.filters,
    boardTypes: state.boardTypes,
    collapsed: state.collapsed,
    listColumns: state.listColumns,
    appearance: state.appearance,
    statuses: state.statuses,
  });
}

/** 简介 / 里程碑 / 风险 / 成本 / 相关方 五个文档页的入口（排在看板切换之前）。 */
const PAGE_ICONS: Record<ProjectPageKey, React.ReactNode> = {
  intro: <FileTextOutlined />,
  milestone: <FlagOutlined />,
  risk: <WarningOutlined />,
  cost: <AccountBookOutlined />,
  stakeholder: <TeamOutlined />,
};

const PAGE_TABS = PROJECT_PAGE_KEYS.map((key) => ({
  key,
  label: PROJECT_PAGE_LABELS[key],
  icon: PAGE_ICONS[key],
}));

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
  const sidebarAutoHide = useStore((state) => state.sidebarAutoHide);
  const setSidebarMode = useStore((state) => state.setSidebarMode);
  const { message } = AntApp.useApp();

  // 页面按钮按项目里的 pageOrder 排列，与项目详情保持一致。
  const pageTabs = useMemo(() => {
    const order = normalizeProjectPageOrder(project?.pageOrder);
    return [...PAGE_TABS].sort(
      (a, b) => order.indexOf(a.key) - order.indexOf(b.key),
    );
  }, [project?.pageOrder]);

  const setProjectPageOrder = useStore((state) => state.setProjectPageOrder);
  const [dragPage, setDragPage] = useState<ProjectPageKey | null>(null);
  const [overPage, setOverPage] = useState<ProjectPageKey | null>(null);

  /**
   * 顶栏按钮之间拖动排序，与项目详情里拖动板块标题是同一个动作：
   * 写回 Front Matter 的 pageOrder，两处顺序始终一致。
   */
  const movePage = (source: ProjectPageKey, targetKey: ProjectPageKey) => {
    if (!project || source === targetKey) return;
    const current = normalizeProjectPageOrder(project.pageOrder);
    const from = current.indexOf(source);
    const to = current.indexOf(targetKey);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, source);
    void setProjectPageOrder(next).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '保存顺序失败');
    });
  };

  const isOverview = page === 'overview';
  const sidebarMode: SidebarMode = sidebarAutoHide
    ? 'autohide'
    : sidebarCollapsed
      ? 'collapse'
      : 'pin';

  // Only offer the modes that would actually change something: the one already
  // in effect is dropped from the menu instead of being listed as a no-op.
  const sidebarMenuItems: MenuProps['items'] = (() => {
    const pin = { key: 'pin', icon: <PushpinOutlined />, label: '常驻显示' };
    const collapse = {
      key: 'collapse',
      icon: <MenuFoldOutlined />,
      label: '收起侧边栏',
    };
    const autohide = {
      key: 'autohide',
      icon: <ColumnWidthOutlined />,
      label: '自动隐藏（鼠标移到左侧滑出）',
    };

    const items: NonNullable<MenuProps['items']> = [pin, collapse].filter(
      (item) => item.key !== sidebarMode,
    );
    if (sidebarMode !== 'autohide') {
      if (items.length) items.push({ type: 'divider' });
      items.push(autohide);
    }
    return items;
  })();
  const stats = project?.stats;
  const percent = stats?.total ? Math.round((stats.done / stats.total) * 100) : 0;

  const moreItems: MenuProps['items'] = [
    {
      key: 'new-task',
      icon: <PlusOutlined />,
      label: (
        <span className="menu-item-row">
          <span>新建任务</span>
          <kbd className="menu-kbd">n</kbd>
        </span>
      ),
    },
    { key: 'new-section', icon: <FolderAddOutlined />, label: '新建分组' },
    { type: 'divider' },
    { key: 'open-file', icon: <FileTextOutlined />, label: '打开任务 Markdown 源文件' },
    { key: 'open-folder', icon: <FolderOpenOutlined />, label: '打开文件目录' },
    { type: 'divider' },
    { key: 'export-html', icon: <CodeOutlined />, label: '另存为 HTML（所见即所得）' },
    { key: 'export-pdf', icon: <FilePdfOutlined />, label: '另存为 PDF（所见即所得）' },
    { type: 'divider' },
    {
      key: 'export-full-html',
      icon: <FileTextOutlined />,
      label: '导出项目完整信息（HTML）',
    },
    {
      key: 'export-full-pdf',
      icon: <FilePdfOutlined />,
      label: '导出项目完整信息（PDF）',
    },
    ...(view === 'gantt'
      ? ([
          { type: 'divider' as const },
          {
            key: 'export-xlsx',
            icon: <FileExcelOutlined />,
            label: '另存为 Excel（甘特图）',
          },
        ] satisfies MenuProps['items'])
      : []),
  ];

  const handleMoreClick: MenuProps['onClick'] = ({ key }) => {
    if (!project) return;
    const projectId = project.id;

    if (key === 'new-task') {
      onCreate();
      return;
    }
    if (key === 'new-section') {
      // 分组管理在列表视图里，先切过去再打开弹窗。
      setView('list');
      openNewSection();
      return;
    }

    if (key === 'export-xlsx') {
      const state = useStore.getState();
      const book = state.project
        ? buildGanttWorkbook(state.project, state.appearance)
        : null;
      if (!book) {
        message.warning('甘特图还没准备好，请稍后再试');
        return;
      }
      downloadBlob(book.blob, book.filename);
      message.success('已导出甘特图 Excel');
      return;
    }

    if (key === 'export-full-html' || key === 'export-full-pdf') {
      const state = useStore.getState();
      const doc = state.project
        ? buildProjectDocument({
            project: state.project,
            appearance: state.appearance,
            statuses: state.statuses,
          })
        : null;
      if (!doc) return;

      if (key === 'export-full-html') {
        downloadBlob(
          new Blob([doc.html], { type: 'text/html;charset=utf-8' }),
          `${doc.name}.html`,
        );
        message.success('已导出项目完整信息（HTML）');
        return;
      }

      void (async () => {
        const hide = message.loading('正在生成 PDF…', 0);
        try {
          const pdf = await api.exportPdfFromHtml(doc.html, doc.name);
          downloadBlob(pdf, `${doc.name}.pdf`);
          hide();
          message.success('项目完整信息 PDF 已导出');
        } catch (error) {
          hide();
          message.error(error instanceof Error ? error.message : 'PDF 导出失败');
        }
      })();
      return;
    }

    if (key === 'export-html' || key === 'export-pdf') {
      const doc = buildExport();
      if (!doc) return;

      if (key === 'export-html') {
        downloadBlob(
          new Blob([doc.html], { type: 'text/html;charset=utf-8' }),
          `${doc.name}.html`,
        );
        message.success(`已导出当前${doc.layout === 'board' ? '看板' : '列表'}为 HTML`);
        return;
      }

      void (async () => {
        const hide = message.loading('正在生成 PDF…', 0);
        try {
          const pdf = await api.exportPdfFromHtml(doc.html, doc.name);
          downloadBlob(pdf, `${doc.name}.pdf`);
          hide();
          message.success('PDF 已导出');
        } catch (error) {
          hide();
          message.error(error instanceof Error ? error.message : 'PDF 导出失败');
        }
      })();
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
        <Dropdown
          trigger={['click']}
          placement="bottomLeft"
          menu={{
            items: sidebarMenuItems,
            onClick: ({ key }) => setSidebarMode(key as SidebarMode),
          }}
        >
          <Button
            className="sidebar-toggle"
            type="text"
            icon={
              sidebarMode === 'pin' ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />
            }
            aria-label="侧边栏显示方式"
          />
        </Dropdown>
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
              <Button
                className="project-edit-btn"
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={openProjectEdit}
                disabled={!project}
                aria-label="编辑项目信息"
              />

              <span className="topbar-sep" />

              <div className="topbar-stats">
                {project && stats ? (
                  <>
                    {/* 常驻侧边栏占地方，只省掉「共 N 条 / 未完成 N」，P0 与完成率始终保留。 */}
                    {sidebarMode !== 'pin' ? (
                      <>
                        <span className="topbar-stat">
                          共 <b>{stats.total}</b> 条
                        </span>
                        <span className="stat-sep">·</span>
                        <span className="topbar-stat">
                          未完成 <b>{stats.open}</b>
                        </span>
                        <span className="stat-sep">·</span>
                      </>
                    ) : null}
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
            <div className="page-tabs" role="tablist" aria-label="项目文档页">
              {pageTabs.map((tab) => {
                const dragging = dragPage === tab.key;
                const dropTarget =
                  overPage === tab.key && dragPage !== null && dragPage !== tab.key;
                return (
                  <div
                    key={tab.key}
                    className={`page-tab-wrap${dragging ? ' is-dragging' : ''}${dropTarget ? ' is-drop' : ''}`}
                    draggable={Boolean(project)}
                    onDragStart={(event) => {
                      if (!project) return;
                      setDragPage(tab.key);
                      event.dataTransfer.effectAllowed = 'move';
                      // Firefox 需要写入数据，拖拽才会真正开始。
                      event.dataTransfer.setData('text/plain', tab.key);
                    }}
                    onDragOver={(event) => {
                      if (!project || !dragPage) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      if (overPage !== tab.key) setOverPage(tab.key);
                    }}
                    onDragLeave={() => {
                      if (overPage === tab.key) setOverPage(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragPage) movePage(dragPage, tab.key);
                      setDragPage(null);
                      setOverPage(null);
                    }}
                    onDragEnd={() => {
                      setDragPage(null);
                      setOverPage(null);
                    }}
                  >
                    <Button
                      type="text"
                      size="small"
                      role="tab"
                      aria-selected={view === tab.key}
                      className={`page-tab${view === tab.key ? ' is-on' : ''}`}
                      icon={tab.icon}
                      onClick={() => setView(tab.key)}
                      disabled={!project}
                    >
                      <span className="btn-label">{tab.label}</span>
                    </Button>
                  </div>
                );
              })}
            </div>
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
            <Button
              className="topbar-icon-btn"
              type="text"
              size="small"
              icon={<ReloadOutlined spin={loadingProject} />}
              onClick={() => void refreshActive()}
              disabled={!project}
              aria-label="重新读取当前项目"
            />
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
