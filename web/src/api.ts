import type { ProjectDetail, ProjectSummary, TaskFields, AppSettings } from '@wbs/shared';

export interface AppConfig {
  dataDir: string;
  port: number;
  version: string;
  /** ISO timestamp of the web build (web/dist/index.html mtime). */
  builtAt?: string;
  /** Server-persisted appearance/brand settings (shared across browsers). */
  settings?: AppSettings;
}

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListing {
  /** Current directory ('' when listing drive roots on Windows). */
  path: string;
  parent: string | null;
  dirs: DirEntry[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }

  return payload as T;
}

export const api = {
  config: () => request<AppConfig>('/config'),
  getSettings: () => request<AppSettings>('/settings'),
  saveSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  setDataDir: (dataDir: string) =>
    request<{ ok: true; dataDir: string }>('/config', {
      method: 'POST',
      body: JSON.stringify({ dataDir }),
    }),
  listProjects: () => request<ProjectSummary[]>('/projects'),
  listFolders: () => request<string[]>('/folders'),
  listDirs: (dirPath: string) =>
    request<DirListing>(
      `/fs/dirs${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`,
    ),
  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),

  createProject: (input: {
    name: string;
    code?: string;
    status?: string;
    folder?: string;
  }) =>
    request<{ id: string; path: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createFolder: (folder: string) =>
    request<{ folder: string }>('/folders', {
      method: 'POST',
      body: JSON.stringify({ folder }),
    }),

  /** Persist the sidebar folder order in the server config file. */
  reorderFolders: (folders: string[]) =>
    request<string[]>('/folders/order', {
      method: 'PUT',
      body: JSON.stringify({ folders }),
    }),

  /** Rename a data directory; contained projects follow the new path. */
  renameFolder: (from: string, to: string) =>
    request<{ from: string; to: string; folders: string[] }>('/folders/rename', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),

  /** Delete a folder; its files are moved back to the data root. */
  deleteFolder: (folder: string) =>
    request<{ folder: string; moved: number; folders: string[] }>(
      '/folders/delete',
      { method: 'POST', body: JSON.stringify({ folder }) },
    ),

  reorderProjects: (ids: string[]) =>
    request<{ ok: true }>('/projects/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  /** Move a project's Markdown file into another folder (empty = root). */
  moveProject: (projectId: string, folder: string) =>
    request<{ id: string; path: string }>(`/projects/${projectId}/move`, {
      method: 'POST',
      body: JSON.stringify({ folder }),
    }),

  updateProject: (
    projectId: string,
    input: {
      name?: string;
      code?: string;
      status?: string;
      description?: string;
      tags?: string[];
    },
  ) =>
    request<{ ok: true }>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  /** 写入里程碑 / 风险 / 成本页面（返回刷新后的项目详情）。 */
  saveProjectPage: (projectId: string, key: string, text: string) =>
    request<ProjectDetail>(`/projects/${projectId}/pages/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),

  saveProjectPageOrder: (projectId: string, order: string[]) =>
    request<ProjectDetail>(`/projects/${projectId}/page-order`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    }),

  saveMilestoneTasks: (projectId: string, ids: string[]) =>
    request<ProjectDetail>(`/projects/${projectId}/milestone-tasks`, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),

  patchTask: (
    projectId: string,
    taskId: string,
    patch: { done?: boolean; title?: string; fields?: TaskFields },
  ) =>
    request<{ id: string }>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  addProgress: (projectId: string, taskId: string, text: string, author: string) =>
    request<{ ok: true }>(`/projects/${projectId}/tasks/${taskId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ text, author }),
    }),

  updateProgress: (projectId: string, taskId: string, line: number, text: string) =>
    request<{ ok: true }>(`/projects/${projectId}/tasks/${taskId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ line, text }),
    }),

  createTask: (
    projectId: string,
    input: {
      parentId: string | null;
      title: string;
      fields: TaskFields;
    },
  ) =>
    request<{ id: string }>(`/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteTask: (projectId: string, taskId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'DELETE',
    }),

  moveTask: (
    projectId: string,
    taskId: string,
    input: { targetId: string; position: 'before' | 'after' | 'child' },
  ) =>
    request<{ id: string }>(`/projects/${projectId}/tasks/${taskId}/move`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  moveTaskToSection: (projectId: string, taskId: string, section: string) =>
    request<{ id: string; section: string }>(
      `/projects/${projectId}/tasks/${taskId}/move-section`,
      { method: 'POST', body: JSON.stringify({ section }) },
    ),

  createSection: (projectId: string, section: string) =>
    request<{ section: string }>(`/projects/${projectId}/sections`, {
      method: 'POST',
      body: JSON.stringify({ section }),
    }),

  renameSection: (projectId: string, from: string, to: string) =>
    request<{ from: string; to: string }>(
      `/projects/${projectId}/sections/rename`,
      { method: 'POST', body: JSON.stringify({ from, to }) },
    ),

  deleteSection: (projectId: string, section: string) =>
    request<{ section: string }>(`/projects/${projectId}/sections/delete`, {
      method: 'POST',
      body: JSON.stringify({ section }),
    }),

  saveSectionDescription: (
    projectId: string,
    section: string,
    description: string,
  ) =>
    request<{ section: string; description: string }>(
      `/projects/${projectId}/sections/description`,
      { method: 'POST', body: JSON.stringify({ section, description }) },
    ),

  /** Open the project's Markdown file with the OS default program. */
  openProjectFile: (projectId: string) =>
    request<{ ok: true; path: string }>(`/projects/${projectId}/open-file`, {
      method: 'POST',
    }),

  /** Reveal the project's Markdown file in the OS file manager. */
  openProjectFolder: (projectId: string) =>
    request<{ ok: true; path: string }>(`/projects/${projectId}/open-folder`, {
      method: 'POST',
    }),

  /**
   * Print a client-built "what you see" document to PDF on the server
   * (headless Edge/Chrome). Returns the raw PDF bytes.
   */
  exportPdfFromHtml: async (html: string, filename: string): Promise<Blob> => {
    const response = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, filename }),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = `PDF 导出失败（HTTP ${response.status}）`;
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          message = String((parsed as { error: unknown }).error);
        }
      } catch {
        /* keep the status-based message */
      }
      throw new Error(message);
    }
    return response.blob();
  },
};
