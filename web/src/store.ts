import { create } from 'zustand';
import {
  PROJECT_PAGE_KEYS,
  collectStats,
  findTask,
  isFocused,
  type ProjectDetail,
  type ProjectPageKey,
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
  loadStatuses,
  saveAppearance,
  saveBrand,
  saveStatuses,
  normalizeProjectStatuses,
  normalizeSettings,
  type AppearanceSettings,
  type AppSettings,
  type BrandSettings,
  type ProjectStatusDef,
} from './lib/settings';
import {
  DEFAULT_FILTERS,
  DEFAULT_TASK_TYPES,
  collectExpandableIds,
  type Filters,
  type TaskTypeFilter,
} from './lib/filters';
import {
  loadListColumns,
  normalizeListColumns,
  saveListColumns,
  type ListColumnKey,
  type ListColumns,
} from './lib/columns';

export type ViewMode = 'board' | 'list' | 'gantt' | ProjectPageKey;
export type PageMode = 'overview' | 'project';
/** How the desktop sidebar occupies space: pinned, manually collapsed or auto-hide. */
export type SidebarMode = 'pin' | 'collapse' | 'autohide';

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
  /** True when the sidebar is hidden and slides out on left-edge hover. */
  sidebarAutoHide: boolean;
  /** Desktop sidebar width in px (draggable, persisted). */
  sidebarWidth: number;
  projectDetailOpen: boolean;
  projectDetailId: string | null;
  loadingProjects: boolean;
  loadingProject: boolean;
  error: string | null;
  view: ViewMode;
  /** 看板参与分类的任务类型（普通 / 标题 / 版本）。 */
  boardTypes: TaskTypeFilter;
  /** 列表视图的可选列显隐（任务列恒显示）。 */
  listColumns: ListColumns;
  /** 列表视图各列的拖拽宽度（基准字号下的 px）。 */
  filters: Filters;
  collapsed: Record<string, boolean>;
  /** 列表分组的展开/收起状态（跨视图共享，供 n 快捷键选目标分组）。 */
  collapsedGroups: Record<string, boolean>;
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
  /** User-defined project statuses (name + colour + order). */
  statuses: ProjectStatusDef[];

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
  /** 保存简介 / 里程碑 / 风险 / 成本 / 相关方页面到项目 Markdown，并同步最新详情。 */
  saveProjectPage: (key: ProjectPageKey, text: string) => Promise<void>;
  /** 保存页面展示顺序（写回项目 Front Matter 的 pageOrder）。 */
  setProjectPageOrder: (order: ProjectPageKey[]) => Promise<void>;
  /** 保存里程碑关联的任务 id（写回 Front Matter 的 milestoneTasks）。 */
  saveMilestoneTasks: (ids: string[]) => Promise<void>;
  /** 从里程碑卡片跳到任务：切到列表、清筛选、展开树并定位高亮。 */
  jumpToTask: (taskId: string) => void;
  /** 刚跳转到的任务 id，列表里据此滚动并闪一下。 */
  highlightTaskId: string | null;
  clearTaskHighlight: () => void;
  /** 鼠标当前停在这条任务上，且它有前置任务 —— 用来点亮它的前置。 */
  depPeek: { src: string; deps: string[] } | null;
  setDepPeek: (peek: { src: string; deps: string[] } | null) => void;
  setBoardType: (key: keyof TaskTypeFilter, value: boolean) => void;
  resetBoardTypes: () => void;
  /** 甘特图里被手动隐藏的任务行（连带子树），切项目时清空。 */
  ganttHidden: Record<string, true>;
  setGanttRowsHidden: (ids: string[], hidden: boolean) => void;
  clearGanttHidden: () => void;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;

  toggleCollapsed: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  setCollapsedIds: (ids: string[]) => void;
  toggleCollapsedGroup: (key: string) => void;
  resetCollapsedGroups: () => void;

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
  setSidebarMode: (mode: SidebarMode) => void;
  setSidebarWidth: (width: number) => void;
  setListColumn: (key: ListColumnKey, value: boolean) => void;
  resetListColumns: () => void;
  /** 拖动列宽；persist=false 用于拖动过程中的高频更新。 */
  openSettings: () => void;
  closeSettings: () => void;
  setAppearance: (patch: Partial<AppearanceSettings>) => void;
  setBrand: (patch: Partial<BrandSettings>) => void;
  setStatuses: (statuses: ProjectStatusDef[]) => void;
  applyRemoteSettings: (settings: AppSettings) => void;
  openProjectDetail: (id?: string) => void;
  closeProjectDetail: () => void;
  setDataDir: (dataDir: string) => Promise<void>;

  /** Pin / unpin a task on 项目总览 → 今日关注 (writes the `focus` field). */
  toggleFocus: (projectId: string, taskId: string, focused: boolean) => Promise<void>;
  /** Change (or clear, with '') the sticky-note colour of a focused task. */
  setFocusColor: (projectId: string, taskId: string, color: string) => Promise<void>;
  /** Open a focused task: switch project first, then reveal the drawer. */
  openFocusTask: (projectId: string, taskId: string) => void;

  toggleDone: (node: { id: string }) => Promise<void>;
  saveFields: (
    taskId: string,
    patch: { title?: string; fields?: TaskFields },
  ) => Promise<string>;
  addProgress: (taskId: string, text: string, author: string) => Promise<void>;
  updateProgress: (taskId: string, line: number, text: string) => Promise<void>;
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
  saveSectionDescription: (section: string, description: string) => Promise<void>;

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
    tags?: string[];
  }) => Promise<void>;
  /** 在项目总览中直接增删某个项目的标签（不要求该项目处于选中状态）。 */
  setProjectTags: (projectId: string, tags: string[]) => Promise<void>;
}

