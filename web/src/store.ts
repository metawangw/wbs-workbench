import { create } from 'zustand';
import {
  collectStats,
  findTask,
  type ProjectDetail,
  type ProjectSummary,
  type TaskFields,
} from '@wbs/shared';
import { api } from './api';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_BRAND,
  cacheSettings,
  loadAppearance,
  loadBrand,
  saveAppearance,
  saveBrand,
  normalizeSettings,
  type AppearanceSettings,
  type AppSettings,
  type BrandSettings,
} from './lib/settings';
import {
  DEFAULT_FILTERS,
  collectExpandableIds,
  type Filters,
} from './lib/filters';

export type ViewMode = 'board' | 'list' | 'gantt';
export type PageMode = 'overview' | 'project';

interface CreateDraft {
  open: boolean;
  parentId: string | null;
  /** Section to place a new root task into ('' = ungrouped). */
  section?: string;
}

interface AppState {
  page: PageMode;
  projects: ProjectSummary[];
  folders: string[];
  activeId: string | null;
  project: ProjectDetail | null;
  dataDir: string;
  builtAt?: string;
  sidebarCollapsed: boolean;
  projectDetailOpen: boolean;
  projectDetailId: string | null;
  loadingProjects: boolean;
  loadingProject: boolean;
  error: string | null;
  view: ViewMode;
  filters: Filters;
  collapsed: Record<string, boolean>;
  drawerTaskId: string | null;
  createDraft: CreateDraft;
  newProjectOpen: boolean;
  /** Folder preselected when opening the new-project modal from a folder. */
  newProjectFolder: string;
  newFolderOpen: boolean;
  projectEditOpen: boolean;
  /** True when the Topbar "新建分组" button has been clicked. */
  sectionModalOpen: boolean;
  /** Obsidian-style settings dialog. */
  settingsOpen: boolean;
  appearance: AppearanceSettings;
  brand: BrandSettings;

  init: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  reorderProjects: (ids: string[]) => Promise<void>;
  moveProjectToFolder: (projectId: string, folder: string) => Promise<string>;
  reorderFolders: (folders: string[]) => Promise<void>;
  renameFolder: (from: string, to: string) => Promise<void>;
  deleteFolder: (folder: string) => Promise<void>;
  refreshActive: (silent?: boolean) => Promise<void>;
  refreshAll: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  showOverview: () => void;

  setView: (view: ViewMode) => void;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;

  toggleCollapsed: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  setCollapsedIds: (ids: string[]) => void;

  openTask: (id: string) => void;
  closeTask: () => void;
  openCreate: (parentId?: string | null) => void;
  openCreateInSection: (section: string) => void;
  closeCreate: () => void;

  openNewProject: (folder?: string) => void;
  closeNewProject: () => void;
  openNewFolder: () => void;
  closeNewFolder: () => void;
  openProjectEdit: () => void;
  closeProjectEdit: () => void;
  openNewSection: () => void;
  closeNewSection: () => void;

  toggleSidebar: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  setAppearance: (patch: Partial<AppearanceSettings>) => void;
  setBrand: (patch: Partial<BrandSettings>) => void;
  applyRemoteSettings: (settings: AppSettings) => void;
  openProjectDetail: (id?: string) => void;
  closeProjectDetail: () => void;
  setDataDir: (dataDir: string) => Promise<void>;

  toggleDone: (node: { id: string }) => Promise<void>;
  saveFields: (
    taskId: string,
    patch: { title?: string; fields?: TaskFields },
  ) => Promise<string>;
  addProgress: (taskId: string, text: string, author: string) => Promise<void>;
  createTask: (input: {
    parentId: string | null;
    title: string;
    fields: TaskFields;
  }) => Promise<string>;
  deleteTask: (taskId: string) => Promise<void>;
  moveTask: (
    taskId: string,
    targetId: string,
    position: 'before' | 'after' | 'child',
  ) => Promise<void>;
  moveTaskToSection: (taskId: string, section: string) => Promise<void>;
  createSection: (section: string) => Promise<void>;
  renameSection: (from: string, to: string) => Promise<void>;
  deleteSection: (section: string) => Promise<void>;

  createProject: (input: {
    name: string;
    code?: string;
    status?: string;
    folder?: string;
  }) => Promise<string>;
  createFolder: (folder: string) => Promise<string>;
  updateProjectMeta: (input: {
    name?: string;
    code?: string;
    status?: string;
    description?: string;
  }) => Promise<void>;
}

let booted = false;
let projectSeq = 0;

const VIEW_MODES: ViewMode[] = ['board', 'list', 'gantt'];

function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && VIEW_MODES.includes(value as ViewMode);
}

