import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ProjectDoc, TaskFields, TaskNode } from '@wbs/shared';
import {
  PROJECT_PAGE_KEYS,
  isVersionTask,
  normalizeMilestoneTaskIds,
  normalizeProjectPageOrder,
  normalizeProjectTags,
  projectPageEnd,
  projectPageStart,
  type ProjectPageKey,
} from '@wbs/shared';
import {
  formatSectionHeading,
  indentWidth,
  parseProject,
  parseSectionHeading,
  serializeTaskLine,
} from '@wbs/shared/parser';
import {
  decodeProjectId,
  encodeProjectId,
  getDataRoot,
  normalizeFolderInput,
  resolveFolderPath,
  resolveProjectPath,
  toRelPath,
} from './paths';
import { invalidateAll, listFolders, listProjects } from './store';

const TASK_LINE = /^([ \t]*)- \[([ xX])\](?:[ \t]+(.*))?$/;
const HEADING = /^#{1,6}[ \t]/;
const FIELD_KEYS = [
  'owner',
  'priority',
  'importance',
  'start',
  'due',
  'created',
  'showCreated',
  'isTitle',
  'isVersion',
  'focus',
  'focusColor',
  'cycle',
  'confirm',
  'progress',
  'deps',
  'version',
] as const;

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Windows occasionally reports EPERM/EBUSY when a watched/indexed directory
 * is renamed or removed. Retry briefly before surfacing an error.
 */
async function retryFs<T>(task: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown;
  for (let index = 0; index < attempts; index++) {
    try {
      return await task();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') &&
        index < attempts - 1
      ) {
        last = error;
        await new Promise((resolve) => setTimeout(resolve, 120 * (index + 1)));
        continue;
      }
      throw error;
    }
  }
  throw last;
}

function withLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(file) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  locks.set(file, next);
  next
    .finally(() => {
      if (locks.get(file) === next) locks.delete(file);
    })
    .catch(() => {});
  return next;
}

/**
 * Read → transform → compare mtime → atomically replace.
 * If an external editor touched the file during the operation, re-read and
 * replay the transformation (up to 3 attempts), keyed by stable task IDs.
 */
async function mutate<T>(
  abs: string,
  transform: (doc: ProjectDoc) => { lines: string[]; value: T },
): Promise<T> {
  return withLock(abs, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await fs.stat(abs);
      const source = await fs.readFile(abs, 'utf8');
      const doc = parseProject(toRelPath(abs), source);
      const { lines, value } = transform(doc);

      const after = await fs.stat(abs);
      if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
        continue;
      }

      await writeAtomic(abs, lines.join(doc.eol));
      return value;
    }
    throw new HttpError(409, '文件持续被其他程序修改，请稍后重试');
  });
}

async function writeAtomic(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, abs);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function newTaskId(): string {
  return `t_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label}必须是文本`);
  }
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) throw new HttpError(400, `${label}不能为空`);
  if (text.length > maxLength) {
    throw new HttpError(400, `${label}不能超过 ${maxLength} 个字符`);
  }
  return text;
}

/** 进展正文允许多行：只去首尾空白、合并多余空行，保留换行。 */
function normalizeProgressText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, '进展内容必须是文本');
  }
  const text = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new HttpError(400, '进展内容不能为空');
  if (text.length > 2000) throw new HttpError(400, '进展内容不能超过 2000 个字符');
  return text;
}

/** Validate a `YYYY-MM-DD` field and throw a 400 with the given label. */
function assertDateField(text: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (
    !match ||
    Number(match[2]) < 1 ||
    Number(match[2]) > 12 ||
    Number(match[3]) < 1 ||
    Number(match[3]) > 31
  ) {
    throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  }
}

function normalizeFieldValue(key: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `字段 ${key} 必须是文本`);
  }
  let text = value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (key === 'priority') text = text.toUpperCase();
  if (key === 'start') assertDateField(text, '开始日期');
  if (key === 'due') assertDateField(text, '截止日期');
  if (key === 'created') assertDateField(text, '创建日期');
  if (key === 'progress') {
    if (!/^\d{1,3}$/.test(text) || Number(text) > 100) {
      throw new HttpError(400, '进度百分比必须是 0-100 的整数');
    }
    text = String(Number(text));
  }
  if (key === 'deps') {
    const ids = text.split(/[,\s]+/).filter(Boolean);
    if (ids.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) {
      throw new HttpError(400, '前置任务 ID 格式非法');
    }
    text = [...new Set(ids)].join(',');
  }
  if (key === 'version' && !/^[A-Za-z0-9_-]{1,64}$/.test(text)) {
    throw new HttpError(400, '版本任务 ID 格式非法');
  }
  if (text.length > 120) throw new HttpError(400, `字段 ${key} 过长`);
  if (/[[\]]/.test(text)) throw new HttpError(400, `字段 ${key} 不能包含 [ 或 ]`);
  return text;
}

/** Merge an allow-listed patch object into existing fields. Empty/null deletes. */
function mergeFields(base: TaskFields, patch: unknown): TaskFields {
  if (patch === undefined || patch === null) return { ...base };
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    throw new HttpError(400, 'fields 必须是对象');
  }

  const source = patch as Record<string, unknown>;
  const fields: TaskFields = { ...base };

  for (const key of FIELD_KEYS) {
    if (!(key in source)) continue;
    const raw = source[key];
    if (raw === undefined || raw === null || raw === '') {
      delete fields[key];
      continue;
    }
    fields[key] = normalizeFieldValue(key, raw);
  }

  return fields;
}

function taskTitle(value: unknown): string {
  const title = normalizeText(value, '任务名称', 300);
  if (/\[[^\]]+::/.test(title)) {
    throw new HttpError(400, '任务名称不能包含 [key::value] 形式的保留语法');
  }
  return title;
}

/**
 * 版本任务与普通任务是「一对多」：普通任务的截止日期永远等于所属版本的
 * 截止日期，写文件时统一在这里覆盖，避免前后端各算一份。
 */
function applyVersionDue(
  doc: ProjectDoc,
  fields: TaskFields,
  strict: boolean,
): void {
  // 版本任务本身不挂到别的版本上。
  if (isVersionTask(fields)) {
    delete fields.version;
    return;
  }
  const versionId = fields.version?.trim();
  if (!versionId) return;

  const version = doc.byId.get(versionId);
  if (!version || !isVersionTask(version.fields)) {
    if (strict) throw new HttpError(400, '关联的版本任务不存在或不是版本类型');
    delete fields.version;
    return;
  }

  const due = version.fields.due?.trim();
  if (due) fields.due = due;
  else delete fields.due;
}

/** 客户端本次提交里显式给出的截止日期（没有则为空字符串）。 */
function providedDue(inputFields: unknown): string {
  if (!inputFields || typeof inputFields !== 'object') return '';
  const value = (inputFields as Record<string, unknown>).due;
  return typeof value === 'string' ? value.trim() : '';
}

