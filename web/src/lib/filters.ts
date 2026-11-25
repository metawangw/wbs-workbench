import {
  dueDiff,
  isTitleTask,
  isVersionTask,
  priorityMeta,
  splitOwners,
  type TaskNode,
} from '@wbs/shared';

export type DueFilter = 'overdue' | 'today' | 'soon' | 'none';
export type StatusFilter = 'open' | 'done';

/**
 * 到期 / 状态都是多选：空数组表示「全部」，选中多项时按「任一命中」判定，
 * 和「类型」过滤的操作方式保持一致（点开浮层勾选，而不是下拉单选的互斥项）。
 */
export interface Filters {
  q: string;
  /** 联系人也是多选：空数组 = 不限（全部包含）。 */
  owner: string[];
  due: DueFilter[];
  status: StatusFilter[];
}

export const DEFAULT_FILTERS: Filters = {
  q: '',
  owner: [],
  due: [],
  status: [],
};

export const DUE_LABELS: Record<DueFilter, string> = {
  overdue: '已超时',
  today: '今天到期',
  soon: '3 天内',
  none: '无截止',
};

export const DUE_KEYS: DueFilter[] = ['overdue', 'today', 'soon', 'none'];

export const STATUS_LABELS: Record<StatusFilter, string> = {
  open: '未完成',
  done: '已完成',
};

export const STATUS_KEYS: StatusFilter[] = ['open', 'done'];

export function hasActiveFilters(filters: Filters): boolean {
  return Boolean(
    filters.q.trim() ||
      filters.owner.length > 0 ||
      filters.due.length > 0 ||
      filters.status.length > 0,
  );
}

/**
 * Every piece of user-visible task content, lower-cased, for full-text search.
 * Includes the title, all inline fields (including custom ones), and every
 * progress entry — so a query can match any element of a task, not just the
 * handful of fields that had been hard-coded before.
 */