function initialView(): ViewMode {
  try {
    const requested = new URLSearchParams(window.location.search).get('view');
    if (isViewMode(requested)) return requested;
    const stored = localStorage.getItem('wbs.view');
    return isViewMode(stored) ? stored : 'board';
  } catch {
    return 'board';
  }
}

function initialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem('wbs.sidebarCollapsed') === '1';
  } catch {
    return false;
  }
}

function syncPageUrl(projectId: string | null, page: PageMode): void {
  try {
    const url = new URL(window.location.href);
    if (projectId) {
      url.searchParams.set('project', projectId);
      url.searchParams.delete('page');
    } else {
      url.searchParams.delete('project');
      url.searchParams.delete('task');
      if (page === 'overview') url.searchParams.set('page', 'overview');
      else url.searchParams.delete('page');
    }
    window.history.replaceState(null, '', url);
  } catch {
    /* ignore */
  }
}

export const useStore = create<AppState>((set, get) => ({
  page: 'overview',
  projects: [],
  folders: [],
  activeId: null,
  project: null,
  dataDir: '',
  builtAt: undefined,
  sidebarCollapsed: initialSidebarCollapsed(),
  projectDetailOpen: false,
  projectDetailId: null,
  loadingProjects: true,
  loadingProject: false,
  error: null,
  view: initialView(),
  filters: { ...DEFAULT_FILTERS },
  collapsed: {},
  drawerTaskId: null,
  createDraft: { open: false, parentId: null },
  newProjectOpen: false,
  newProjectFolder: '',
  newFolderOpen: false,
  projectEditOpen: false,
  sectionModalOpen: false,
  settingsOpen: false,
  appearance: loadAppearance(),
  brand: loadBrand(),

  init: async () => {
    if (booted) return;
    booted = true;
    set({ loadingProjects: true, error: null });

    try {
      const [projects, folders, config] = await Promise.all([
        api.listProjects(),
        api.listFolders(),
        api.config(),
      ]);
      set({
        projects,
        folders,
        dataDir: config.dataDir,
        builtAt: config.builtAt,
        loadingProjects: false,
      });

      // Server config is the source of truth (shared across browsers). The
      // localStorage cache above is only used for the very first paint.
      if (config.settings) {
        const serverSettings = normalizeSettings(config.settings);
        cacheSettings(serverSettings);
        set({ appearance: serverSettings.appearance, brand: serverSettings.brand });
      }

      const params = new URLSearchParams(window.location.search);
      const requestedProject = params.get('project');
      const requestedPage = params.get('page');
      const projectExists =
        requestedProject && projects.some((project) => project.id === requestedProject);

      if (projectExists && requestedPage !== 'overview') {
        await get().selectProject(requestedProject!);
      } else {
        projectSeq++;
        set({
          page: 'overview',
          activeId: null,
          project: null,
          loadingProject: false,
        });
      }
    } catch (error) {
      booted = false;
      set({
        loadingProjects: false,
        loadingProject: false,
        error: (error as Error).message,
      });
    }
  },

  refreshProjects: async () => {
    try {
      const [projects, folders] = await Promise.all([
        api.listProjects(),
        api.listFolders(),
      ]);
      set({ projects, folders });

      const { page, activeId } = get();
      const activeExists =
        activeId && projects.some((project) => project.id === activeId);

      if (page === 'project' && (!activeId || !activeExists)) {
        projectSeq++;
        syncPageUrl(null, 'overview');
        set({
          page: 'overview',
          activeId: null,
          project: null,
          loadingProject: false,
          drawerTaskId: null,
        });
      }
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  refreshActive: async (silent = false) => {
    const id = get().activeId;
    if (!id) return;
    const seq = ++projectSeq;
    if (!silent) set({ loadingProject: true });

    try {
      const project = await api.getProject(id);
      if (seq !== projectSeq || get().activeId !== id) return;
      set({ project, loadingProject: false });
    } catch (error) {
      if (seq !== projectSeq || get().activeId !== id) return;
      if (!silent) {
        set({ loadingProject: false, error: (error as Error).message });
      }
    }
  },

  reorderProjects: async (ids) => {
    await api.reorderProjects(ids);
    await get().refreshProjects();
  },

  moveProjectToFolder: async (projectId, folder) => {
    const result = await api.moveProject(projectId, folder);
    const { activeId, page } = get();
    await get().refreshProjects();
    // Moving encodes a new relative path into the id. If the moved project was
    // open, follow it to its new id so the view keeps working.
    if (activeId === projectId && result.id !== projectId) {
      syncPageUrl(result.id, page);
      set({ activeId: result.id });
      await get().refreshActive(true);
    }
    return result.id;
  },

  reorderFolders: async (folders) => {
    const ordered = await api.reorderFolders(folders);
    set({ folders: ordered });
  },

  renameFolder: async (from, to) => {
    const { activeId, projects } = get();
    const active = projects.find((project) => project.id === activeId);
    const oldPath = active?.path ?? '';
    const result = await api.renameFolder(from, to);
    await get().refreshProjects();
    set({ folders: result.folders });

    // Ids encode relative paths; follow the open project to its new id.
    if (active && (oldPath === from || oldPath.startsWith(`${from}/`))) {
      const newPath = to + oldPath.slice(from.length);
      const next = get().projects.find((project) => project.path === newPath);
      if (next) {
        syncPageUrl(next.id, 'project');
        set({ activeId: next.id });
        await get().refreshActive(true);
      }
    }
  },

  deleteFolder: async (folder) => {
    const { activeId, projects } = get();
    const active = projects.find((project) => project.id === activeId);
    const oldPath = active?.path ?? '';
    const result = await api.deleteFolder(folder);
    await get().refreshProjects();
    set({ folders: result.folders });

    if (active && oldPath.startsWith(`${folder}/`)) {
      const newPath = oldPath.slice(folder.length + 1);
      const next = get().projects.find((project) => project.path === newPath);
      if (next) {
        syncPageUrl(next.id, 'project');
        set({ activeId: next.id });
        await get().refreshActive(true);
      }
    }
  },

  refreshAll: async () => {
    await get().refreshProjects();
    if (get().page === 'project' && get().activeId) {
      await get().refreshActive(true);
    }
  },

  selectProject: async (id) => {
    const seq = ++projectSeq;
    syncPageUrl(id, 'project');
    set({
      page: 'project',
      activeId: id,
      project: null,
      loadingProject: true,
      drawerTaskId: null,
      projectEditOpen: false,
      sectionModalOpen: false,
      createDraft: { open: false, parentId: null },
      error: null,
    });

    try {
      const project = await api.getProject(id);
      if (seq !== projectSeq || get().activeId !== id) return;
      set({ project, loadingProject: false });
    } catch (error) {
      if (seq !== projectSeq || get().activeId !== id) return;
      set({
        project: null,
        loadingProject: false,
        error: (error as Error).message,
      });
    }
  },

  showOverview: () => {
    projectSeq++;
    syncPageUrl(null, 'overview');
    set({
      page: 'overview',
      activeId: null,
      project: null,
      loadingProject: false,
      drawerTaskId: null,
      projectEditOpen: false,
      sectionModalOpen: false,
      createDraft: { open: false, parentId: null },
      error: null,
    });
  },

  setView: (view) => {
    set({ view });
    try {
      localStorage.setItem('wbs.view', view);
    } catch {
      /* ignore */
    }
  },

  setFilters: (patch) => {
    set((state) => ({ filters: { ...state.filters, ...patch } }));
  },

  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  toggleCollapsed: (id) => {
    set((state) => {
      const collapsed = { ...state.collapsed };
      if (collapsed[id]) delete collapsed[id];
      else collapsed[id] = true;
      return { collapsed };
    });
  },

  expandAll: () => set({ collapsed: {} }),

  collapseAll: () => {
    const ids = collectExpandableIds(get().project?.roots ?? []);
    set({ collapsed: Object.fromEntries(ids.map((id) => [id, true])) });
  },

  setCollapsedIds: (ids) => {
    set({ collapsed: Object.fromEntries(ids.map((id) => [id, true])) });
  },

  openTask: (id) => set({ drawerTaskId: id }),
  closeTask: () => set({ drawerTaskId: null }),

  openCreate: (parentId = null) =>
    set({ createDraft: { open: true, parentId, section: undefined } }),
  openCreateInSection: (section) =>
    set({ createDraft: { open: true, parentId: null, section } }),
  closeCreate: () => set({ createDraft: { open: false, parentId: null } }),

  openNewProject: (folder = '') => set({ newProjectOpen: true, newProjectFolder: folder }),
  closeNewProject: () => set({ newProjectOpen: false, newProjectFolder: '' }),
  openNewFolder: () => set({ newFolderOpen: true }),
  closeNewFolder: () => set({ newFolderOpen: false }),
  openProjectEdit: () => set({ projectEditOpen: true }),
  closeProjectEdit: () => set({ projectEditOpen: false }),
  openNewSection: () => set({ sectionModalOpen: true }),
  closeNewSection: () => set({ sectionModalOpen: false }),

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    try {
      localStorage.setItem('wbs.sidebarCollapsed', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  setAppearance: (patch) => {
    const next = { ...get().appearance, ...patch };
    set({ appearance: next });
    saveAppearance(next);
    // Persist the full settings object so a partial patch never wipes the brand.
    void api.saveSettings({ appearance: next, brand: get().brand }).catch(() => {
      /* keep local value if the server is temporarily unavailable */
    });
  },

  setBrand: (patch) => {
    const next = { ...get().brand, ...patch };
    set({ brand: next });
    saveBrand(next);
    void api.saveSettings({ appearance: get().appearance, brand: next }).catch(() => {
      /* keep local value if the server is temporarily unavailable */
    });
  },

  applyRemoteSettings: (settings) => {
    const next = normalizeSettings(settings);
    cacheSettings(next);
    set({ appearance: next.appearance, brand: next.brand });
  },

  openProjectDetail: (id) => {
    const detailId = id ?? get().activeId;
    if (!detailId) return;
    set({ projectDetailOpen: true, projectDetailId: detailId });
  },

  closeProjectDetail: () => set({ projectDetailOpen: false }),

  setDataDir: async (dataDir) => {
    const result = await api.setDataDir(dataDir);
    set({ dataDir: result.dataDir, error: null });
    projectSeq++;
    await get().refreshProjects();
    // The active project may no longer exist in the new data root; go home.
    set({
      page: 'overview',
      activeId: null,
      project: null,
      loadingProject: false,
      drawerTaskId: null,
    });
    syncPageUrl(null, 'overview');
  },

  toggleDone: async (node) => {
    const { project, activeId } = get();
    if (!project || !activeId) return;

    const previous = project;
    const nextProject = structuredClone(project);
    const target = findTask(nextProject.roots, node.id);
    if (!target) return;

    const nextDone = !target.done;
    target.done = nextDone;
    nextProject.stats = collectStats(nextProject.roots);
    set({ project: nextProject });

    try {
      const result = await api.patchTask(activeId, node.id, { done: nextDone });
      if (result.id !== node.id && get().drawerTaskId === node.id) {
        set({ drawerTaskId: result.id });
      }
      await get().refreshActive(true);
    } catch (error) {
      if (get().project === nextProject) set({ project: previous });
      throw error;
    }
  },

  saveFields: async (taskId, patch) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    const result = await api.patchTask(activeId, taskId, patch);
    if (get().drawerTaskId === taskId) {
      set({ drawerTaskId: result.id });
    }
    await get().refreshActive(true);
    return result.id;
  },

  addProgress: async (taskId, text, author) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    await api.addProgress(activeId, taskId, text, author);
    await get().refreshActive(true);
  },

  createTask: async (input) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    const result = await api.createTask(activeId, input);
    set({ createDraft: { open: false, parentId: null } });
    await Promise.all([get().refreshActive(true), get().refreshProjects()]);
    set({ drawerTaskId: result.id });
    return result.id;
  },

  deleteTask: async (taskId) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    await api.deleteTask(activeId, taskId);
    if (get().drawerTaskId === taskId) set({ drawerTaskId: null });
    await Promise.all([get().refreshActive(true), get().refreshProjects()]);
  },

  moveTask: async (taskId, targetId, position) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    try {
      const result = await api.moveTask(activeId, taskId, { targetId, position });
      if (get().drawerTaskId === taskId && result.id !== taskId) {
        set({ drawerTaskId: result.id });
      }
      await get().refreshActive(true);
    } catch (error) {
      // The Markdown file is the source of truth; reload it so the UI never
      // keeps an optimistic order that the server rejected.
      await get().refreshActive(true);
      throw error;
    }
  },

  moveTaskToSection: async (taskId, section) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    try {
      const result = await api.moveTaskToSection(activeId, taskId, section);
      if (get().drawerTaskId === taskId && result.id !== taskId) {
        set({ drawerTaskId: result.id });
      }
      await get().refreshActive(true);
    } catch (error) {
      await get().refreshActive(true);
      throw error;
    }
  },

  createSection: async (section) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');
    await api.createSection(activeId, section);
    await get().refreshActive(true);
  },

  renameSection: async (from, to) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');
    await api.renameSection(activeId, from, to);
    await get().refreshActive(true);
  },

  deleteSection: async (section) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');
    await api.deleteSection(activeId, section);
    await get().refreshActive(true);
  },

  createProject: async (input) => {
    const result = await api.createProject(input);
    set({ newProjectOpen: false });
    await get().refreshProjects();
    get().resetFilters();
    await get().selectProject(result.id);
    return result.id;
  },

  createFolder: async (folder) => {
    const result = await api.createFolder(folder);
    set({ newFolderOpen: false });
    await get().refreshProjects();
    return result.folder;
  },

  updateProjectMeta: async (input) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    await api.updateProject(activeId, input);
    set({ projectEditOpen: false });
    await Promise.all([get().refreshActive(true), get().refreshProjects()]);
  },
}));