/** 版本日期一变，所有挂在它下面的任务截止日期跟着改。 */
function propagateVersionDue(
  doc: ProjectDoc,
  lines: string[],
  versionId: string,
  due: string | undefined,
): void {
  for (const task of doc.byId.values()) {
    if (task.id === versionId) continue;
    if (task.fields.version?.trim() !== versionId) continue;
    if ((task.fields.due ?? '') === (due ?? '')) continue;

    const fields: TaskFields = { ...task.fields };
    if (due) fields.due = due;
    else delete fields.due;

    lines[task.line] = serializeTaskLine({
      indent: task.indent,
      done: task.done,
      title: task.title,
      fields,
      id: task.synthetic ? undefined : task.id,
    });
  }
}

export async function updateTask(
  abs: string,
  taskId: string,
  input: {
    done?: unknown;
    title?: unknown;
    fields?: unknown;
  },
): Promise<{ id: string }> {
  return mutate(abs, (doc) => {
    const task = doc.byId.get(taskId);
    if (!task) throw new HttpError(404, '任务不存在，可能刚被外部删除');

    let done = task.done;
    if (input.done !== undefined) {
      if (typeof input.done !== 'boolean') throw new HttpError(400, 'done 必须是布尔值');
      done = input.done;
    }

    const title = input.title !== undefined ? taskTitle(input.title) : task.title;
    const fields = mergeFields(task.fields, input.fields);
    // 解除关联版本后，原本由版本带来的截止日期一并清掉，免得留下一个没有来源的日期。
    const previousVersion = task.fields.version?.trim() ?? '';
    const nextVersion = fields.version?.trim() ?? '';
    if (previousVersion && !nextVersion && !isVersionTask(fields) && !providedDue(input.fields)) {
      delete fields.due;
    }
    // 关联版本后截止日期由版本决定，不接受手工改；版本自身日期变化则回写所有关联任务。
    const touchingVersion =
      Boolean(input.fields) &&
      typeof input.fields === 'object' &&
      input.fields !== null &&
      'version' in (input.fields as Record<string, unknown>);
    if (input.fields !== undefined) applyVersionDue(doc, fields, touchingVersion);
    const id = task.synthetic ? newTaskId() : task.id;

    const lines = doc.lines.slice();
    lines[task.line] = serializeTaskLine({
      indent: task.indent,
      done,
      title,
      fields,
      id,
    });
    if (input.fields !== undefined && isVersionTask(fields)) {
      propagateVersionDue(doc, lines, task.id, fields.due?.trim() || undefined);
    }

    return { lines, value: { id } };
  });
}

function nowStamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export async function addProgress(
  abs: string,
  taskId: string,
  input: { text?: unknown; author?: unknown },
): Promise<void> {
  const text = normalizeProgressText(input.text);
  const author =
    typeof input.author === 'string' && input.author.trim()
      ? input.author.replace(/[[\]\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
      : '我';

  await mutate(abs, (doc) => {
    const task = doc.byId.get(taskId);
    if (!task) throw new HttpError(404, '任务不存在，可能刚被外部删除');

    const lines = doc.lines.slice();
    if (task.synthetic) {
      lines[task.line] = `${lines[task.line].trimEnd()} <!-- id:${newTaskId()} -->`;
    }

    const indent = ' '.repeat(task.indent + 2);
    const contIndent = ' '.repeat(task.indent + 4);
    const [first, ...rest] = text.split('\n');
    const entry = `${indent}- ${nowStamp()} [by::${author || '我'}] ${first}`;
    lines.splice(task.line + 1, 0, entry, ...rest.map((line) => `${contIndent}${line}`));

    return { lines, value: undefined };
  });
}

function appendRootTask(lines: string[], taskLine: string): void {
  let at = lines.length;
  while (at > 0 && !lines[at - 1].trim()) at--;
  const insertion = at > 0 ? ['', taskLine] : [taskLine];
  lines.splice(at, 0, ...insertion);
}

const PROGRESS_LINE = /^([ \t]*)- \d{4}-\d{2}-\d{2}\b/;
/** Prefix of a stored progress line: indent, date/time and optional author. */
const PROGRESS_ENTRY =
  /^([ \t]*-[ \t]+\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?(?:[ \t]+\[by::[^\]]*\])?)[ \t]+(.+)$/;

/**
 * Replace only the text of one progress entry. Its original date, time and
 * author token are kept byte-for-byte, so editing never rewrites history.
 */
export async function updateProgress(
  abs: string,
  taskId: string,
  input: { line?: unknown; text?: unknown },
): Promise<void> {
  if (typeof input.line !== 'number' || !Number.isInteger(input.line) || input.line < 0) {
    throw new HttpError(400, '进展记录行号无效');
  }
  const text = normalizeProgressText(input.text);

  await mutate(abs, (doc) => {
    const task = doc.byId.get(taskId);
    if (!task) throw new HttpError(404, '任务不存在，可能刚被外部删除');
    if (!task.progress.some((entry) => entry.line === input.line)) {
      throw new HttpError(404, '进展记录不存在，可能刚被外部修改');
    }

    const current = doc.lines[input.line as number];
    const match = current ? PROGRESS_ENTRY.exec(current) : null;
    if (!match) throw new HttpError(409, '进展记录格式已变化，请刷新后重试');

    const start = input.line as number;
    // match[1] 里还带着 `- `，只算行首缩进，才能和续行缩进比较。
    const markerIndent = indentWidth(/^[ \t]*/.exec(match[1])?.[0] ?? '');
    // 多行进展：连同后面所有更深缩进的续行一起替换。
    let end = start;
    for (let index = start + 1; index < doc.lines.length; index++) {
      const raw = doc.lines[index];
      // 多行进展里的空行写成带缩进的纯空格行，不能在此中断扫描；
      // 只有缩进回到标记层级或遇到新任务/新进展才结束本条记录。
      if (!raw.trim()) continue;
      if (indentWidth(raw) <= markerIndent) break;
      if (PROGRESS_LINE.test(raw) || TASK_LINE.test(raw)) break;
      end = index;
    }

    const contIndent = ' '.repeat(markerIndent + 2);
    const [first, ...rest] = text.split('\n');
    const lines = doc.lines.slice();
    lines.splice(
      start,
      end - start + 1,
      `${match[1]} ${first}`,
      ...rest.map((line) => `${contIndent}${line}`),
    );
    return { lines, value: undefined };
  });
}
const FENCE = /^[ \t]*(?:```|~~~)/;

/**
 * Rewrite task and progress indentation to a canonical two spaces per level.
 *
 * Hand-written files often mix 0/2/4-space roots, which makes "level" depend on
 * the raw indent value instead of the tree depth — a plain reorder could then
 * change a task's level. Line count and line order are preserved, so callers can
 * re-parse the result and keep using the same line numbers. Clean files are
 * returned untouched.
 */
function normalizeIndent(lines: string[]): string[] {
  const out = lines.slice();
  const stack: number[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (HEADING.test(line)) {
      stack.length = 0;
      continue;
    }

    const taskMatch = TASK_LINE.exec(line);
    if (taskMatch) {
      const original = indentWidth(taskMatch[1]);
      while (stack.length && stack[stack.length - 1] >= original) stack.pop();
      const depth = stack.length;
      stack.push(original);
      if (depth * 2 !== original) {
        out[index] = `${' '.repeat(depth * 2)}${line.slice(taskMatch[1].length)}`;
      }
      continue;
    }

    const progressMatch = PROGRESS_LINE.exec(line);
    if (progressMatch) {
      const original = indentWidth(progressMatch[1]);
      let ownerDepth = -1;
      for (let depth = stack.length - 1; depth >= 0; depth--) {
        if (stack[depth] < original) {
          ownerDepth = depth;
          break;
        }
      }
      if (ownerDepth < 0) continue;
      const target = (ownerDepth + 1) * 2;
      if (target !== original) {
        out[index] = `${' '.repeat(target)}${line.slice(progressMatch[1].length)}`;
      }
    }
  }

  return out;
}

function subtreeEnd(lines: string[], parent: TaskNode): number {
  let end = parent.line + 1;

  for (let index = parent.line + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) {
      end = index + 1;
      continue;
    }
    if (HEADING.test(line)) break;

    const taskMatch = TASK_LINE.exec(line);
    const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
    const lineIndent = indentWidth(leading);

    if (taskMatch && indentWidth(taskMatch[1]) <= parent.indent) break;
    if (!taskMatch && lineIndent <= parent.indent) break;

    end = index + 1;
  }

  while (end > parent.line + 1 && !lines[end - 1]?.trim()) end--;
  return end;
}

export async function createTask(
  abs: string,
  input: {
    parentId?: unknown;
    title?: unknown;
    done?: unknown;
    fields?: unknown;
  },
): Promise<{ id: string }> {
  const title = taskTitle(input.title);
  if (input.done !== undefined && typeof input.done !== 'boolean') {
    throw new HttpError(400, 'done 必须是布尔值');
  }

  return mutate(abs, (doc) => {
    let parent: TaskNode | undefined;
    if (input.parentId !== undefined && input.parentId !== null && input.parentId !== '') {
      if (typeof input.parentId !== 'string') throw new HttpError(400, 'parentId 非法');
      parent = doc.byId.get(input.parentId);
      if (!parent) throw new HttpError(404, '父任务不存在');
    }

    const fields = mergeFields({}, input.fields);
    // 在版本任务下面建二级任务：自动归入该版本，并继承它的截止日期。
    if (parent && isVersionTask(parent.fields) && !fields.version && !isVersionTask(fields)) {
      fields.version = parent.id;
    }
    applyVersionDue(doc, fields, true);
    const id = newTaskId();
    const line = serializeTaskLine({
      indent: parent ? parent.indent + 2 : 0,
      done: input.done === true,
      title,
      fields,
      id,
    });

    const lines = doc.lines.slice();
    if (parent) {
      lines.splice(subtreeEnd(lines, parent), 0, line);
    } else {
      appendRootTask(lines, line);
    }

    return { lines, value: { id } };
  });
}

async function backupFile(abs: string): Promise<void> {
  const trash = path.join(getDataRoot(), '.wbs-trash');
  await fs.mkdir(trash, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomBytes(2).toString('hex');
  await fs.copyFile(abs, path.join(trash, `${stamp}-${suffix}__${path.basename(abs)}`));
}

export async function deleteTask(abs: string, taskId: string): Promise<void> {
  await backupFile(abs);

  await mutate(abs, (doc) => {
    const task = doc.byId.get(taskId);
    if (!task) throw new HttpError(404, '任务不存在，可能刚被外部删除');

    let end = task.line + 1;
    for (let index = task.line + 1; index < doc.lines.length; index++) {
      const line = doc.lines[index];
      if (!line.trim()) {
        end = index + 1;
        continue;
      }
      if (HEADING.test(line)) break;

      const taskMatch = TASK_LINE.exec(line);
      const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
      const lineIndent = indentWidth(leading);

      if (taskMatch && indentWidth(taskMatch[1]) <= task.indent) break;
      if (!taskMatch && lineIndent <= task.indent) break;

      end = index + 1;
    }
    while (end > task.line + 1 && !doc.lines[end - 1]?.trim()) end--;

    const lines = doc.lines.slice();
    lines.splice(task.line, end - task.line);
    return { lines, value: undefined };
  });
}

/**
 * Move a task together with its entire subtree relative to another task.
 *
 * `position` semantics:
 *  - `before`: insert above the target's clamped anchor, adopting the anchor's
 *    level. Dropping beside a shallower row promotes the moved task.
 *  - `after`: insert below that same anchor's whole branch, at the anchor's level.
 *  - `child`: become the last child of the target.
 *
 * For before/after the target is clamped to its nearest ancestor that is not
 * deeper than the moved task. That anchor's level becomes the new level, so a
 * drop can promote (outdent) the task but can never silently demote it, and it
 * never re-parents neighbouring rows. The clamp guarantees anchor.indent <=
 * task.indent, hence delta <= 0 for before/after.
 *
 * The task block is relocated at the line level so progress entries and any
 * other nested content travel with it. Task lines are re-serialized with the
 * new indentation; synthetic tasks receive a persisted id while being moved.
 */
export async function moveTask(
  abs: string,
  taskId: string,
  input: { targetId?: unknown; position?: unknown },
): Promise<{ id: string }> {
  const targetId = input.targetId;
  if (typeof targetId !== 'string' || !targetId.trim()) {
    throw new HttpError(400, 'targetId 必须是非空文本');
  }
  const position = input.position;
  if (position !== 'before' && position !== 'after' && position !== 'child') {
    throw new HttpError(400, 'position 必须是 before / after / child');
  }
  if (taskId === targetId) {
    throw new HttpError(400, '不能把任务移动到自身');
  }

  return mutate(abs, (rawDoc) => {
    // Self-heal hand-written indentation first: mixed 0/2/4-space roots make the
    // "level" of a task depend on its raw indent, so a plain reorder used to
    // change levels. Normalisation keeps the line count, so line numbers stay valid.
    const canonical = normalizeIndent(rawDoc.lines);
    const healed = canonical.some((line, index) => line !== rawDoc.lines[index]);
    const doc = healed
      ? parseProject(toRelPath(abs), canonical.join(rawDoc.eol))
      : rawDoc;

    const task = doc.byId.get(taskId);
    if (!task) throw new HttpError(404, '被移动的任务不存在，可能刚被外部删除');
    const target = doc.byId.get(targetId);
    if (!target) throw new HttpError(404, '目标任务不存在，可能刚被外部删除');

    // Reject any destination inside the moved task's own subtree.
    const stack = [...task.children];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === targetId) {
        throw new HttpError(400, '不能把任务移动到自己的子任务中');
      }
      stack.push(...node.children);
    }

    // Parent links let a drop walk up the target's ancestry. Markdown nesting is
    // inferred from indentation alone, so a task can only be inserted where the
    // surrounding lines keep their own parent.
    const parentOf = new Map<string, TaskNode>();
    const pending: TaskNode[] = [...doc.roots];
    while (pending.length) {
      const node = pending.pop()!;
      for (const child of node.children) {
        parentOf.set(child.id, node);
        pending.push(child);
      }
    }

    // Clamp the drop target to the nearest ancestor that is not deeper than the
    // moved task. Inserting next to a deeper row would otherwise adopt that row
    // (and its siblings) as children of the moved task.
    let anchor = target;
    while (anchor.indent > task.indent) {
      const parent = parentOf.get(anchor.id);
      if (!parent) break;
      anchor = parent;
    }

    const lines = doc.lines.slice();
    const blockStart = task.line;
    const blockEnd = subtreeEnd(lines, task);
    const block = lines.slice(blockStart, blockEnd);
    const blockLength = block.length;

    // Compute the destination using pre-move line numbers.
    // `before` / `after` keep the moved task's own level: the position is
    // clamped to the anchor branch so no neighbouring subtree changes parent.
    // `child` appends the task as the target's last child.
    const insertAt =
      position === 'child'
        ? subtreeEnd(lines, target)
        : position === 'before'
          ? anchor.line
          : subtreeEnd(lines, anchor);
    // before/after adopt the clamped anchor's level, which is never deeper than
    // the moved task (anchor.indent <= task.indent). This makes delta <= 0: the
    // task is promoted to the anchor's level (e.g. level-2 -> level-1 when dropped
    // beside a root task) but can never be demoted or swallow neighbouring rows.
    const newIndent =
      position === 'child'
        ? target.indent + 2
        : anchor.indent;
    const delta = newIndent - task.indent;

    // Map source lines to parsed nodes so task lines can be re-serialized.
    const byLine = new Map<number, TaskNode>();
    for (const node of doc.byId.values()) byLine.set(node.line, node);

    const movedId = task.synthetic ? newTaskId() : task.id;
    const rewritten = block.map((line, offset) => {
      const taskMatch = TASK_LINE.exec(line);
      if (taskMatch) {
        const node = byLine.get(blockStart + offset);
        if (node) {
          // Persist existing ids (including synthetic ones) so an open drawer
          // keeps pointing at the same task after the move.
          const id = node.id === taskId ? movedId : node.id;
          return serializeTaskLine({
            indent: Math.max(0, indentWidth(taskMatch[1]) + delta),
            done: node.done,
            title: node.title,
            fields: node.fields,
            id,
          });
        }
      }

      // Progress entries and plain content only need their indent shifted.
      const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
      if (!leading) return line;
      return `${' '.repeat(Math.max(0, indentWidth(leading) + delta))}${line.slice(leading.length)}`;
    });

    lines.splice(blockStart, blockLength);
    const adjusted = insertAt > blockStart ? insertAt - blockLength : insertAt;
    lines.splice(adjusted, 0, ...rewritten);

    return { lines, value: { id: movedId } };
  });
}

/* ------------------------------------------------------------------ */
/* Task sections (groups)                                              */
/* ------------------------------------------------------------------ */

const H2_LINE = /^##[ \t]+(.*?)[ \t]*$/;
const UNGROUPED = '';
const DESCRIPTION_START = '<!-- description:start -->';
const DESCRIPTION_END = '<!-- description:end -->';
const PAGE_MARKER = /^<!--\s*page:[\w-]+:(start|end)\s*-->$/;

/**
 * Whether a line index falls inside the description block or one of the page
 * blocks (里程碑 / 风险 / 成本). H2 headings there are documentation, not real
 * groups — section tooling must ignore them so renaming/deleting a group can
 * never rewrite a page.
 */
function insideDescription(lines: string[], index: number): boolean {
  let inside = false;
  for (let cursor = 0; cursor < index; cursor++) {
    const trimmed = lines[cursor].trim();
    if (trimmed === DESCRIPTION_START) inside = true;
    else if (trimmed === DESCRIPTION_END) inside = false;
    else if (PAGE_MARKER.test(trimmed)) inside = trimmed.endsWith(':start -->');
  }
  return inside;
}

/** Find a line matching `predicate`, skipping the description block. */
function findSectionLine(
  lines: string[],
  predicate: (line: string) => boolean,
): number {
  return lines.findIndex(
    (line, index) => !insideDescription(lines, index) && predicate(line),
  );
}

/** Section name of an H2 line (desc comment stripped), or null when not `## …`. */
function h2Name(line: string): string | null {
  const match = H2_LINE.exec(line);
  return match ? parseSectionHeading(match[1]).name : null;
}

/** Ensure a section name is a safe, non-empty H2 title. */
function sectionName(value: unknown): string {
  const name = normalizeText(value, '分组名称', 60);
  if (/[\r\n]/.test(name)) throw new HttpError(400, '分组名称不能包含换行');
  return name;
}

/**
 * Move a task (with its whole subtree) into a named H2 section.
 * - `section` is a section name, or empty / undefined for the ungrouped area.
 * - If the target section exists, the block is appended to the end of it.
 * - If it does not exist, the section is created at the end of the document.
 * The moved task always becomes a root (indent 0) of the target section; its
 * descendants keep their relative levels via a uniform indent shift.
 */
export async function moveTaskToSection(
  abs: string,
  taskId: string,
  input: { section?: unknown },
): Promise<{ id: string; section: string }> {
  const section =
    input.section === undefined || input.section === null || input.section === ''
      ? UNGROUPED
      : sectionName(input.section);

  return mutate(abs, (rawDoc) => {
    const canonical = normalizeIndent(rawDoc.lines);
    const healed = canonical.some((line, index) => line !== rawDoc.lines[index]);
    const doc = healed
      ? parseProject(toRelPath(abs), canonical.join(rawDoc.eol))
      : rawDoc;

    const task = doc.byId.get(taskId);
    if (!task) throw new HttpError(404, '被移动的任务不存在，可能刚被外部删除');

    // Reject moving into one of the task's own descendants' sections is a no-op
    // here (sections are document-level); nesting stays intact via the block move.
    const lines = doc.lines.slice();
    const blockStart = task.line;
    const blockEnd = subtreeEnd(lines, task);
    const block = lines.slice(blockStart, blockEnd);
    const blockLength = block.length;

    const byLine = new Map<number, TaskNode>();
    for (const node of doc.byId.values()) byLine.set(node.line, node);
    const movedId = task.synthetic ? newTaskId() : task.id;
    // The task becomes a root of the target section.
    const delta = -task.indent;
    const rewritten = block.map((line, offset) => {
      const taskMatch = TASK_LINE.exec(line);
      if (taskMatch) {
        const node = byLine.get(blockStart + offset);
        if (node) {
          return serializeTaskLine({
            indent: Math.max(0, indentWidth(taskMatch[1]) + delta),
            done: node.done,
            title: node.title,
            fields: node.fields,
            id: node.id === taskId ? movedId : node.id,
          });
        }
      }
      const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
      if (!leading) return line;
      return `${' '.repeat(Math.max(0, indentWidth(leading) + delta))}${line.slice(leading.length)}`;
    });

    // Remove the block first, then compute the destination on the shortened file.
    lines.splice(blockStart, blockLength);

    const existingIndex = findSectionLine(lines, (line) => h2Name(line) === section);
    let insertAt: number;
    let createHeading = false;
    if (section === UNGROUPED) {
      insertAt = findSectionLine(lines, (line) => H2_LINE.test(line));
      if (insertAt < 0) insertAt = lines.length;
      while (insertAt > 0 && !lines[insertAt - 1].trim()) insertAt--;
    } else if (existingIndex >= 0) {
      // Append just before the next heading (or end of file).
      insertAt = lines.length;
      for (let index = existingIndex + 1; index < lines.length; index++) {
        if (/^#{1,6}[ \t]/.test(lines[index])) {
          insertAt = index;
          break;
        }
      }
      while (insertAt > existingIndex + 1 && !lines[insertAt - 1].trim()) insertAt--;
    } else {
      createHeading = true;
      insertAt = lines.length;
      while (insertAt > 0 && !lines[insertAt - 1].trim()) insertAt--;
    }

    const payload: string[] = [];
    if (createHeading) {
      if (insertAt > 0) payload.push('');
      payload.push(`## ${section}`, '');
    } else if (insertAt > 0 && lines[insertAt - 1].trim()) {
      payload.push('');
    }
    payload.push(...rewritten);
    lines.splice(insertAt, 0, ...payload);

    return { lines, value: { id: movedId, section } };
  });
}

export async function renameSection(
  abs: string,
  input: { from?: unknown; to?: unknown },
): Promise<{ from: string; to: string }> {
  const from = sectionName(input.from);
  const to = sectionName(input.to);
  if (from === to) return { from, to };

  await mutate(abs, (doc) => {
    const lines = doc.lines.slice();
    const index = findSectionLine(lines, (line) => h2Name(line) === from);
    if (index < 0) throw new HttpError(404, '源分组不存在');
    if (findSectionLine(lines, (line) => h2Name(line) === to) >= 0) {
      throw new HttpError(400, '目标分组名称已存在');
    }
    // 重命名时保留原有描述注释。
    const current = H2_LINE.exec(lines[index]);
    const description = current ? parseSectionHeading(current[1]).description : undefined;
    lines[index] = formatSectionHeading(to, description);
    return { lines, value: undefined };
  });
  return { from, to };
}

/** Delete an H2 section; its tasks are moved to the ungrouped area. */
export async function deleteSection(
  abs: string,
  input: { section?: unknown },
): Promise<{ section: string }> {
  const section = sectionName(input.section);

  await mutate(abs, (doc) => {
    const lines = doc.lines.slice();
    const index = findSectionLine(lines, (line) => h2Name(line) === section);
    if (index < 0) throw new HttpError(404, '分组不存在');

    let end = lines.length;
    for (let i = index + 1; i < lines.length; i++) {
      if (/^#{1,6}[ \t]/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const block = lines.slice(index + 1, end);
    lines.splice(index, end - index);
    while (index < lines.length && !lines[index].trim()) lines.splice(index, 1);

    if (block.length) {
      let at = findSectionLine(lines, (line) => H2_LINE.test(line));
      if (at < 0) at = lines.length;
      while (at > 0 && !lines[at - 1].trim()) at--;
      const payload: string[] = [];
      if (at > 0 && lines[at - 1].trim()) payload.push('');
      payload.push(...block);
      lines.splice(at, 0, ...payload);
    }
    return { lines, value: undefined };
  });
  return { section };
}

/**
 * Set or clear a group's description. The description lives in a trailing
 * `<!-- desc:… -->` comment on the H2 line, so it never affects task parsing.
 */
export async function updateSectionDescription(
  abs: string,
  input: { section?: unknown; description?: unknown },
): Promise<{ section: string; description: string }> {
  const section = sectionName(input.section);
  const raw = input.description;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw new HttpError(400, '分组描述必须是文本');
  }
  const description = (raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/-->/g, '')
    .trim();
  if (description.length > 200) {
    throw new HttpError(400, '分组描述不能超过 200 个字符');
  }

  await mutate(abs, (doc) => {
    const lines = doc.lines.slice();
    const index = findSectionLine(lines, (line) => h2Name(line) === section);
    if (index < 0) throw new HttpError(404, '分组不存在');
    const current = H2_LINE.exec(lines[index]);
    const name = current ? parseSectionHeading(current[1]).name : section;
    lines[index] = formatSectionHeading(name, description || undefined);
    return { lines, value: undefined };
  });
  return { section, description };
}

export async function createSection(
  abs: string,
  input: { section?: unknown },
): Promise<{ section: string }> {
  const section = sectionName(input.section);
  await mutate(abs, (doc) => {
    const lines = doc.lines.slice();
    if (findSectionLine(lines, (line) => h2Name(line) === section) >= 0) {
      throw new HttpError(400, '分组已存在');
    }
    let at = lines.length;
    while (at > 0 && !lines[at - 1].trim()) at--;
    const payload: string[] = [];
    if (at > 0) payload.push('');
    payload.push(`## ${section}`, '');
    lines.splice(at, 0, ...payload);
    return { lines, value: undefined };
  });
  return { section };
}

/* ------------------------------------------------------------------ */
/* Project & folder management                                         */
/* ------------------------------------------------------------------ */

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/**
 * Front Matter line for one key. Scalars are quoted; `tags` arrives already
 * serialized as a flow sequence (`["a", "b"]`) and must not be quoted again.
 */
function metaLine(key: string, value: string): string {
  return key === 'tags' ? `tags: ${value}` : `${key}: ${yamlScalar(value)}`;
}

function syncProjectHeading(
  lines: string[],
  oldName: string,
  newName?: string,
): void {
  if (!newName || !oldName || newName === oldName) return;
  const h1Index = lines.findIndex((line) => /^#\s+/.test(line));
  if (h1Index < 0) return;
  const heading = lines[h1Index].replace(/^#\s+/, '').trim();
  if (heading === oldName) lines[h1Index] = `# ${newName}`;
}

function projectName(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, '项目名称必须是文本');
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) throw new HttpError(400, '项目名称不能为空');
  if (name.length > 100) throw new HttpError(400, '项目名称不能超过 100 个字符');
  if (/[\r\n]/.test(value)) throw new HttpError(400, '项目名称不能包含换行');
  return name;
}

function projectCode(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, '项目编号必须是文本');
  const code = value.replace(/\s+/g, ' ').trim();
  if (code.length > 60) throw new HttpError(400, '项目编号不能超过 60 个字符');
  return code || null;
}

function projectStatus(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, '项目状态必须是文本');
  const status = value.replace(/\s+/g, ' ').trim();
  if (status.length > 40) throw new HttpError(400, '项目状态不能超过 40 个字符');
  return status || null;
}

function safeFileBase(name: string): string {
  let base = name
    .replace(INVALID_FILENAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  if (!base) base = `project-${Date.now().toString(36)}`;
  if (WINDOWS_RESERVED_NAME.test(base)) base = `_${base}`;
  return base;
}

function serializeNewProject(name: string, code: string | null, status: string | null): string {
  const lines = ['---', 'wbs: 1', `project: ${yamlScalar(name)}`];
  if (code) lines.push(`code: ${yamlScalar(code)}`);
  if (status) lines.push(`status: ${yamlScalar(status)}`);
  lines.push(`updated: ${yamlScalar(new Date().toISOString())}`, '---', '', `# ${name}`, '');
  return lines.join('\n');
}

export async function createProject(input: {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  folder?: unknown;
}): Promise<{ id: string; path: string }> {
  const name = projectName(input.name);
  const code = projectCode(input.code);
  const status = projectStatus(input.status);
  const folder = normalizeFolderInput(input.folder);
  const folderAbs = resolveFolderPath(folder, true);
  await fs.mkdir(folderAbs, { recursive: true });

  const base = safeFileBase(name);
  const content = serializeNewProject(name, code, status);

  for (let index = 1; index <= 999; index++) {
    const filename = index === 1 ? base : `${base}-${index}`;
    const rel = folder ? `${folder}/${filename}.md` : `${filename}.md`;
    const abs = resolveProjectPath(rel);
    try {
      await fs.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
      return { id: encodeProjectId(rel), path: rel };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
  }

  throw new HttpError(409, '无法生成唯一的项目文件名');
}

/** Insert or replace the `order` field while leaving all other content intact. */
function withProjectOrder(lines: string[], order: number): string[] {
  const out = lines.slice();
  const orderLine = `order: ${order}`;
  let fmEnd = -1;
  if (out[0]?.trim() === '---') {
    fmEnd = out.findIndex((line, index) => index > 0 && line.trim() === '---');
  }
  if (fmEnd > 0) {
    const existing = out.findIndex(
      (line, index) => index > 0 && index < fmEnd && /^order\s*:/.test(line),
    );
    if (existing >= 0) out[existing] = orderLine;
    else out.splice(fmEnd, 0, orderLine);
  } else {
    out.unshift('---', orderLine, '---');
  }
  return out;
}

/**
 * Persist the full sidebar order into each project's front matter. Markdown
 * stays the source of truth; every write is locked and atomic, and projects
 * that have never been moved keep their other front matter fields untouched.
 */
export async function reorderProjects(input: {
  ids?: unknown;
}): Promise<{ ok: true }> {
  const ids = input.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    throw new HttpError(400, 'ids 必须是非空的项目 ID 数组');
  }
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, '项目 ID 不能重复');
  }

  const known = await listProjects();
  const knownIds = new Set(known.map((project) => project.id));
  if (ids.length !== knownIds.size || ids.some((id) => !knownIds.has(id))) {
    throw new HttpError(400, '请提交完整且有效的项目顺序');
  }

  for (let index = 0; index < ids.length; index++) {
    const abs = resolveProjectPath(decodeProjectId(ids[index]));
    await withLock(abs, async () => {
      const source = await fs.readFile(abs, 'utf8');
      const eol = source.includes('\r\n') ? '\r\n' : '\n';
      const lines = source.split(/\r?\n/);
      const updated = withProjectOrder(lines, index + 1);
      if (updated.join('\n') !== lines.join('\n')) {
        await writeAtomic(abs, updated.join(eol));
      }
    });
  }

  invalidateAll();
  return { ok: true };
}