export function taskSearchText(task: TaskNode): string {
  const fieldParts = Object.entries(task.fields)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key} ${value}`);
  const progressParts = task.progress.map((entry) => `${entry.text} ${entry.author ?? ''}`);
  return [task.title, ...fieldParts, ...progressParts].join(' ').toLowerCase();
}

export function taskMatches(task: TaskNode, filters: Filters): boolean {
  if (filters.status.length > 0) {
    const state: StatusFilter = task.done ? 'done' : 'open';
    if (!filters.status.includes(state)) return false;
  }
  // 联系人可填多个（顿号连接）：选中项命中任意一个即保留。
  if (filters.owner.length > 0) {
    const owners = splitOwners(task.fields.owner);
    if (!filters.owner.some((name) => owners.includes(name))) return false;
  }

  if (filters.due.length > 0) {
    const due = task.fields.due;
    const diff = due ? dueDiff(due) : Number.NaN;
    // 多选项之间是「或」：命中任意一项即保留，和「类型」过滤的手感一致。
    const hit = filters.due.some((key) => {
      if (key === 'none') return !due;
      if (!due || Number.isNaN(diff)) return false;
      if (key === 'overdue') return !task.done && diff < 0;
      if (key === 'today') return !task.done && diff === 0;
      return !task.done && diff > 0 && diff <= 3;
    });
    if (!hit) return false;
  }

  const query = filters.q.trim().toLowerCase();
  if (query && !taskSearchText(task).includes(query)) return false;

  return true;
}

/** Filter while keeping ancestors of matching descendants visible. */
export function filterTree(nodes: TaskNode[], filters: Filters): TaskNode[] {
  const out: TaskNode[] = [];
  for (const node of nodes) {
    const children = filterTree(node.children, filters);
    if (taskMatches(node, filters) || children.length > 0) {
      out.push({ ...node, children });
    }
  }
  return out;
}

function compareSiblings(a: TaskNode, b: TaskNode): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  return a.line - b.line;
}

/** Keep WBS order, but completed siblings sink to the bottom. */
export function sortTree(nodes: TaskNode[]): TaskNode[] {
  return [...nodes]
    .sort(compareSiblings)
    .map((node) => ({ ...node, children: sortTree(node.children) }));
}

export interface BoardGroup {
  priority: string;
  tasks: TaskNode[];
}

/** 看板 / 甘特共用：三类任务是否参与展示。 */
export interface TaskTypeFilter {
  plain: boolean;
  title: boolean;
  version: boolean;
  /** 版本类型任务下的子任务是否一并展示（关掉则整棵子树收起）。 */
  versionChildren: boolean;
}

export const DEFAULT_TASK_TYPES: TaskTypeFilter = {
  plain: true,
  title: true,
  version: true,
  versionChildren: true,
};

export const TASK_TYPE_LABELS: Record<keyof TaskTypeFilter, string> = {
  plain: '普通任务',
  title: '标题类型',
  version: '版本类型',
  versionChildren: '版本子任务',
};

export function allTaskTypesOn(types: TaskTypeFilter): boolean {
  return types.plain && types.title && types.version && types.versionChildren;
}

export interface BoardOptions {
  /** 哪几类任务参与分类（被排除的类型其子任务会提到上一层）。 */
  types: TaskTypeFilter;
}

export const DEFAULT_BOARD_OPTIONS: BoardOptions = { types: DEFAULT_TASK_TYPES };

/**
 * Drop every task whose type is switched off and splice its children into the
 * parent list, so excluding 标题类型 / 版本类型 never hides the tasks under them.
 * 「版本子任务」关闭时，版本任务本身保留，但归属于它的任务（[version::id]）
 * 以及它层级下的子孙整棵移除。
 */
export function filterByTypes(
  nodes: TaskNode[],
  types: TaskTypeFilter,
  insideVersion = false,
): TaskNode[] {
  const out: TaskNode[] = [];
  for (const node of nodes) {
    const isTitle = isTitleTask(node.fields);
    const isVersion = isVersionTask(node.fields);
    // 任务通过 [version::id] 归属到某个版本，不一定挂在版本节点下面。
    const belongsToVersion = Boolean(node.fields.version?.trim());
    if (!types.versionChildren && (insideVersion || belongsToVersion)) continue;
    const children = filterByTypes(node.children, types, insideVersion || isVersion);
    const excluded =
      (isTitle && !types.title) ||
      (isVersion && !types.version) ||
      (!isTitle && !isVersion && !types.plain);
    if (excluded) out.push(...children);
    else out.push({ ...node, children });
  }
  return out;
}

/** 任务按文档顺序（也就是 WBS 序号）排列，看板不做已完成下沉。 */
function byWbsOrder(a: TaskNode, b: TaskNode): number {
  return a.line - b.line;
}

export function buildBoard(
  roots: TaskNode[],
  filters: Filters,
  options: BoardOptions = DEFAULT_BOARD_OPTIONS,
): BoardGroup[] {
  const visible = filterTree(roots, filters);
  const classified = filterByTypes(visible, options.types);
  const groups = new Map<string, TaskNode[]>();

  for (const root of classified) {
    const key = root.fields.priority ?? '未设置';
    const list = groups.get(key) ?? [];
    list.push({ ...root, children: sortByWbs(root.children) });
    groups.set(key, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      const rankDiff = priorityMeta(a).rank - priorityMeta(b).rank;
      return rankDiff !== 0 ? rankDiff : a.localeCompare(b, 'zh-Hans-CN');
    })
    .map(([priority, tasks]) => ({
      priority,
      tasks: tasks.sort(byWbsOrder),
    }));
}

/** 递归按序号（文档行号）排序，看板里已完成任务不再沉到组底部。 */
function sortByWbs(nodes: TaskNode[]): TaskNode[] {
  return [...nodes]
    .sort(byWbsOrder)
    .map((node) => ({ ...node, children: sortByWbs(node.children) }));
}

export function collectExpandableIds(nodes: TaskNode[]): string[] {
  const ids: string[] = [];
  const walk = (task: TaskNode) => {
    if (task.children.length) ids.push(task.id);
    task.children.forEach(walk);
  };
  nodes.forEach(walk);
  return ids;
}

export interface SectionGroup {
  key: string;
  name: string;
  isUngrouped: boolean;
  /** 分组描述（H2 行尾的 `<!-- desc:… -->` 注释）。 */
  description?: string;
  /** No H2 sections declared: render the ungrouped list without a header. */
  hideHead?: boolean;
  roots: TaskNode[];
}

/**
 * Group root tasks by their `## section`; ungrouped tasks come first, followed
 * by declared sections in document order (including empty ones). Shared by the
 * list view and the HTML/PDF export so both always agree.
 */
export function groupBySection(
  roots: TaskNode[],
  sections: string[],
  descriptions?: Record<string, string>,
): SectionGroup[] {
  const bySection = new Map<string, TaskNode[]>();
  for (const root of roots) {
    const key = root.section ?? '';
    const list = bySection.get(key) ?? [];
    list.push(root);
    bySection.set(key, list);
  }

  const result: SectionGroup[] = [];
  if (bySection.has('')) {
    result.push({
      key: '',
      name: '未分组',
      isUngrouped: true,
      // A project with no H2 sections has nothing to group against, so the
      // "未分组" label only adds noise. Hide the header in that case.
      hideHead: sections.length === 0,
      roots: bySection.get('')!,
    });
  }
  for (const name of sections) {
    result.push({
      key: name,
      name,
      isUngrouped: false,
      description: descriptions?.[name] || undefined,
      roots: bySection.get(name) ?? [],
    });
  }
  for (const [key, list] of bySection) {
    if (key && !sections.includes(key)) {
      result.push({
        key,
        name: key,
        isUngrouped: false,
        description: descriptions?.[key] || undefined,
        roots: list,
      });
    }
  }
  return result;
}
