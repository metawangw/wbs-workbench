import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  App as AntApp,
  Button,
  Checkbox,
  Input,
  Modal,
  Popconfirm,
  Table,
  Tooltip,
} from 'antd';
import {
  CaretRightOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { collectCodes, type TaskNode } from '@wbs/shared';
import { useStore } from '../store';
import {
  collectExpandableIds,
  filterTree,
  sortTree,
} from '../lib/filters';
import {
  CycleChip,
  DueChip,
  ImportanceChip,
  LatestProgress,
  OwnerChip,
  PriorityPill,
  StatusPill,
} from './atoms';
import { NoMatches } from './EmptyStates';

type TableRow = Omit<TaskNode, 'children'> & { children?: TableRow[] };
type DropPosition = 'before' | 'after' | 'child';

interface DragState {
  dragId: string;
  targetId: string;
  position: DropPosition;
  /** Row that physically shows the insertion indicator. */
  indicatorId: string;
  /** True when the drop will move the task into a different section. */
  crossSection: boolean;
  /** Section key of the current drop target. */
  targetSection: string;
}

interface TaskGroup {
  key: string;
  name: string;
  isUngrouped: boolean;
  roots: TaskNode[];
}

function toRows(nodes: TaskNode[]): TableRow[] {
  return nodes.map(({ children, ...rest }) => ({
    ...rest,
    children: children.length ? toRows(children) : undefined,
  }));
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, .ant-checkbox-wrapper, .ant-table-row-expand-icon, .ant-select, .group-head',
    ),
  );
}

/** Map a pointer's vertical offset inside a row to a drop position. */
function dropPositionFor(event: DragEvent<HTMLElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  if (ratio < 0.4) return 'before';
  if (ratio > 0.6) return 'after';
  return 'child';
}

interface TreeIndex {
  nodes: Map<string, TaskNode>;
  parents: Map<string, string>;
}

/** Flatten the visible tree so a drop can resolve its real insertion anchor. */
function buildIndex(roots: TaskNode[]): TreeIndex {
  const nodes = new Map<string, TaskNode>();
  const parents = new Map<string, string>();
  const walk = (node: TaskNode, parentId?: string) => {
    nodes.set(node.id, node);
    if (parentId) parents.set(node.id, parentId);
    node.children.forEach((child) => walk(child, node.id));
  };
  roots.forEach((root) => walk(root));
  return { nodes, parents };
}

/**
 * Mirror the server rule: `before`/`after` adopt the clamped anchor's level, so
 * dropping beside a shallower row promotes the task. The target is clamped to
 * its nearest ancestor that is not deeper than the dragged task; highlighting
 * that row keeps the insertion indicator honest.
 */
function resolveAnchorId(index: TreeIndex, targetId: string, level: number): string {
  let currentId = targetId;
  for (;;) {
    const node = index.nodes.get(currentId);
    if (!node || node.indent <= level) break;
    const parentId = index.parents.get(currentId);
    if (!parentId) break;
    currentId = parentId;
  }
  return currentId;
}

/**
 * An `after` drop lands below the anchor's whole branch, so the indicator has
 * to sit on the last expanded descendant rather than on the anchor itself.
 */
function lastVisibleDescendantId(
  index: TreeIndex,
  anchorId: string,
  collapsed: Record<string, boolean>,
): string {
  let currentId = anchorId;
  for (;;) {
    const node = index.nodes.get(currentId);
    if (!node || node.children.length === 0 || collapsed[currentId]) break;
    currentId = node.children[node.children.length - 1].id;
  }
  return currentId;
}

type ResolvedDrop =
  | { crossSection: true; section: string; indicatorId: string }
  | {
      crossSection: false;
      position: DropPosition;
      anchorId: string;
      indicatorId: string;
    };