export async function createFolder(input: { folder?: unknown }): Promise<{ folder: string }> {
  const folder = normalizeFolderInput(input.folder);
  if (!folder) throw new HttpError(400, '文件夹名称不能为空');
  const abs = resolveFolderPath(folder, false);
  await fs.mkdir(abs, { recursive: true });
  return { folder };
}

function requiredFolder(value: unknown): string {
  const folder = normalizeFolderInput(value);
  if (!folder) throw new HttpError(400, '文件夹名称不能为空');
  return folder;
}

/**
 * Rename a directory in place. Nested project paths are derived from the
 * folder, so project ids change; the client re-resolves them from the
 * refreshed project list. Files are never deleted.
 */
export async function renameProjectFolder(input: {
  from?: unknown;
  to?: unknown;
}): Promise<{ from: string; to: string }> {
  const from = requiredFolder(input.from);
  const to = requiredFolder(input.to);
  if (from === to) return { from, to };
  if (to.startsWith(`${from}/`) || from.startsWith(`${to}/`)) {
    throw new HttpError(400, '不能把文件夹改名为自己的子目录');
  }

  const known = await listFolders();
  if (!known.includes(from)) throw new HttpError(404, '源文件夹不存在');
  if (known.includes(to)) throw new HttpError(400, '目标文件夹已存在');

  const sourceAbs = resolveFolderPath(from, false);
  const targetAbs = resolveFolderPath(to, false);
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });
  try {
    await retryFs(() => fs.rename(sourceAbs, targetAbs));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new HttpError(400, '目标文件夹已存在');
    }
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      throw new HttpError(409, '文件夹被其他程序占用，请稍后重试');
    }
    throw error;
  }
  invalidateAll();
  return { from, to };
}