let booted = false;
let projectSeq = 0;

const VIEW_MODES: ViewMode[] = ['board', 'list', 'gantt', ...PROJECT_PAGE_KEYS];

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

function initialSidebarAutoHide(): boolean {
  try {
    return localStorage.getItem('wbs.sidebarAutoHide') === '1';
  } catch {
    return false;
  }
}

/** Sidebar width is user-resizable; keep it inside a sane band. */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 226;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function initialSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem('wbs.sidebarWidth'));
    return stored ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

const BOARD_TYPES_KEY = 'wbs.boardTypes';

function initialBoardTypes(): TaskTypeFilter {
  try {
    const raw = localStorage.getItem(BOARD_TYPES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TaskTypeFilter>;
      return {
        plain: parsed.plain !== false,
        title: parsed.title !== false,
        version: parsed.version !== false,
        versionChildren: parsed.versionChildren !== false,
      };
    }
    // 旧版本只存了「是否含标题类型」，迁移成完整的三类开关。
    if (localStorage.getItem('wbs.boardTitles') === '0') {
      return { ...DEFAULT_TASK_TYPES, title: false };
    }
    return { ...DEFAULT_TASK_TYPES };
  } catch {
    return { ...DEFAULT_TASK_TYPES };
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
  sidebarAutoHide: initialSidebarAutoHide(),
  sidebarWidth: initialSidebarWidth(),
  projectDetailOpen: false,
  projectDetailId: null,
  loadingProjects: true,
  loadingProject: false,
  error: null,
  view: initialView(),
  boardTypes: initialBoardTypes(),
  ganttHidden: {},
  listColumns: loadListColumns(),
  filters: { ...DEFAULT_FILTERS },
  collapsed: {},
  collapsedGroups: {},
  highlightTaskId: null,
  depPeek: null,
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
  statuses: loadStatuses(),

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
        set({
          appearance: serverSettings.appearance,
          brand: serverSettings.brand,
          statuses: serverSettings.statuses,
        });
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
      ganttHidden: {},
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

  saveProjectPage: async (key, text) => {
    const current = get().project;
    if (!current) return;
    const detail = await api.saveProjectPage(current.id, key, text);
    set({ project: detail });
  },

  setProjectPageOrder: async (order) => {
    const current = get().project;
    if (!current) return;
    const detail = await api.saveProjectPageOrder(current.id, order);
    set({ project: detail });
  },

  saveMilestoneTasks: async (ids) => {
    const current = get().project;
    if (!current) return;
    const detail = await api.saveMilestoneTasks(current.id, ids);
    set({ project: detail });
  },

  jumpToTask: (taskId) => {
    // 目标任务可能被筛选条件隐藏或被折叠在子层级里，跳转前先还原成完整视图。
    set({
      filters: { ...DEFAULT_FILTERS },
      collapsed: {},
      highlightTaskId: taskId,
    });
    get().setView('list');
  },

  clearTaskHighlight: () => set({ highlightTaskId: null }),

  setDepPeek: (peek) => set({ depPeek: peek }),

  setView: (view) => {
    set({ view });
    try {
      localStorage.setItem('wbs.view', view);
    } catch {
      /* ignore */
    }
  },

  setBoardType: (key, value) => {
    const next = { ...get().boardTypes, [key]: value };
    set({ boardTypes: next });
    try {
      localStorage.setItem(BOARD_TYPES_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  },

  resetBoardTypes: () => {
    const next = { ...DEFAULT_TASK_TYPES };
    set({ boardTypes: next });
    try {
      localStorage.setItem(BOARD_TYPES_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  },

  setGanttRowsHidden: (ids, hidden) => {
    if (ids.length === 0) return;
    set((state) => {
      const next = { ...state.ganttHidden };
      for (const id of ids) {
        if (hidden) next[id] = true;
        else delete next[id];
      }
      return { ganttHidden: next };
    });
  },

  clearGanttHidden: () => {
    if (Object.keys(get().ganttHidden).length === 0) return;
    set({ ganttHidden: {} });
  },

  setFilters: (patch) => {
    set((state) => ({ filters: { ...state.filters, ...patch } }));
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    // 看板的「任务类型」也是默认态：重置要把三个类型开关一起复位。
    get().resetBoardTypes();
  },

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
  toggleCollapsedGroup: (key) => {
    set((state) => ({
      collapsedGroups: {
        ...state.collapsedGroups,
        [key]: !state.collapsedGroups[key],
      },
    }));
  },
  resetCollapsedGroups: () => set({ collapsedGroups: {} }),

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
    set({ sidebarCollapsed: next, sidebarAutoHide: false });
    try {
      localStorage.setItem('wbs.sidebarCollapsed', next ? '1' : '0');
      localStorage.setItem('wbs.sidebarAutoHide', '0');
    } catch {
      /* ignore */
    }
  },

  setSidebarMode: (mode) => {
    const autoHide = mode === 'autohide';
    const collapsed = mode === 'collapse';
    set({ sidebarAutoHide: autoHide, sidebarCollapsed: collapsed });
    try {
      localStorage.setItem('wbs.sidebarAutoHide', autoHide ? '1' : '0');
      localStorage.setItem('wbs.sidebarCollapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  },

  setSidebarWidth: (width) => {
    const next = clampSidebarWidth(width);
    if (next === get().sidebarWidth) return;
    set({ sidebarWidth: next });
    try {
      localStorage.setItem('wbs.sidebarWidth', String(next));
    } catch {
      /* ignore */
    }
  },

  setListColumn: (key, value) => {
    const next = normalizeListColumns({ ...get().listColumns, [key]: value });
    set({ listColumns: next });
    saveListColumns(next);
  },

  resetListColumns: () => {
    const next = normalizeListColumns(undefined);
    set({ listColumns: next });
    saveListColumns(next);
  },


  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  setAppearance: (patch) => {
    const next = { ...get().appearance, ...patch };
    set({ appearance: next });
    saveAppearance(next);
    // Persist the full settings object so a partial patch never wipes the rest.
    void api
      .saveSettings({ appearance: next, brand: get().brand, statuses: get().statuses })
      .catch(() => {
        /* keep local value if the server is temporarily unavailable */
      });
  },

  setBrand: (patch) => {
    const next = { ...get().brand, ...patch };
    set({ brand: next });
    saveBrand(next);
    void api
      .saveSettings({ appearance: get().appearance, brand: next, statuses: get().statuses })
      .catch(() => {
        /* keep local value if the server is temporarily unavailable */
      });
  },

  setStatuses: (statuses) => {
    const next = normalizeProjectStatuses(statuses);
    set({ statuses: next });
    saveStatuses(next);
    void api
      .saveSettings({ appearance: get().appearance, brand: get().brand, statuses: next })
      .catch(() => {
        /* keep local value if the server is temporarily unavailable */
      });
  },

  applyRemoteSettings: (settings) => {
    const next = normalizeSettings(settings);
    cacheSettings(next);
    set({ appearance: next.appearance, brand: next.brand, statuses: next.statuses });
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

  toggleFocus: async (projectId, taskId, focused) => {
    const next = !focused;
    await api.patchTask(projectId, taskId, { fields: { focus: next ? '1' : '' } });
    await Promise.all([
      get().refreshProjects(),
      get().activeId === projectId ? get().refreshActive(true) : Promise.resolve(),
    ]);
    // 后台服务若还跑着旧版本，PATCH 会把 focus 字段静默丢弃：这里回读一次，
    // 把「点了没反应」变成一条明确提示，而不是什么都不发生。
    const task = findTask(get().project?.roots ?? [], taskId);
    if (task && isFocused(task.fields) !== next) {
      throw new Error('标记未能保存：后台服务可能是旧版本，请重启后台服务后再试');
    }
  },

  setFocusColor: async (projectId, taskId, color) => {
    await api.patchTask(projectId, taskId, { fields: { focusColor: color } });
    await Promise.all([
      get().refreshProjects(),
      get().activeId === projectId ? get().refreshActive(true) : Promise.resolve(),
    ]);
  },

  openFocusTask: (projectId, taskId) => {
    void get()
      .selectProject(projectId)
      .then(() => get().openTask(taskId))
      .catch(() => {
        /* selectProject already surfaces load errors */
      });
  },

  addProgress: async (taskId, text, author) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    await api.addProgress(activeId, taskId, text, author);
    await get().refreshActive(true);
  },

  updateProgress: async (taskId, line, text) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    await api.updateProgress(activeId, taskId, line, text);
    await get().refreshActive(true);
  },

  createTask: async (input) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');

    const result = await api.createTask(activeId, input);
    set({ createDraft: { open: false, parentId: null } });
    await Promise.all([get().refreshActive(true), get().refreshProjects()]);
    // 建完任务直接回列表查看，不再自动弹出任务详情；顺手定位并短暂高亮新任务。
    set({ drawerTaskId: null });
    get().jumpToTask(result.id);
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

  saveSectionDescription: async (section, description) => {
    const activeId = get().activeId;
    if (!activeId) throw new Error('尚未选择项目');
    await api.saveSectionDescription(activeId, section, description);
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

  setProjectTags: async (projectId, tags) => {
    // Optimistic: the overview table edits tags inline, and the Select must
    // already show the new list before the round-trip finishes — otherwise a
    // quick second edit would be computed from a stale value and drop a tag.
    const snapshot = get().projects;
    const next = tags.length ? tags : undefined;
    set({
      projects: snapshot.map((project) =>
        project.id === projectId ? { ...project, tags: next } : project,
      ),
    });
    try {
      await api.updateProject(projectId, { tags });
    } catch (error) {
      set({ projects: snapshot });
      throw error;
    }
    await get().refreshProjects();
    if (get().activeId === projectId) await get().refreshActive(true);
  },
}));
