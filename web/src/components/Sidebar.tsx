import { useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { App as AntApp, Button, Dropdown, Input, Modal, Popconfirm, Tooltip, type MenuProps } from 'antd';
import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { ProjectSummary } from '@wbs/shared';
import { useStore } from '../store';
import { brandGlyphStyle, statusTone } from './atoms';

function dirOf(project: ProjectSummary): string {
  const parts = project.path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function dropSideFor(event: DragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function groupProjects(
  projects: ProjectSummary[],
  folders: string[],
  query: string,
) {
  const keyword = query.trim().toLowerCase();
  const filtered = projects.filter((project) => {
    if (!keyword) return true;
    return `${project.name} ${project.code ?? ''} ${project.path}`
      .toLowerCase()
      .includes(keyword);
  });

  const groups = new Map<string, ProjectSummary[]>();
  for (const folder of folders) groups.set(folder, []);
  for (const project of filtered) {
    const dir = dirOf(project);
    const list = groups.get(dir) ?? [];
    list.push(project);
    groups.set(dir, list);
  }

  let entries = [...groups.entries()];
  if (keyword) {
    entries = entries.filter(
      ([dir, items]) => items.length > 0 || dir.toLowerCase().includes(keyword),
    );
  }
  entries = entries.filter(([dir, items]) => dir !== '' || items.length > 0);

  // folders arrive from the server in their persisted order; unknown folders
  // (created outside the UI) are appended alphabetically.
  const rank = new Map(folders.map((folder, index) => [folder, index]));
  entries.sort(([a], [b]) => {
    if (a === b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    const rankA = rank.get(a);
    const rankB = rank.get(b);
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;
    return a.localeCompare(b, 'zh-Hans-CN');
  });

  return entries;
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const page = useStore((state) => state.page);
  const projects = useStore((state) => state.projects);
  const folders = useStore((state) => state.folders);
  const activeId = useStore((state) => state.activeId);
  const loadingProjects = useStore((state) => state.loadingProjects);
  const brand = useStore((state) => state.brand);
  const selectProject = useStore((state) => state.selectProject);
  const showOverview = useStore((state) => state.showOverview);
  const refreshAll = useStore((state) => state.refreshAll);
  const openNewProject = useStore((state) => state.openNewProject);
  const openNewFolder = useStore((state) => state.openNewFolder);
  const openSettings = useStore((state) => state.openSettings);
  const reorderProjects = useStore((state) => state.reorderProjects);
  const moveProjectToFolder = useStore((state) => state.moveProjectToFolder);
  const reorderFolders = useStore((state) => state.reorderFolders);
  const renameFolder = useStore((state) => state.renameFolder);
  const deleteFolder = useStore((state) => state.deleteFolder);
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<{
    id: string;
    position: 'before' | 'after';
  } | null>(null);
  /** Folder currently highlighted as a drop target for a project ('' = root). */
  const [folderDrop, setFolderDrop] = useState<string | null>(null);
  /** Folder drag state: folders reorder among themselves, projects still move files. */
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
  const [folderOrderDrop, setFolderOrderDrop] = useState<{
    folder: string;
    position: 'before' | 'after';
  } | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const dragIdRef = useRef<string | null>(null);
  const dragFolderRef = useRef<string | null>(null);
  const lastDragEndRef = useRef(0);

  const groups = useMemo(
    () => groupProjects(projects, folders, query),
    [projects, folders, query],
  );

  const runMove = (sourceId: string, folder: string) => {
    void moveProjectToFolder(sourceId, folder).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '移动项目失败');
    });
  };

  // Drop onto another project: same folder reorders, different folder moves the
  // Markdown file into the target folder (before/after is ignored cross-folder).
  const applyDrop = (
    sourceId: string,
    targetId: string,
    position: 'before' | 'after',
  ) => {
    const source = projects.find((project) => project.id === sourceId);
    const target = projects.find((project) => project.id === targetId);
    if (!source || !target || sourceId === targetId) return;

    if (dirOf(source) !== dirOf(target)) {
      runMove(sourceId, dirOf(target));
      return;
    }

    const ids = projects.map((project) => project.id);
    ids.splice(ids.indexOf(sourceId), 1);
    const index = ids.indexOf(targetId);
    ids.splice(position === 'before' ? index : index + 1, 0, sourceId);

    void reorderProjects(ids).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '排序失败');
    });
  };

  const clearDragState = () => {
    setDropInfo(null);
    setFolderDrop(null);
    setDraggingId(null);
    setFolderOrderDrop(null);
    setDraggingFolder(null);
    dragIdRef.current = null;
    dragFolderRef.current = null;
    lastDragEndRef.current = Date.now();
  };

  const applyFolderDrop = (
    source: string,
    target: string,
    position: 'before' | 'after',
  ) => {
    if (source === target) return;
    const next = folders.filter((folder) => folder !== source);
    const index = next.indexOf(target);
    if (index < 0) return;
    next.splice(position === 'before' ? index : index + 1, 0, source);
    void reorderFolders(next).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '文件夹排序失败');
    });
  };

  const openFolderRename = (folder: string) => {
    setEditingFolder(folder);
    setFolderDraft(folder);
  };

  const submitFolderRename = async () => {
    if (!editingFolder) return;
    const to = folderDraft.trim();
    if (!to || to === editingFolder) {
      setEditingFolder(null);
      return;
    }
    setFolderSaving(true);
    try {
      await renameFolder(editingFolder, to);
      message.success(`文件夹已改名为「${to}」`);
      setEditingFolder(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '改名失败');
    } finally {
      setFolderSaving(false);
    }
  };

  const runFolderDelete = (folder: string) => {
    void deleteFolder(folder)
      .then(() => message.success(`文件夹「${folder}」已删除，项目已移回根目录`))
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : '删除文件夹失败');
      });
  };

  const createMenu: MenuProps = {
    items: [
      {
        key: 'project',
        icon: <FileAddOutlined />,
        label: '新建项目',
      },
      {
        key: 'folder',
        icon: <FolderAddOutlined />,
        label: '新建文件夹',
      },
    ],
    onClick: ({ key }) => {
      onNavigate?.();
      if (key === 'project') openNewProject();
      else openNewFolder();
    },
  };

  return (
    <div className="sidebar-inner">
      <div className="brand">
        <div
          className="brand-mark"
          style={{
            background: brand.iconColor,
            borderRadius: brand.iconRadius,
            ...brandGlyphStyle(brand.icon, 13),
          }}
        >
          {(brand.icon || 'W').slice(0, 2)}
        </div>
        <div>
          <div className="brand-title">{brand.title || 'WBS 工作台'}</div>
          <div className="brand-sub">{brand.subtitle}</div>
        </div>
      </div>

      <Input
        className="side-search"
        prefix={<SearchOutlined />}
        placeholder="搜索项目"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        allowClear
      />

      <button
        type="button"
        className={`overview-link${page === 'overview' ? ' is-active' : ''}`}
        onClick={() => {
          onNavigate?.();
          showOverview();
        }}
      >
        <span className="overview-link-label">
          <AppstoreOutlined />
          项目总览
        </span>
        <span className="overview-link-count">{projects.length}</span>
      </button>

      <div className="side-section-row">
        <div className="side-section-label">项目 · {projects.length}</div>
        <Dropdown
          menu={createMenu}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button
            className="side-add-btn"
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label="新建项目或文件夹"
          />
        </Dropdown>
      </div>

      <div className="project-list">
        {loadingProjects && projects.length === 0 ? (
          <div className="side-skeletons">
            <div className="side-skeleton" />
            <div className="side-skeleton" />
            <div className="side-skeleton" />
          </div>
        ) : null}

        {/* Root drop zone: drop here to move a project out of a folder. */}
        {groups.length > 1 ? (
          <div
            className={`root-drop-zone${folderDrop === '' ? ' is-over' : ''}`}
            onDragOver={(event: DragEvent<HTMLDivElement>) => {
              if (dragFolderRef.current) return;
              const sourceId = dragIdRef.current;
              if (!sourceId) return;
              const source = projects.find((item) => item.id === sourceId);
              if (!source || dirOf(source) === '') return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropInfo(null);
              setFolderDrop('');
            }}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              const sourceId =
                dragIdRef.current ?? event.dataTransfer.getData('text/plain');
              clearDragState();
              if (sourceId) runMove(sourceId, '');
            }}
          >
            拖到此处移出文件夹
          </div>
        ) : null}

        {groups.map(([dir, items]) => {
          const hasChildFolder = folders.some(
            (folder) => folder !== dir && folder.startsWith(`${dir}/`),
          );

          return (
            <div className="project-group" key={dir || '__root__'}>
              {dir ? (
                <div
                  draggable
                  title="拖动调整文件夹顺序"
                  className={[
                    'folder-label',
                    folderDrop === dir ? 'is-drop-target' : '',
                    draggingFolder === dir ? 'folder-dragging' : '',
                    folderOrderDrop?.folder === dir
                      ? `folder-drop-${folderOrderDrop.position}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onDragStart={(event: DragEvent<HTMLDivElement>) => {
                    event.stopPropagation();
                    dragFolderRef.current = dir;
                    setDraggingFolder(dir);
                    setDropInfo(null);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-wbs-folder', dir);
                  }}
                  onDragOver={(event: DragEvent<HTMLDivElement>) => {
                    if (dragFolderRef.current) {
                      if (dragFolderRef.current === dir) return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = 'move';
                      setFolderDrop(null);
                      const position = dropSideFor(event);
                      setFolderOrderDrop((previous) =>
                        previous?.folder === dir && previous.position === position
                          ? previous
                          : { folder: dir, position },
                      );
                      return;
                    }
                    const sourceId = dragIdRef.current;
                    if (!sourceId) return;
                    const source = projects.find((item) => item.id === sourceId);
                    if (!source || dirOf(source) === dir) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropInfo(null);
                    setFolderDrop(dir);
                  }}
                  onDragLeave={() => {
                    setFolderDrop((current) => (current === dir ? null : current));
                    setFolderOrderDrop((current) =>
                      current?.folder === dir ? null : current,
                    );
                  }}
                  onDrop={(event: DragEvent<HTMLDivElement>) => {
                    if (dragFolderRef.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      const source = dragFolderRef.current;
                      const position = dropSideFor(event);
                      clearDragState();
                      applyFolderDrop(source, dir, position);
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    const sourceId =
                      dragIdRef.current ?? event.dataTransfer.getData('text/plain');
                    clearDragState();
                    if (sourceId) runMove(sourceId, dir);
                  }}
                  onDragEnd={clearDragState}
                >
                  <FolderOutlined />
                  <span className="folder-label-name" title={dir}>
                    {dir.replace(/\//g, ' / ')}
                  </span>
                  <button
                    type="button"
                    className="folder-action-btn"
                    title="重命名文件夹"
                    aria-label="重命名文件夹"
                    onClick={() => openFolderRename(dir)}
                  >
                    <EditOutlined />
                  </button>
                  <Popconfirm
                    title="删除文件夹"
                    description="其中的项目会移回根目录，不会删除项目文件。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => runFolderDelete(dir)}
                  >
                    <button
                      type="button"
                      className="folder-action-btn"
                      title="删除文件夹"
                      aria-label="删除文件夹"
                    >
                      <DeleteOutlined />
                    </button>
                  </Popconfirm>
                  <button
                    type="button"
                    className="folder-action-btn"
                    title="在此文件夹新建项目"
                    aria-label="在此文件夹新建项目"
                    onClick={() => {
                      onNavigate?.();
                      openNewProject(dir);
                    }}
                  >
                    <PlusOutlined />
                  </button>
                </div>
              ) : null}

              {items.map((project) => {
                const percent = project.stats.total
                  ? Math.round((project.stats.done / project.stats.total) * 100)
                  : 0;
                const active = page === 'project' && project.id === activeId;

                return (
                  <button
                    type="button"
                    key={project.id}
                    draggable
                    title="拖动可调整顺序，或拖到其他文件夹移动项目"
                    className={[
                      'project-item',
                      active ? 'is-active' : '',
                      draggingId === project.id ? 'row-dragging' : '',
                      dropInfo?.id === project.id ? `drop-${dropInfo.position}` : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      if (Date.now() - lastDragEndRef.current < 250) return;
                      onNavigate?.();
                      void selectProject(project.id);
                    }}
                    onDragStart={(event: DragEvent<HTMLElement>) => {
                      dragIdRef.current = project.id;
                      setDraggingId(project.id);
                      setDropInfo(null);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', project.id);
                    }}
                    onDragOver={(event: DragEvent<HTMLElement>) => {
                      if (dragFolderRef.current) return;
                      const sourceId = dragIdRef.current;
                      if (!sourceId || sourceId === project.id) return;
                      const source = projects.find((item) => item.id === sourceId);
                      if (!source) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setFolderDrop(null);
                      // Cross-folder drops move into the target folder; no
                      // before/after marker is meaningful there.
                      if (dirOf(source) !== dirOf(project)) {
                        setDropInfo(null);
                        return;
                      }
                      const position = dropSideFor(event);
                      setDropInfo((previous) =>
                        previous?.id === project.id &&
                        previous.position === position
                          ? previous
                          : { id: project.id, position },
                      );
                    }}
                    onDrop={(event: DragEvent<HTMLElement>) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const sourceId =
                        dragIdRef.current ?? event.dataTransfer.getData('text/plain');
                      const position = dropSideFor(event);
                      clearDragState();
                      if (!sourceId || sourceId === project.id) return;
                      applyDrop(sourceId, project.id, position);
                    }}
                    onDragEnd={clearDragState}
                  >
                    <div className="project-item-top">
                      <span className={`status-dot ${statusTone(project.status)}`} />
                      <span className="project-name">{project.name}</span>
                      {project.stats.p0 > 0 ? (
                        <span className="project-p0">{project.stats.p0} P0</span>
                      ) : null}
                    </div>
                    <div className="mini-progress">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <div className="project-meta">
                      <span className="project-code">
                        {project.code ?? project.path}
                      </span>
                      <span>
                        {project.stats.open} 未完成 / {project.stats.total}
                      </span>
                    </div>
                  </button>
                );
              })}

              {items.length === 0 && dir && !hasChildFolder ? (
                <div
                  className={`folder-empty${folderDrop === dir ? ' is-drop-target' : ''}`}
                  onDragOver={(event: DragEvent<HTMLDivElement>) => {
                    if (dragFolderRef.current) return;
                    const sourceId = dragIdRef.current;
                    if (!sourceId) return;
                    const source = projects.find((item) => item.id === sourceId);
                    if (!source || dirOf(source) === dir) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropInfo(null);
                    setFolderDrop(dir);
                  }}
                  onDragLeave={() => {
                    setFolderDrop((current) => (current === dir ? null : current));
                  }}
                  onDrop={(event: DragEvent<HTMLDivElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const sourceId =
                      dragIdRef.current ?? event.dataTransfer.getData('text/plain');
                    clearDragState();
                    if (sourceId) runMove(sourceId, dir);
                  }}
                >
                  空文件夹 · 拖入项目
                </div>
              ) : null}
            </div>
          );
        })}

        {!loadingProjects && groups.length === 0 ? (
          <div className="side-empty">
            {projects.length === 0 ? (
              <>
                <p>还没有项目。</p>
                <p>点击右上角 + 新建项目或文件夹。</p>
              </>
            ) : (
              <p>没有匹配的项目。</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="side-foot-row">
        <Tooltip title="设置">
          <button
            type="button"
            className="side-foot-btn"
            onClick={openSettings}
            aria-label="设置"
          >
            <SettingOutlined />
          </button>
        </Tooltip>
        <Tooltip title="重新扫描项目">
          <button
            type="button"
            className="side-foot-btn"
            onClick={() => void refreshAll()}
            aria-label="重新扫描项目"
          >
            <ReloadOutlined />
          </button>
        </Tooltip>
      </div>

      <Modal
        open={editingFolder !== null}
        title="重命名文件夹"
        okText="保存"
        cancelText="取消"
        confirmLoading={folderSaving}
        onCancel={() => setEditingFolder(null)}
        onOk={() => void submitFolderRename()}
        width={420}
      >
        <Input
          autoFocus
          value={folderDraft}
          placeholder="输入新的文件夹名称"
          onChange={(event) => setFolderDraft(event.target.value)}
          onPressEnter={() => void submitFolderRename()}
        />
        <div className="form-hint">
          支持多级路径，例如 2026/Q4。文件夹内的项目会自动跟随改名。
        </div>
      </Modal>
    </div>
  );
}