/**
 * Delete an empty-leaf folder. Any files inside are moved back to the data
 * root (with a numeric suffix on collision) so no project or attachment is
 * lost. Nested folders must be deleted first, deepest one at a time.
 */
export async function deleteProjectFolder(input: {
  folder?: unknown;
}): Promise<{ folder: string; moved: number }> {
  const folder = requiredFolder(input.folder);
  const known = await listFolders();
  if (!known.includes(folder)) throw new HttpError(404, '文件夹不存在');
  if (known.some((item) => item.startsWith(`${folder}/`))) {
    throw new HttpError(400, '请先删除子文件夹');
  }

  const abs = resolveFolderPath(folder, false);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  if (entries.some((entry) => entry.isDirectory())) {
    throw new HttpError(400, '文件夹内还有子目录，请先删除');
  }

  const root = getDataRoot();
  let moved = 0;
  for (const entry of entries.filter((item) => item.isFile())) {
    const ext = path.extname(entry.name);
    const base = path.basename(entry.name, ext);
    let name = entry.name;
    let index = 1;
    while (true) {
      try {
        await fs.access(path.join(root, name));
        index += 1;
        name = `${base}-${index}${ext}`;
      } catch {
        break;
      }
    }
    await retryFs(() => fs.rename(path.join(abs, entry.name), path.join(root, name)));
    moved += 1;
  }
  await retryFs(() => fs.rmdir(abs));
  invalidateAll();
  return { folder, moved };
}

