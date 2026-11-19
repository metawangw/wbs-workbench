import { dueDiff, priorityMeta, type TaskNode } from '@wbs/shared';

export type DueFilter = 'all' | 'overdue' | 'today' | 'soon' | 'none';
export type StatusFilter = 'all' | 'open' | 'done';

export interface Filters {
  q: string;
  owner?: string;
  due: DueFilter;
  status: StatusFilter;
}

export const DEFAULT_FILTERS: Filters = {
  q: '',
  owner: undefined,
  due: 'all',
  status: 'all',
};

export function hasActiveFilters(filters: Filters): boolean {
  return Boolean(
    filters.q.trim() || filters.owner || filters.due !== 'all' || filters.status !== 'all',
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
  if (filters.status === 'open' && task.done) return false;
  if (filters.status === 'done' && !task.done) return false;
  if (filters.owner && task.fields.owner !== filters.owner) return false;

  if (filters.due !== 'all') {
    if (task.done) return false;
    if (filters.due === 'none') {
      if (task.fields.due) return false;
    } else {
      if (!task.fields.due) return false;
      const diff = dueDiff(task.fields.due);
      if (Number.isNaN(diff)) return false;
      if (filters.due === 'overdue' && diff >= 0) return false;
      if (filters.due === 'today' && diff !== 0) return false;
      if (filters.due === 'soon' && !(diff >= 0 && diff <= 3)) return false;
    }
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

function compareRoots(a: TaskNode, b: TaskNode): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const aDue = a.fields.due ?? '9999-12-31';
  const bDue = b.fields.due ?? '9999-12-31';
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  return a.line - b.line;
}

export function buildBoard(roots: TaskNode[], filters: Filters): BoardGroup[] {
  const visible = filterTree(roots, filters);
  const groups = new Map<string, TaskNode[]>();

  for (const root of visible) {
    const key = root.fields.priority ?? '未设置';
    const list = groups.get(key) ?? [];
    list.push({ ...root, children: sortTree(root.children) });
    groups.set(key, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      const rankDiff = priorityMeta(a).rank - priorityMeta(b).rank;
      return rankDiff !== 0 ? rankDiff : a.localeCompare(b, 'zh-Hans-CN');
    })
    .map(([priority, tasks]) => ({
      priority,
      tasks: tasks.sort(compareRoots),
    }));
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
