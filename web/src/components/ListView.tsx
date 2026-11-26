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
  PushpinFilled,
  PushpinOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  collectCodes,
  isFocused,
  isTitleTask,
  isLockedProjectStatus,
  isVersionTask,
  parseDeps,
  relatedTaskIds,
  showsCreated,
  type TaskNode,
} from '@wbs/shared';
import { useStore } from '../store';
import {
  collectExpandableIds,
  filterByTypes,
  filterTree,
  groupBySection,
  type SectionGroup,
} from '../lib/filters';
import {
  CreatedChip,
  CycleChip,
  DueChip,
  ImportanceChip,
  LatestProgress,
  OwnerChip,
  PriorityPill,
  StatusPill,
  VersionChip,
  VersionTypeTag,
} from './atoms';
import { LIST_COLUMN_WIDTHS, type ListColumnKey } from '../lib/columns';
import { fontSizeBump } from '../lib/settings';
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

type TaskGroup = SectionGroup;

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
  const locked = isLockedProjectStatus(project?.status);
  const filters = useStore((state) => state.filters);
  const collapsed = useStore((state) => state.collapsed);
  const toggleCollapsed = useStore((state) => state.toggleCollapsed);
  const toggleDone = useStore((state) => state.toggleDone);
  const openTask = useStore((state) => state.openTask);
  const openCreate = useStore((state) => state.openCreate);
  const openCreateInSection = useStore((state) => state.openCreateInSection);
  const activeId = useStore((state) => state.activeId);
  const toggleFocus = useStore((state) => state.toggleFocus);
  const moveTask = useStore((state) => state.moveTask);
  const moveTaskToSection = useStore((state) => state.moveTaskToSection);
  const createSection = useStore((state) => state.createSection);
  const renameSection = useStore((state) => state.renameSection);
  const deleteSection = useStore((state) => state.deleteSection);
  const saveSectionDescription = useStore((state) => state.saveSectionDescription);
  const sectionModalOpen = useStore((state) => state.sectionModalOpen);
  const closeNewSection = useStore((state) => state.closeNewSection);
  const resetFilters = useStore((state) => state.resetFilters);
  const highlightTaskId = useStore((state) => state.highlightTaskId);
  const clearTaskHighlight = useStore((state) => state.clearTaskHighlight);
  const jumpToTask = useStore((state) => state.jumpToTask);
  const { message } = AntApp.useApp();

  // 版本 id → 版本任务，列表里点「版本」标识要能取到它的名称。
  const versionTasks = useMemo(() => {
    const map = new Map<string, TaskNode>();
    const walk = (nodes: TaskNode[]) => {
      nodes.forEach((node) => {
        if (isVersionTask(node.fields)) map.set(node.id, node);
        walk(node.children);
      });
    };
    walk(project?.roots ?? []);
    return map;
  }, [project]);

  const [dragState, setDragState] = useState<DragState | null>(null);
  // 鼠标停在哪一条任务上：只记录「这一条有前置任务」的情况，用来高亮它的前置。
  const depPeek = useStore((state) => state.depPeek);
  const setDepPeek = useStore((state) => state.setDepPeek);
  const dragIdRef = useRef<string | null>(null);
  const lastDragEndRef = useRef<number>(0);
  const collapsedGroups = useStore((state) => state.collapsedGroups);
  const toggleCollapsedGroup = useStore((state) => state.toggleCollapsedGroup);
  const resetCollapsedGroups = useStore((state) => state.resetCollapsedGroups);
  const [sectionModal, setSectionModal] = useState<{
    mode: 'create' | 'rename';
    value: string;
    old?: string;
  } | null>(null);
  const [sectionSaving, setSectionSaving] = useState(false);
  const [descModal, setDescModal] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [descSaving, setDescSaving] = useState(false);

  // 切换视图时别把「前置高亮」的压暗状态留在别的视图里。
  useEffect(() => () => setDepPeek(null), [setDepPeek]);

  // The Topbar "新建分组" button opens the modal through the store. Mirror
  // that signal into the local modal state so the existing create/rename
  // flow (including its input value) stays exactly as it was.
  useEffect(() => {
    if (!sectionModalOpen) return;
    setSectionModal({ mode: 'create', value: '', old: undefined });
    closeNewSection();
  }, [sectionModalOpen, closeNewSection]);

  // 从里程碑卡片跳过来的任务：展开分组、滚到屏幕中间，并短暂高亮这一行。
  useEffect(() => {
    if (!highlightTaskId) return;
    resetCollapsedGroups();
    const scrollTimer = window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(
        `tr[data-row-key="${highlightTaskId}"]`,
      );
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 180);
    const clearTimer = window.setTimeout(() => clearTaskHighlight(), 2600);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightTaskId, clearTaskHighlight, resetCollapsedGroups]);

  // 浏览器算 nowrap 文本宽度时按整像素取整，文字实际右边界可能比盒子多出零点
  // 几像素；这时 text-overflow 也会把最后一个字整个换成「…」，看着就像「后面
  // 没内容了还显示省略号」。这里只处理「差不到 4px」的情况：按真实文字宽度补
  // 宽 1px，多出来的像素落在右侧留白里，不会压到「最新进展」。
  useEffect(() => {
    const fit = () => {
      for (const el of document.querySelectorAll<HTMLElement>('.lt-title')) {
        el.style.removeProperty('width');
        const range = document.createRange();
        range.selectNodeContents(el);
        const box = el.getBoundingClientRect();
        const diff = range.getBoundingClientRect().right - box.right;
        if (diff > -0.6 && diff < 4) {
          el.style.width = `${Math.ceil(box.width + diff) + 1}px`;
        }
      }
    };
    const frame = requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fit);
    };
  });

  const roots = project?.roots ?? [];
  const declaredSections = project?.sections ?? [];
  const sectionDescriptions = project?.sectionDescriptions ?? {};
  const boardTypes = useStore((state) => state.boardTypes);
  // 序号一律按文件顺序（`collectCodes` 对未筛选的整棵树编号），不随筛选、
  // 折叠或「已完成沉底」重排；这样列表、看板、甘特图和导出的编号永远一致。
  const codes = useMemo(() => collectCodes(roots), [roots]);
  const visible = useMemo(
    () => filterByTypes(filterTree(roots, filters), boardTypes),
    [roots, filters, boardTypes],
  );
  const index = useMemo(() => buildIndex(visible), [visible]);

  // Group roots by their `## section`; the same helper drives the export.
  const groups = useMemo<TaskGroup[]>(
    () => groupBySection(visible, declaredSections, sectionDescriptions),
    [visible, declaredSections, sectionDescriptions],
  );

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

  const listColumns = useStore((state) => state.listColumns);
  const fontSize = useStore((state) => state.appearance.fontSize);
  const showCheckbox = useStore((state) => state.appearance.showCheckbox !== false);
  // 「最新进展」的两项展示偏好：内容档位（label/date/full）与左右位置。
  // 都通过容器上的 data-* 交给 CSS 处理，避免给每一行都传一遍 props。
  const progressDetail = useStore((state) => state.appearance.listProgressDetail ?? 'full');
  const progressAlign = useStore((state) => state.appearance.listProgressAlign ?? 'right');
  // Column widths are tuned for the default 14px row text; scale them with the
  // font-size setting so larger text never overflows its cell (and never
  // forces a horizontal scrollbar because of content spilling out).
  const widthScale = (12 + fontSizeBump(fontSize)) / 14;
  const colWidth = (key: ListColumnKey) =>
    Math.round(LIST_COLUMN_WIDTHS[key] * widthScale);

  const allColumns: ColumnsType<TableRow> = [
    {
      title: '任务',
      key: 'task',
      render: (_, row) => {
        // Task indent is stored as leading spaces (2 per level) in Markdown.
        const level = Math.max(0, Math.floor(row.indent / 2));
        const hasChildren = (row.children?.length ?? 0) > 0;
        const expanded = !collapsed[row.id];
        const isTitle = isTitleTask(row.fields);
        const isVersion = isVersionTask(row.fields);
        const versionOf = row.fields.version
          ? versionTasks.get(row.fields.version)
          : undefined;
        const focused = isFocused(row.fields);
        return (
          <div
            className={`lt-task${isTitle ? ' is-title' : ''}${
              isVersion ? ' is-version-task' : ''
            }`}
            style={{ paddingLeft: level * 15 }}
          >
            {/* One flat flex row for every task, title types included: the code
                and checkbox stay in the same rail so the list scans cleanly. */}
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
            {showCheckbox ? (
              <span
                className="lt-check"
                onClick={(event) => event.stopPropagation()}
              >
                <Checkbox
                  checked={row.done}
                  disabled={locked}
                  onChange={() => {
                    void toggleDone(row).catch((error: unknown) => {
                      message.error(error instanceof Error ? error.message : '更新失败');
                    });
                  }}
                />
              </span>
            ) : null}
            <span className="lt-code">{codes.get(row.id)}</span>
            {/* Hover actions share one zero-net-width slot: the focus pin sits
                inline before the add button so it never widens the
                number→title gap. */}
            <span className="lt-hover-actions">
              <Tooltip title={focused ? '取消今日关注' : '标记到今日关注'}>
                <Button
                  type="text"
                  size="small"
                  className={`lt-focus-btn${focused ? ' is-on' : ''}`}
                  disabled={locked}
                  aria-label={focused ? '取消今日关注' : '标记到今日关注'}
                  icon={focused ? <PushpinFilled /> : <PushpinOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!activeId) return;
                    void toggleFocus(activeId, row.id, focused).catch(
                      (error: unknown) => {
                        message.error(
                          error instanceof Error ? error.message : '更新标记失败',
                        );
                      },
                    );
                  }}
                />
              </Tooltip>
              <Tooltip title="添加子任务">
                <Button
                  type="text"
                  size="small"
                  className="lt-add-child"
                  disabled={locked}
                  aria-label="添加子任务"
                  icon={<PlusOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    openCreate(row.id);
                  }}
                />
              </Tooltip>
            </span>
            {showsCreated(row.fields) ? (
              <CreatedChip created={row.fields.created} />
            ) : null}
            {isVersion ? <VersionTypeTag /> : null}
            <span className={`lt-title${row.done ? ' is-done' : ''}`} title={row.title}>
              {row.title}
            </span>
            {versionOf ? (
              <VersionChip
                title={versionOf.title}
                onClick={() => jumpToTask(versionOf.id)}
              />
            ) : row.fields.version ? (
              <span className="version-chip is-missing" title="关联的版本任务已不存在">
                版本失效
              </span>
            ) : null}
            {/* 标题行只承担分组作用，不展示最新进展；已完成任务（含普通任务）同样保留最新进展。 */}
            {!isTitle && row.progress.length > 0 ? (
              <span className="lt-progress">
                <LatestProgress progress={row.progress} inline />
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      title: '联系人',
      key: 'owner',
      width: colWidth('owner'),
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
      width: colWidth('priority'),
      render: (_, row) => <PriorityPill priority={row.fields.priority} />,
    },
    {
      title: '重要性',
      key: 'importance',
      width: colWidth('importance'),
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
      width: colWidth('due'),
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
      width: colWidth('cycle'),
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
      width: colWidth('status'),
      render: (_, row) => <StatusPill done={row.done} />,
    },
  ];

  // 「任务」列承载勾选、编号与标题，始终保留；其余列按用户的列设置显隐。
  const columns = allColumns.filter(
    (column) => column.key === 'task' || listColumns[column.key as ListColumnKey],
  );

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

  const submitDescModal = async () => {
    if (!descModal) return;
    setDescSaving(true);
    try {
      await saveSectionDescription(descModal.key, descModal.value.trim());
      message.success('分组描述已保存');
      setDescModal(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setDescSaving(false);
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
        // Fixed layout keeps the column widths stable: without it the browser
        // lets a long task title eat the other columns.
        tableLayout="fixed"
        columns={columns}
        dataSource={toRows(group.roots)}
        rowKey="id"
        pagination={false}
        size="small"
        // No `scroll.x`: the table always fills the available width and the
        // browser shrinks the fixed-width columns proportionally when the panel
        // gets narrow, so a horizontal scrollbar only shows up if content would
        // still overflow — which the cell clipping rules prevent.
        expandable={{
          expandedRowKeys,
          indentSize: 0,
          // The chevron now lives inside the task cell (see columns[0]) right
          // next to the checkbox; antd must not render its own icon column.
          expandIcon: () => null,
        }}
        rowClassName={(row) =>
          [
            row.done ? 'table-row-done' : '',
            isTitleTask(row.fields) ? 'table-row-title' : '',
            isVersionTask(row.fields) ? 'table-row-version' : '',
            row.id === highlightTaskId ? 'is-jump-target' : '',
            depPeek?.src === row.id ? 'is-dep-src' : '',
            depPeek?.deps.includes(row.id) ? 'is-dep-hl' : '',
          ]
            .filter(Boolean)
            .join(' ')
        }
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
            draggable: !locked,
            onMouseEnter: () => {
              if (dragState) return;
              const related = relatedTaskIds(row.fields);
              setDepPeek(related.length ? { src: row.id, deps: related } : null);
            },
            onMouseLeave: () => {
              if (useStore.getState().depPeek?.src === row.id) setDepPeek(null);
            },
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
    <div
      className="list-view has-groups"
      data-progress-detail={progressDetail}
      data-progress-align={progressAlign}
      data-dep-peek={depPeek ? '1' : undefined}
    >
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
            {!group.hideHead ? (
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
                onClick={() => toggleCollapsedGroup(group.key)}
                aria-label={collapsedGroup ? '展开分组' : '收起分组'}
              >
                {collapsedGroup ? <RightOutlined /> : <DownOutlined />}
              </button>
              <span className="group-name">
                {group.name}
              </span>
              <span className="group-meta">共 {count} 项</span>
              {!group.isUngrouped ? (
                <button
                  type="button"
                  className={`group-desc${group.description ? '' : ' is-empty'}`}
                  title={group.description ? group.description : '添加分组描述'}
                  disabled={locked}
                  onClick={() =>
                    setDescModal({ key: group.key, value: group.description ?? '' })
                  }
                >
                  {group.description || '添加描述'}
                </button>
              ) : null}
              <div className="group-actions" style={locked ? { pointerEvents: 'none', opacity: 0.45 } : undefined}>
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
            ) : null}
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

      <Modal
        open={Boolean(descModal)}
        onCancel={() => setDescModal(null)}
        onOk={() => void submitDescModal()}
        okText="保存"
        cancelText="取消"
        confirmLoading={descSaving}
        title="分组描述"
        destroyOnClose
      >
        <div className="field-hint">描述显示在分组标题右侧，留空可清除。</div>
        <Input
          autoFocus
          value={descModal?.value ?? ''}
          maxLength={200}
          placeholder="输入分组描述，例如：本周重点跟进的事项"
          onChange={(event) =>
            setDescModal((state) =>
              state ? { ...state, value: event.target.value } : state,
            )
          }
          onPressEnter={() => void submitDescModal()}
        />
      </Modal>
    </div>
  );
}
