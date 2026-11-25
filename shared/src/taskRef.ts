import type { TaskNode } from './types';
import { collectCodes, flattenTasks } from './view';

/**
 * 页面里引用任务的写法：`![[2.1]]`，可选带别名 `![[2.1|自定义文字]]`。
 *
 * 复用 Obsidian 的嵌入语法（和插入图片 `![[图.png]]` 同一套），这样页面
 * 仍然是纯 Markdown：用任意编辑器打开都能看懂，也不依赖额外的 Front Matter。
 * 解析时先按 WBS 序号找本地任务，找不到才交给图片解析器处理。
 */
export const TASK_REF_PATTERN = /!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

export interface TaskRefTarget {
  task: TaskNode;
  /** 任务在项目里的 WBS 序号，如 `2.1`。 */
  code: string;
}

export interface TaskRefIndex {
  /** 键是小写序号（2.1 → 任务）。 */
  byCode: Map<string, TaskRefTarget>;
  /** 键是小写标题，仅序号对不上时兜底。 */
  byTitle: Map<string, TaskRefTarget>;
  byId: Map<string, TaskRefTarget>;
}

/** 一次性建好序号 / 标题 / id 三张索引表，供页面渲染与导出复用。 */
export function buildTaskRefIndex(roots: TaskNode[]): TaskRefIndex {
  const codes = collectCodes(roots);
  const byCode = new Map<string, TaskRefTarget>();
  const byTitle = new Map<string, TaskRefTarget>();
  const byId = new Map<string, TaskRefTarget>();

  for (const task of flattenTasks(roots)) {
    const code = codes.get(task.id) ?? '';
    const target: TaskRefTarget = { task, code };
    byId.set(task.id, target);
    if (code) byCode.set(code.toLowerCase(), target);
    const title = task.title.trim().toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, target);
  }

  return { byCode, byTitle, byId };
}

/**
 * 解析 `![[...]]` 里的内容：序号优先（2.1、3.2.4），其次任务标题，最后任务 id。
 * 都对不上就返回 undefined —— 调用方会把它当图片再试一次。
 */
export function lookupTaskRef(
  index: TaskRefIndex,
  raw: string,
): TaskRefTarget | undefined {
  const key = raw.split('|')[0]?.trim() ?? '';
  if (!key) return undefined;
  const lower = key.toLowerCase();
  return index.byCode.get(lower) ?? index.byTitle.get(lower) ?? index.byId.get(key);
}