/**
 * Move a project's Markdown file into a (possibly different) folder. The
 * project id encodes its relative path, so moving changes the id — the new
 * id/path is returned so the client can update its selection. Filename
 * collisions inside the target folder are resolved with a `-2`, `-3`, ...
 * suffix, mirroring createProject.
 */
export async function moveProject(input: {
  id?: unknown;
  folder?: unknown;
}): Promise<{ id: string; path: string }> {
  if (typeof input.id !== 'string' || !input.id.trim()) {
    throw new HttpError(400, '缺少项目 ID');
  }

  const rel = decodeProjectId(input.id);
  const sourceAbs = resolveProjectPath(rel);
  const folder = normalizeFolderInput(input.folder);
  const destDir = resolveFolderPath(folder, true);

  // Same folder: nothing to move.
  const currentFolder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  if (currentFolder === folder) {
    return { id: input.id, path: rel };
  }

  const base = path.basename(rel, path.extname(rel));
  await fs.mkdir(destDir, { recursive: true });

  let targetRel = folder ? `${folder}/${base}.md` : `${base}.md`;
  let targetAbs = path.resolve(getDataRoot(), ...targetRel.split('/'));
  let index = 1;
  while (true) {
    try {
      await fs.access(targetAbs);
      index += 1;
      const name = index === 1 ? base : `${base}-${index}`;
      targetRel = folder ? `${folder}/${name}.md` : `${name}.md`;
      targetAbs = path.resolve(getDataRoot(), ...targetRel.split('/'));
    } catch {
      break;
    }
  }

  await withLock(sourceAbs, async () => {
    await fs.rename(sourceAbs, targetAbs);
  });
  invalidateAll();
  return { id: encodeProjectId(targetRel), path: targetRel };
}

