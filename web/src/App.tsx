import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Alert, Button, Drawer, Skeleton } from 'antd';
import { findTask, isLockedProjectStatus, type AppSettings } from '@wbs/shared';
import { SIDEBAR_DEFAULT_WIDTH, useStore } from './store';
import { groupBySection } from './lib/filters';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import ProjectView from './components/ProjectView';
import OverviewPage from './components/OverviewPage';
import TaskDrawer from './components/TaskDrawer';
import NewTaskModal from './components/NewTaskModal';
import NewProjectModal from './components/NewProjectModal';
import NewFolderModal from './components/NewFolderModal';
import ProjectEditModal from './components/ProjectEditModal';
import ProjectDetailModal from './components/ProjectDetailModal';
import SettingsModal from './components/SettingsModal';
import { Onboarding } from './components/EmptyStates';

function LoadingState() {
  return (
    <div className="loading-state">
      <Skeleton active title={{ width: 260 }} paragraph={{ rows: 2 }} />
      <div className="loading-cards">
        <div className="loading-card" />
        <div className="loading-card" />
        <div className="loading-card" />
      </div>
      <Skeleton active paragraph={{ rows: 6 }} />
    </div>
  );
}

export default function App() {
  const init = useStore((state) => state.init);
  const page = useStore((state) => state.page);
  const project = useStore((state) => state.project);
  const projects = useStore((state) => state.projects);
  const loadingProject = useStore((state) => state.loadingProject);
  const loadingProjects = useStore((state) => state.loadingProjects);
  const error = useStore((state) => state.error);
  const dataDir = useStore((state) => state.dataDir);
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const sidebarAutoHide = useStore((state) => state.sidebarAutoHide);
  const sidebarWidth = useStore((state) => state.sidebarWidth);
  const setSidebarWidth = useStore((state) => state.setSidebarWidth);
  const brand = useStore((state) => state.brand);
  const [navOpen, setNavOpen] = useState(false);
  // Auto-hide mode: the sidebar leaves the layout and only slides in while the
  // pointer sits on the left edge (or on the panel itself).
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Drag the 4px handle on the sidebar's right edge to widen/narrow it.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    document.body.classList.add('is-resizing-sidebar');

    const onMove = (moveEvent: PointerEvent) => {
      const start = resizeRef.current;
      if (!start) return;
      setSidebarWidth(start.startWidth + (moveEvent.clientX - start.startX));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const sidebarResizer = (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整项目栏宽度"
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={startResize}
      onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
    />
  );

  useEffect(() => {
    if (!sidebarAutoHide) {
      setSidebarPeek(false);
      return;
    }
    // Track the pointer globally: opening is limited to the 12px edge strip,
    // while closing waits until the pointer leaves the whole panel. A global
    // listener also survives the panel sliding in under a still cursor, which
    // per-element mouseenter/mouseleave does not.
    const PANEL_WIDTH = sidebarWidth;
    const EDGE = 12;
    const onMove = (event: MouseEvent) => {
      const x = event.clientX;
      setSidebarPeek((previous) =>
        previous ? x < PANEL_WIDTH + 6 : x <= EDGE,
      );
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [sidebarAutoHide, sidebarWidth]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    // `?nostream=1` is an escape hatch for headless screenshots or browsers
    // where an idle SSE connection is undesirable. Normal usage always streams.
    if (new URLSearchParams(window.location.search).has('nostream')) return;

    const source = new EventSource('/api/events');
    let timer: number | undefined;

    source.onmessage = (event) => {
      let payload: { type?: string; settings?: AppSettings } = {};
      try {
        payload = event.data ? JSON.parse(event.data) : {};
      } catch {
        /* non-JSON frames are just keep-alives */
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Settings changed in another browser: apply instantly, no refetch.
        if (payload.type === 'settings-changed' && payload.settings) {
          useStore.getState().applyRemoteSettings(payload.settings);
          return;
        }
        void useStore.getState().refreshAll();
      }, 280);
    };

    return () => {
      window.clearTimeout(timer);
      source.close();
    };
  }, []);

  useEffect(() => {
    const brandTitle = brand.title || 'WBS 工作台';
    document.title =
      page === 'overview'
        ? `项目总览 · ${brandTitle}`
        : project
          ? `${project.name} · ${brandTitle}`
          : brandTitle;
  }, [page, project?.name, brand.title]);

  // One-shot deep link: /?project=…&task=… opens the task drawer.
  useEffect(() => {
    if (!project) return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('task');
    if (!requested) return;

    params.delete('task');
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState(null, '', url);

    if (findTask(project.roots, requested)) {
      useStore.getState().openTask(requested);
    }
  }, [project]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, [contenteditable="true"], .ant-select, .ant-picker',
        )
      ) {
        return;
      }

      const state = useStore.getState();

      if (event.key === '/') {
        event.preventDefault();
        document.getElementById('task-search')?.focus();
      }

      if (
        event.key.toLowerCase() === 'n' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !state.drawerTaskId &&
        !state.createDraft.open &&
        state.project &&
        !isLockedProjectStatus(state.project?.status)
      ) {
        event.preventDefault();
        const sections = state.project.sections ?? [];
        if (!sections.length) {
          // 没有分组时维持原行为：建在根目录。
          state.openCreate(null);
        } else {
          // 有分组：从上往下找第一个展开的分组，跳过收起的；全收起时用第一个分组。
          const groups = groupBySection(state.project.roots, sections);
          const target =
            groups.find((group) => !state.collapsedGroups[group.key]) ?? groups[0];
          state.openCreateInSection(target?.key ?? '');
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const retry = () => {
    const state = useStore.getState();
    if (!state.projects.length) void state.init();
    else void state.refreshAll();
  };

  return (
    <div
      className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
      style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
    >
      {sidebarAutoHide ? (
        <>
          <div
            className="sidebar-hover-zone"
            aria-hidden="true"
            onMouseEnter={() => setSidebarPeek(true)}
          />
          <aside
            className={`sidebar desktop-sidebar sidebar-overlay${
              sidebarPeek ? ' is-peek' : ''
            }`}
          >
            <Sidebar />
            {sidebarResizer}
          </aside>
        </>
      ) : !sidebarCollapsed ? (
        <aside className="sidebar desktop-sidebar">
          <Sidebar />
          {sidebarResizer}
        </aside>
      ) : null}

      <main className="main">
        <Topbar
          onMenu={() => setNavOpen(true)}
          onCreate={() => useStore.getState().openCreate(null)}
        />

        <div className="content">
          <div className="content-inner">
            {page === 'overview' ? (
              loadingProjects && !projects.length ? (
                <LoadingState />
              ) : error && !projects.length ? (
                <div className="error-state">
                  <Alert
                    type="error"
                    showIcon
                    message="加载失败"
                    description={error}
                    action={
                      <Button size="small" onClick={retry}>
                        重试
                      </Button>
                    }
                  />
                </div>
              ) : (
                <OverviewPage />
              )
            ) : error && !project ? (
              <div className="error-state">
                <Alert
                  type="error"
                  showIcon
                  message="加载失败"
                  description={error}
                  action={
                    <Button size="small" onClick={retry}>
                      重试
                    </Button>
                  }
                />
              </div>
            ) : loadingProject || (!project && loadingProjects) ? (
              <LoadingState />
            ) : project ? (
              <ProjectView />
            ) : (
              <Onboarding
                dataDir={dataDir}
                onRefresh={() => void useStore.getState().refreshAll()}
              />
            )}
          </div>
        </div>
      </main>

      <Drawer
        placement="left"
        open={navOpen}
        onClose={() => setNavOpen(false)}
        width={292}
        className="mobile-nav"
        styles={{ body: { padding: 0 }, header: { display: 'none' } }}
        title={null}
        closable={false}
      >
        <Sidebar onNavigate={() => setNavOpen(false)} />
      </Drawer>

      <TaskDrawer />
      <NewTaskModal />
      <NewProjectModal />
      <NewFolderModal />
      <ProjectEditModal />
      <ProjectDetailModal />
      <SettingsModal />
    </div>
  );
}