export default function ListView() {
  const project = useStore((state) => state.project);
  const filters = useStore((state) => state.filters);
  const collapsed = useStore((state) => state.collapsed);
  const toggleCollapsed = useStore((state) => state.toggleCollapsed);
  const toggleDone = useStore((state) => state.toggleDone);
  const openTask = useStore((state) => state.openTask);
  const openCreateInSection = useStore((state) => state.openCreateInSection);
  const moveTask = useStore((state) => state.moveTask);
  const moveTaskToSection = useStore((state) => state.moveTaskToSection);
  const createSection = useStore((state) => state.createSection);
  const renameSection = useStore((state) => state.renameSection);
  const deleteSection = useStore((state) => state.deleteSection);
  const sectionModalOpen = useStore((state) => state.sectionModalOpen);
  const closeNewSection = useStore((state) => state.closeNewSection);
  const resetFilters = useStore((state) => state.resetFilters);
  const { message } = AntApp.useApp();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const lastDragEndRef = useRef<number>(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [sectionModal, setSectionModal] = useState<{
    mode: 'create' | 'rename';
    value: string;
    old?: string;
  } | null>(null);
  const [sectionSaving, setSectionSaving] = useState(false);

  // The Topbar "新建分组" button opens the modal through the store. Mirror
  // that signal into the local modal state so the existing create/rename
  // flow (including its input value) stays exactly as it was.
  useEffect(() => {
    if (!sectionModalOpen) return;
    setSectionModal({ mode: 'create', value: '', old: undefined });
    closeNewSection();
  }, [sectionModalOpen, closeNewSection]);

  const roots = project?.roots ?? [];
  const declaredSections = project?.sections ?? [];
  const visible = useMemo(
    () => sortTree(filterTree(roots, filters)),
    [roots, filters],
  );
  const index = useMemo(() => buildIndex(visible), [visible]);

  // Group roots by their `## section`; ungrouped tasks come first, followed by
  // declared sections in document order (including empty ones).
  const groups = useMemo<TaskGroup[]>(() => {
    const bySection = new Map<string, TaskNode[]>();
    for (const root of visible) {
      const key = root.section ?? '';
      const list = bySection.get(key) ?? [];
      list.push(root);
      bySection.set(key, list);
    }
    const result: TaskGroup[] = [];
    if (bySection.has('')) {
      result.push({ key: '', name: '未分组', isUngrouped: true, roots: bySection.get('')! });
    }
    for (const name of declaredSections) {
      result.push({
        key: name,
        name,
        isUngrouped: false,
        roots: bySection.get(name) ?? [],
      });
    }
    for (const [key, list] of bySection) {
      if (key && !declaredSections.includes(key)) {
        result.push({ key, name: key, isUngrouped: false, roots: list });
      }
    }
    return result;
  }, [visible, declaredSections]);

  // Map every task id to its group key, used to detect cross-section drops.
  const sectionOfTask = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (node: TaskNode, key: string) => {
      map.set(node.id, key);
      node.children.forEach((child) => walk(child, key));
    };
    groups.forEach((group) => group.roots.forEach((root) => walk(root, group.key)));
    return map;
  }, [groups]);

  const columns: ColumnsType<TableRow> = [
    {
      title: '任务',
      key: 'task',
      render: (_, row) => {
        const codes = collectCodes(
          groups.find((group) => group.key === sectionOfTask.get(row.id))?.roots ?? [],
        );
        // Task indent is stored as leading spaces (2 per level) in Markdown.
        const level = Math.max(0, Math.floor(row.indent / 2));
        const hasChildren = (row.children?.length ?? 0) > 0;
        const expanded = !collapsed[row.id];
        return (
          <div className="lt-task" style={{ paddingLeft: level * 15 }}>
            {hasChildren ? (
              <button
                type="button"
                className="chevron-btn list-expand-btn"
                aria-label={expanded ? '收起子任务' : '展开子任务'}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCollapsed(row.id);
                }}
              >
                <CaretRightOutlined className={expanded ? 'chevron-open' : ''} />
              </button>
            ) : (
              <span className="chevron-spacer" />
            )}
            <span
              className="lt-check"
              onClick={(event) => event.stopPropagation()}
            >
              <Checkbox
                checked={row.done}
                onChange={() => {
                  void toggleDone(row).catch((error: unknown) => {
                    message.error(error instanceof Error ? error.message : '更新失败');
                  });
                }}
              />
            </span>
            <span className="lt-code">{codes.get(row.id)}</span>
            <span className={`lt-title${row.done ? ' is-done' : ''}`} title={row.title}>
              {row.title}
            </span>
            {!row.done && row.progress.length > 0 ? (
              <span className="lt-progress">
                <LatestProgress progress={row.progress} inline />
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      title: '负责人',
      key: 'owner',
      width: 88,
      render: (_, row) =>
        row.fields.owner ? (
          <OwnerChip name={row.fields.owner} />
        ) : (
          <span className="cell-muted">—</span>
        ),
    },
    {
      title: '优先级',
      key: 'priority',
      width: 64,
      render: (_, row) => <PriorityPill priority={row.fields.priority} />,
    },
    {
      title: '重要性',
      key: 'importance',
      width: 64,
      render: (_, row) =>
        row.fields.importance ? (
          <ImportanceChip importance={row.fields.importance} />
        ) : (
          <span className="cell-muted">—</span>
        ),
    },
    {
      title: '截止',
      key: 'due',
      width: 152,
      render: (_, row) =>
        row.fields.due ? (
          <DueChip due={row.fields.due} done={row.done} />
        ) : (
          <span className="cell-muted">—</span>
        ),
    },
    {
      title: '周期',
      key: 'cycle',
      width: 64,
      render: (_, row) =>
        row.fields.cycle ? (
          <CycleChip cycle={row.fields.cycle} />
        ) : (
          <span className="cell-muted">—</span>
        ),
    },
    {
      title: '状态',
      key: 'status',
      width: 78,
      render: (_, row) => <StatusPill done={row.done} />,
    },
  ];

  if (!project) return null;
  if (visible.length === 0 && groups.every((group) => group.roots.length === 0)) {
    return <NoMatches onReset={resetFilters} />;
  }

  const openSectionModal = (mode: 'create' | 'rename', old?: string) => {
    setSectionModal({ mode, value: mode === 'rename' ? old ?? '' : '', old });
  };

  const submitSectionModal = async () => {
    if (!sectionModal) return;
    const value = sectionModal.value.trim();
    if (!value) {
      message.warning('请输入分组名称');
      return;
    }
    setSectionSaving(true);
    try {
      if (sectionModal.mode === 'create') {
        await createSection(value);
        message.success('分组已创建');
      } else {
        await renameSection(sectionModal.old ?? '', value);
        message.success('分组已重命名');
      }
      setSectionModal(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setSectionSaving(false);
    }
  };

  const resolveDrop = (
    sourceId: string,
    rowId: string,
    event: DragEvent<HTMLElement>,
  ): ResolvedDrop => {
    const sourceSection = sectionOfTask.get(sourceId);
    const targetSection = sectionOfTask.get(rowId);
    if (sourceSection !== targetSection) {
      return {
        crossSection: true,
        section: targetSection ?? '',
        indicatorId: rowId,
      };
    }
    const position = dropPositionFor(event);
    const level = index.nodes.get(sourceId)?.indent ?? 0;
    const anchorId =
      position === 'child' ? rowId : resolveAnchorId(index, rowId, level);
    const indicatorId =
      position === 'after'
        ? lastVisibleDescendantId(index, anchorId, collapsed)
        : anchorId;
    return { crossSection: false, position, anchorId, indicatorId };
  };

  const finishDrag = () => {
    setDragState(null);
    dragIdRef.current = null;
    lastDragEndRef.current = Date.now();
  };

  const executeDrop = (sourceId: string, resolved: ResolvedDrop, rowId: string) => {
    if (!sourceId || sourceId === rowId) {
      if (resolved.crossSection && sourceId) {
        void moveTaskToSection(sourceId, resolved.section).catch((error: unknown) => {
          message.error(error instanceof Error ? error.message : '移动失败');
        });
      }
      return;
    }
    if (resolved.crossSection) {
      void moveTaskToSection(sourceId, resolved.section).catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : '移动失败');
      });
    } else {
      void moveTask(sourceId, rowId, resolved.position).catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : '排序失败');
      });
    }
  };

  const renderTable = (group: TaskGroup) => {
    const groupIds = collectExpandableIds(group.roots);
    const expandedRowKeys = groupIds.filter((id) => !collapsed[id]);
    const collapsedGroup = Boolean(collapsedGroups[group.key]);

    return (
      <Table<TableRow>
        className="wbs-table is-sortable group-table"
        columns={columns}
        dataSource={toRows(group.roots)}
        rowKey="id"
        pagination={false}
        size="small"
        scroll={{ x: 1000 }}
        expandable={{
          expandedRowKeys,
          indentSize: 0,
          // The chevron now lives inside the task cell (see columns[0]) right
          // next to the checkbox; antd must not render its own icon column.
          expandIcon: () => null,
        }}
        rowClassName={(row) => (row.done ? 'table-row-done' : '')}
        onRow={(row) => {
          const dragging = dragState?.dragId === row.id;
          const isTarget = Boolean(dragState?.indicatorId) && dragState?.indicatorId === row.id;
          const cross = dragState?.crossSection;
          const classNames = [
            dragging ? 'row-dragging' : '',
            !cross && isTarget && dragState?.position === 'before' ? 'drop-before' : '',
            !cross && isTarget && dragState?.position === 'after' ? 'drop-after' : '',
            !cross && isTarget && dragState?.position === 'child' ? 'drop-child' : '',
            cross && isTarget ? 'drop-cross' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return {
            className: classNames,
            draggable: true,
            title: cross
              ? '松开以把任务移动到该分组，并自动重排序号'
              : '拖动到上/下边缘调整顺序并匹配目标层级，拖到正中设为子任务；拖到其他分组的任务或分组头可跨组移动',
            onDragStart: (event: DragEvent<HTMLElement>) => {
              if (isInteractive(event.target)) {
                event.preventDefault();
                return;
              }
              dragIdRef.current = row.id;
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', row.id);
              setDragState({
                dragId: row.id,
                targetId: '',
                position: 'child',
                indicatorId: '',
                crossSection: false,
                targetSection: '',
              });
            },
            onDragOver: (event: DragEvent<HTMLElement>) => {
              const sourceId = dragIdRef.current;
              if (!sourceId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (sourceId === row.id) {
                setDragState((previous) =>
                  previous
                    ? { ...previous, targetId: '', indicatorId: '' }
                    : previous,
                );
                return;
              }
              const resolved = resolveDrop(sourceId, row.id, event);
              const resolvedPosition: DropPosition = resolved.crossSection
                ? 'child'
                : resolved.position;
              setDragState((previous) => {
                if (
                  previous?.dragId === sourceId &&
                  previous.targetId === row.id &&
                  previous.indicatorId === resolved.indicatorId &&
                  previous.crossSection === resolved.crossSection &&
                  (resolved.crossSection || previous.position === resolvedPosition)
                ) {
                  return previous;
                }
                return {
                  dragId: sourceId,
                  targetId: row.id,
                  position: resolved.crossSection ? 'child' : resolved.position,
                  indicatorId: resolved.indicatorId,
                  crossSection: resolved.crossSection,
                  targetSection: resolved.crossSection ? resolved.section : group.key,
                };
              });
            },
            onDrop: (event: DragEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
              const sourceId =
                dragIdRef.current ?? event.dataTransfer.getData('text/plain');
              const resolved = sourceId
                ? resolveDrop(sourceId, row.id, event)
                : null;
              finishDrag();
              if (sourceId && resolved) executeDrop(sourceId, resolved, row.id);
            },
            onDragEnd: finishDrag,
            onClick: (event) => {
              if (Date.now() - lastDragEndRef.current < 250) return;
              if (isInteractive(event.target)) return;
              openTask(row.id);
            },
          };
        }}
      />
    );
  };

  return (
    <div className="list-view has-groups">
      {groups.map((group) => {
        const collapsedGroup = Boolean(collapsedGroups[group.key]);
        const dropActive =
          dragState?.crossSection && dragState.targetSection === group.key;
        const count = group.roots.reduce((total, root) => {
          const walk = (node: TaskNode): number =>
            1 + node.children.reduce((sum, child) => sum + walk(child), 0);
          return total + walk(root);
        }, 0);
        return (
          <section
            className={`task-group${dropActive ? ' is-drop-target' : ''}`}
            key={group.key || '__ungrouped__'}
          >
            <div
              className={`group-head${collapsedGroup ? ' is-collapsed' : ''}`}
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                const sourceId = dragIdRef.current;
                if (!sourceId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragState((previous) =>
                  previous?.dragId === sourceId &&
                  previous.crossSection &&
                  previous.targetSection === group.key &&
                  previous.targetId === ''
                    ? previous
                    : {
                        dragId: sourceId,
                        targetId: '',
                        position: 'child',
                        indicatorId: '',
                        crossSection: true,
                        targetSection: group.key,
                      },
                );
              }}
              onDragLeave={(event: DragEvent<HTMLDivElement>) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragState((previous) =>
                  previous?.crossSection && previous.targetId === ''
                    ? { ...previous, targetSection: '', crossSection: false }
                    : previous,
                );
              }}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                const sourceId =
                  dragIdRef.current ?? event.dataTransfer.getData('text/plain');
                const from = sourceId ? sectionOfTask.get(sourceId) : undefined;
                finishDrag();
                if (sourceId && from !== group.key) {
                  void moveTaskToSection(sourceId, group.key).catch(
                    (error: unknown) => {
                      message.error(
                        error instanceof Error ? error.message : '移动失败',
                      );
                    },
                  );
                }
              }}
            >
              <button
                type="button"
                className="group-toggle"
                onClick={() =>
                  setCollapsedGroups((state) => ({
                    ...state,
                    [group.key]: !state[group.key],
                  }))
                }
                aria-label={collapsedGroup ? '展开分组' : '收起分组'}
              >
                {collapsedGroup ? <RightOutlined /> : <DownOutlined />}
              </button>
              <span className="group-name">
                {group.name}
              </span>
              <span className="group-meta">共 {count} 项</span>
              <div className="group-actions">
                <Tooltip title="在此分组新建任务">
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => openCreateInSection(group.key)}
                    aria-label="在此分组新建任务"
                  />
                </Tooltip>
                {!group.isUngrouped ? (
                  <>
                    <Tooltip title="重命名分组">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openSectionModal('rename', group.key)}
                        aria-label="重命名分组"
                      />
                    </Tooltip>
                    <Popconfirm
                      title="删除分组？"
                      description="该分组的任务会移到未分组，不会删除任务。"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => {
                        void deleteSection(group.key).catch((error: unknown) => {
                          message.error(
                            error instanceof Error ? error.message : '删除失败',
                          );
                        });
                      }}
                    >
                      <Tooltip title="删除分组">
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label="删除分组"
                        />
                      </Tooltip>
                    </Popconfirm>
                  </>
                ) : null}
              </div>
            </div>
            {!collapsedGroup ? renderTable(group) : null}
          </section>
        );
      })}

      <Modal
        open={Boolean(sectionModal)}
        onCancel={() => setSectionModal(null)}
        onOk={() => void submitSectionModal()}
        okText={sectionModal?.mode === 'rename' ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={sectionSaving}
        title={sectionModal?.mode === 'rename' ? '重命名分组' : '新建分组'}
        destroyOnClose
      >
        <Input
          autoFocus
          value={sectionModal?.value ?? ''}
          maxLength={60}
          placeholder="输入分组名称，例如：本周例检"
          onChange={(event) =>
            setSectionModal((state) =>
              state ? { ...state, value: event.target.value } : state,
            )
          }
          onPressEnter={() => void submitSectionModal()}
        />
      </Modal>
    </div>
  );
}