/** Validate the project description before it is written into the Markdown. */
function projectDescription(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, '项目简介必须是文本');
  }
  if (value.includes(DESCRIPTION_START) || value.includes(DESCRIPTION_END)) {
    throw new HttpError(400, '项目简介不能包含简介标记');
  }
  if (/-->/.test(value)) {
    throw new HttpError(400, '项目简介不能包含 HTML 注释结束符');
  }
  if (value.length > 8000) {
    throw new HttpError(400, '项目简介不能超过 8000 个字符');
  }
  return value.trim();
}

/**
 * Replace the text inside an existing description block, or insert a new
 * block just before the H1 (after the front matter). All other lines are
 * left byte-for-byte untouched.
 */
function applyDescription(lines: string[], description: string): void {
  const body = description ? description.split(/\r?\n/) : [];
  const startIdx = lines.findIndex((line) => line.trim() === DESCRIPTION_START);
  const endIdx =
    startIdx < 0
      ? -1
      : lines.findIndex(
          (line, index) => index > startIdx && line.trim() === DESCRIPTION_END,
        );

  if (startIdx >= 0 && endIdx > startIdx) {
    if (!body) {
      // 清空简介时连标记一起删掉，不在文件里留空壳。
      let tail = endIdx + 1;
      while (tail < lines.length && lines[tail].trim() === '') tail++;
      lines.splice(startIdx, tail - startIdx);
      return;
    }
    lines.splice(startIdx + 1, endIdx - startIdx - 1, ...body);
    return;
  }

  if (!body) return;

  let insertAt = 0;
  if (lines[0]?.trim() === '---') {
    const fmClose = lines.findIndex(
      (line, index) => index > 0 && line.trim() === '---',
    );
    if (fmClose > 0) insertAt = fmClose + 1;
  }
  // Skip the blank lines after the front matter so the original spacing
  // stays above the new block; append one blank line to separate it from H1.
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
  lines.splice(insertAt, 0, DESCRIPTION_START, ...body, DESCRIPTION_END, '');
}

/** Validate a page body before it is written into the Markdown. */
function projectPageBody(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, '页面内容必须是文本');
  }
  if (/-->/i.test(value)) {
    throw new HttpError(400, '页面内容不能包含 HTML 注释结束符「-->」');
  }
  if (value.length > 200_000) {
    throw new HttpError(400, '页面内容过长（上限 20 万字符）');
  }
  return value.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

/**
 * Replace the body of a page block, or insert a new block right after the
 * description block (or the front matter) so all pages stay grouped before H1.
 * Everything else in the file is left byte-for-byte untouched.
 */
function applyPage(lines: string[], key: ProjectPageKey, body: string): void {
  const start = projectPageStart(key);
  const end = projectPageEnd(key);
  const startIdx = lines.findIndex((line) => line.trim() === start);
  const endIdx =
    startIdx < 0
      ? -1
      : lines.findIndex((line, index) => index > startIdx && line.trim() === end);
  const empty = body.trim() === '';

  if (startIdx >= 0 && endIdx > startIdx) {
    if (empty) {
      // 内容清空 = 连块一起删掉，别在文件里留一个空壳；块后的空行一并收走。
      let tail = endIdx + 1;
      while (tail < lines.length && lines[tail].trim() === '') tail++;
      lines.splice(startIdx, tail - startIdx);
      return;
    }
    lines.splice(startIdx + 1, endIdx - startIdx - 1, ...body.split('\n'));
    // 块后面补一个空行，别让结束标记和下面的 H1 粘在一起。
    const newEnd = lines.findIndex(
      (line, index) => index > startIdx && line.trim() === end,
    );
    if (newEnd >= 0 && newEnd + 1 < lines.length && lines[newEnd + 1].trim() !== '') {
      lines.splice(newEnd + 1, 0, '');
    }
    return;
  }

  // 还没有这个块、内容又是空的：什么都不写，等真有内容再插入。
  if (empty) return;

  // Insert after the last existing block, otherwise right after front matter.
  let insertAt = 0;
  if (lines[0]?.trim() === '---') {
    const fmClose = lines.findIndex(
      (line, index) => index > 0 && line.trim() === '---',
    );
    if (fmClose > 0) insertAt = fmClose + 1;
  }
  const descEndIdx = lines.findIndex(
    (line, index) => index > insertAt && line.trim() === DESCRIPTION_END,
  );
  if (descEndIdx >= 0) insertAt = descEndIdx + 1;
  for (const other of PROJECT_PAGE_KEYS) {
    const otherEnd = lines.findIndex(
      (line, index) => index > insertAt && line.trim() === projectPageEnd(other),
    );
    if (otherEnd >= 0) insertAt = otherEnd + 1;
  }

  const head = lines.slice(0, insertAt);
  // 去掉插入点上方多余的空行，块与块之间只留一个空行。
  while (head.length && head[head.length - 1].trim() === '') head.pop();
  const tail = lines.slice(insertAt);
  let lead = 0;
  while (lead < tail.length && tail[lead].trim() === '') lead++;
  const rest = tail.slice(lead);

  lines.splice(
    0,
    lines.length,
    ...head,
    ...(head.length ? [''] : []),
    start,
    ...body.split('\n'),
    end,
    ...(rest.length ? ['', ...rest] : []),
  );
  while (lines.length && lines[0].trim() === '') lines.shift();
}

