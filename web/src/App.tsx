import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Skeleton } from 'antd';
import { findTask, type AppSettings } from '@wbs/shared';
import { useStore } from './store';
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
  const brand = useStore((state) => state.brand);
  const [navOpen, setNavOpen] = useState(false);

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
    document.title =
      page === 'overview'
        ? `项目总览 · ${brand.title}`
        : project
          ? `${project.name} · ${brand.title}`
          : brand.title;
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
        state.project
      ) {
        event.preventDefault();
        state.openCreate(null);
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
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      {!sidebarCollapsed ? (
        <aside className="sidebar desktop-sidebar">
          <Sidebar />
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
