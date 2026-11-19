import type { ProjectStats, TaskNode } from './types';

export type DueTone = 'danger' | 'today' | 'soon' | 'normal';

export interface DueBadge {
  label: string;
  tone: DueTone;
}

/** Calendar-day difference between a YYYY-MM-DD date and today (local time). */
export function dueDiff(due: string, now = new Date()): number {
  const [year, month, day] = due.split('-').map(Number);
  if (!year || !month || !day) return Number.NaN;
  const target = Date.UTC(year, month - 1, day);
  const base = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - base) / 86_400_000);
}

export function dueBadge(due?: string, now = new Date()): DueBadge | null {
  if (!due) return null;
  const diff = dueDiff(due, now);
  if (Number.isNaN(diff)) return null;
  if (diff < 0) return { label: `超时 ${-diff} 天`, tone: 'danger' };
  if (diff === 0) return { label: '今天到期', tone: 'today' };
  if (diff === 1) return { label: '明天到期', tone: 'soon' };
  if (diff <= 3) return { label: `还剩 ${diff} 天`, tone: 'soon' };
  return { label: `还剩 ${diff} 天`, tone: 'normal' };
}

export interface PriorityMeta {
  label: string;
  short: string;
  tone: 'p0' | 'p1' | 'p2' | 'other';
  rank: number;
}

const PRIORITY_META: Record<string, PriorityMeta> = {
  P0: { label: 'P0 紧急', short: 'P0', tone: 'p0', rank: 0 },
  P1: { label: 'P1 重要', short: 'P1', tone: 'p1', rank: 1 },
  P2: { label: 'P2 常规', short: 'P2', tone: 'p2', rank: 2 },
};

export function priorityMeta(priority?: string): PriorityMeta {
  if (!priority) return { label: '未设置', short: '—', tone: 'other', rank: 90 };
  return (
    PRIORITY_META[priority] ?? {
      label: priority,
      short: priority,
      tone: 'other',
      rank: 50,
    }
  );
}

export function collectStats(roots: TaskNode[], now = new Date()): ProjectStats {
  const stats: ProjectStats = {
    total: 0,
    open: 0,
    done: 0,
    p0: 0,
    overdue: 0,
    today: 0,
    byPriority: {},
  };

  const walk = (task: TaskNode) => {
    stats.total++;
    if (task.done) {
      stats.done++;
    } else {
      stats.open++;
      const priority = task.fields.priority ?? '未设置';
      stats.byPriority[priority] = (stats.byPriority[priority] ?? 0) + 1;
      if (priority === 'P0') stats.p0++;
      if (task.fields.due) {
        const diff = dueDiff(task.fields.due, now);
        if (diff < 0) stats.overdue++;
        else if (diff === 0) stats.today++;
      }
    }
    task.children.forEach(walk);
  };

  roots.forEach(walk);
  return stats;
}

export function flattenTasks(roots: TaskNode[]): TaskNode[] {
  const out: TaskNode[] = [];
  const walk = (task: TaskNode) => {
    out.push(task);
    task.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

export function findTask(roots: TaskNode[], id: string | null | undefined): TaskNode | undefined {
  if (!id) return undefined;
  return flattenTasks(roots).find((task) => task.id === id);
}

/** Parse a `deps` field into a de-duplicated list of predecessor task IDs. */
export function parseDeps(value?: string): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[,\s]+/).map((id) => id.trim()).filter(Boolean))];
}

/**
 * Would adding `newDeps` to `taskId` create a dependency cycle?
 * `effective` overlays the proposed deps on top of the current task graph.
 */
export function wouldCreateCycle(
  roots: TaskNode[],
  taskId: string,
  newDeps: string[],
): boolean {
  const graph = new Map<string, string[]>();
  for (const task of flattenTasks(roots)) {
    graph.set(task.id, parseDeps(task.fields.deps));
  }
  graph.set(taskId, [...new Set(newDeps)]);

  const reaches = (from: string, target: string, seen: Set<string>): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const dep of graph.get(from) ?? []) {
      if (reaches(dep, target, seen)) return true;
    }
    return false;
  };

  return newDeps.some((dep) => reaches(dep, taskId, new Set()));
}

/** True when `ancestorId` is `taskId` or one of its descendants. */
export function isSelfOrDescendant(
  roots: TaskNode[],
  taskId: string,
  candidateId: string,
): boolean {
  const target = findTask(roots, taskId);
  if (!target) return false;
  const stack = [target];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === candidateId) return true;
    stack.push(...node.children);
  }
  return false;
}

export function collectOwners(roots: TaskNode[]): string[] {
  const owners = new Set<string>();
  for (const task of flattenTasks(roots)) {
    if (task.fields.owner?.trim()) owners.add(task.fields.owner.trim());
  }
  return [...owners].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** WBS numbering in original file order: 1, 1.1, 1.1.1 ... */
export function collectCodes(roots: TaskNode[]): Map<string, string> {
  const codes = new Map<string, string>();
  const walk = (nodes: TaskNode[], prefix: string) => {
    nodes.forEach((node, index) => {
      const code = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      codes.set(node.id, code);
      walk(node.children, code);
    });
  };
  walk(roots, '');
  return codes;
}