export async function updateProjectPage(
  abs: string,
  key: ProjectPageKey,
  value: unknown,
): Promise<void> {
  const body = projectPageBody(value);
  await mutate(abs, (doc) => {
    const lines = doc.lines.slice();
    // 简介页与「项目简介」共用 description 块，保证只存一份内容。
    if (key === 'intro') applyDescription(lines, body);
    else applyPage(lines, key, body);
    return { lines, value: undefined };
  });
  invalidateAll();
}

/**
 * 写入 / 替换 Front Matter 里的一个键；`serialized` 已经是 YAML 片段。
 * 传 null 表示删除该键。只动这一行，其余内容原样保留。
 */
function setFrontMatterKey(
  lines: string[],
  key: string,
  serialized: string | null,
): void {
  let end = -1;
  if (lines[0]?.trim() === '---') {
    for (let index = 1; index < lines.length; index++) {
      if (lines[index].trim() === '---') {
        end = index;
        break;
      }
    }
  }
  if (end < 0) {
    if (serialized !== null) {
      lines.unshift('---', 'wbs: 1', `${key}: ${serialized}`, '---', '');
    }
    return;
  }
  const pattern = new RegExp(`^${key}\\s*:`);
  for (let index = 1; index < end; index++) {
    if (!pattern.test(lines[index])) continue;
    if (serialized === null) lines.splice(index, 1);
    else lines[index] = `${key}: ${serialized}`;
    return;
  }
  if (serialized !== null) lines.splice(end, 0, `${key}: ${serialized}`);
}

/**
 * 保存 里程碑 / 风险 / 成本 / 相关方 的展示顺序。
 *
 * 顺序写进项目 Front Matter 的 `pageOrder`，跟着项目文件走 —— 换浏览器、
 * 换电脑打开都是同一套顺序，也能直接在编辑器里改。
 */
export async function updateProjectPageOrder(
  abs: string,
  value: unknown,
): Promise<void> {
  const order = normalizeProjectPageOrder(value);
  const serialized = `[${order.map((key) => `"${key}"`).join(', ')}]`;
  await mutate(abs, (doc) => {
    const lines = doc.lines.slice();
    setFrontMatterKey(lines, 'pageOrder', serialized);
    return { lines, value: undefined };
  });
  invalidateAll();
}

/**
 * 保存里程碑页关联的任务 id。
 *
 * 写在项目 Front Matter 的 `milestoneTasks: ["t_a", "t_b"]` 里，跟着文件走；
 * 传空数组等于清空关联（顺手把这一行删掉，保持文件干净）。
 */
export async function updateMilestoneTasks(
  abs: string,
  value: unknown,
): Promise<void> {
  const ids = normalizeMilestoneTaskIds(value);
  await mutate(abs, (doc) => {
    const lines = doc.lines.slice();
    setFrontMatterKey(
      lines,
      'milestoneTasks',
      ids.length ? `[${ids.map(yamlScalar).join(', ')}]` : null,
    );
    return { lines, value: undefined };
  });
  invalidateAll();
}

export async function updateProjectMeta(
  abs: string,
  input: {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    description?: unknown;
    tags?: unknown;
  },
): Promise<void> {
  const hasName = input.name !== undefined;
  const hasCode = input.code !== undefined;
  const hasStatus = input.status !== undefined;
  const hasDescription = input.description !== undefined;
  const hasTags = input.tags !== undefined;
  if (!hasName && !hasCode && !hasStatus && !hasDescription && !hasTags) {
    throw new HttpError(400, '没有需要更新的项目信息');
  }

  const name = hasName ? projectName(input.name) : undefined;
  const code = hasCode ? projectCode(input.code) : undefined;
  const status = hasStatus ? projectStatus(input.status) : undefined;
  const description = hasDescription
    ? projectDescription(input.description)
    : undefined;
  // YAML flow sequence keeps tags on a single Front Matter line and stays
  // readable in the Markdown source; an empty list removes the key entirely.
  const tags = hasTags ? normalizeProjectTags(input.tags) : undefined;

  await mutate(abs, (doc) => {
    const lines = doc.lines.slice();
    const metaName =
      typeof doc.meta.project === 'string' ? doc.meta.project.trim() : '';
    const oldName = metaName || doc.title?.trim() || '';
    const updates: Record<string, string | null> = {
      updated: new Date().toISOString(),
    };
    if (name !== undefined) updates.project = name;
    if (code !== undefined) updates.code = code;
    if (status !== undefined) updates.status = status;
    if (tags !== undefined) {
      updates.tags = tags.length ? `[${tags.map(yamlScalar).join(', ')}]` : null;
    }

    let start = 0;
    let end = -1;
    if (lines[0]?.trim() === '---') {
      for (let index = 1; index < lines.length; index++) {
        if (lines[index].trim() === '---') {
          end = index;
          break;
        }
      }
    }

    if (end < 0) {
      const frontMatter = ['---', 'wbs: 1'];
      for (const [key, value] of Object.entries(updates)) {
        if (value !== null) frontMatter.push(metaLine(key, value));
      }
      frontMatter.push('---', '');
      lines.unshift(...frontMatter);
      syncProjectHeading(lines, oldName, name);
      if (description !== undefined) applyDescription(lines, description);
      return { lines, value: undefined };
    }

    const handled = new Set<string>();
    const nextFrontMatter: string[] = [];

    for (let index = start + 1; index < end; index++) {
      const line = lines[index];
      const match = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
      const key = match?.[1];
      if (!key || !(key in updates)) {
        nextFrontMatter.push(line);
        continue;
      }

      const value = updates[key];
      handled.add(key);
      if (value !== null) nextFrontMatter.push(metaLine(key, value));
    }

    for (const [key, value] of Object.entries(updates)) {
      if (value !== null && !handled.has(key)) {
        nextFrontMatter.push(metaLine(key, value));
      }
    }

    lines.splice(start, end - start + 1, '---', ...nextFrontMatter, '---');
    syncProjectHeading(lines, oldName, name);
    if (description !== undefined) applyDescription(lines, description);

    return { lines, value: undefined };
  });
}
