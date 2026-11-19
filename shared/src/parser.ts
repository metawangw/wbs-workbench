import matter from 'gray-matter';
import type { ProjectDoc, TaskFields, TaskNode } from './types';

const FIELD_ALIASES: Record<string, string> = {
  负责人: 'owner',
  优先级: 'priority',
  重要性: 'importance',
  重要度: 'importance',
  开始: 'start',
  开始日期: 'start',
  截止: 'due',
  截止日期: 'due',
  周期: 'cycle',
  确认人: 'confirm',
  关联人: 'confirm',
  进度: 'progress',
  完成度: 'progress',
  依赖: 'deps',
  前置: 'deps',
  前置任务: 'deps',
};

const TASK_LINE = /^([ \t]*)- \[([ xX])\](?:[ \t]+(.*))?$/;
const PROGRESS_LINE =
  /^([ \t]*)-[ \t]+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?[ \t]+(.+)$/;
const HEADING_LINE = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const ID_COMMENT = /[ \t]*<!--\s*id:\s*([A-Za-z0-9_-]+)\s*-->[ \t]*$/;
const FIELD_TOKEN = /\[([\w一-鿿-]+)::([^\]]*)\]/g;
const FIELD_TOKEN_STRIP = /\[[\w一-鿿-]+::[^\]]*\]/g;
const FENCE_LINE = /^[ \t]*(```|~~~)/;
const DESCRIPTION_START = '<!-- description:start -->';
const DESCRIPTION_END = '<!-- description:end -->';

/**
 * Parse a project markdown file.
 *
 * The parser is deliberately line-based: every task keeps its absolute source
 * line so the repository layer can replace exactly one line on write instead of
 * re-serializing (and reformatting) the whole document.
 */
export function parseProject(relPath: string, input: string): ProjectDoc {
  const source = input.replace(/^﻿/, '');
  const eol: '\n' | '\r\n' = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const warnings: string[] = [];

  // ---- Front matter: metadata only; line numbers still refer to the full file ----
  let fmEnd = -1;
  if (lines[0]?.trim() === '---') {
    fmEnd = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (fmEnd < 0) warnings.push('Front Matter 缺少结束的 ---');
  }

  let meta: Record<string, unknown> = {};
  if (fmEnd > 0) {
    try {
      meta = (matter(source).data ?? {}) as Record<string, unknown>;
    } catch (error) {
      warnings.push(`Front Matter 解析失败：${(error as Error).message}`);
    }
  }

  // ---- Project description: the marker block between front matter and H1 ----
  let description: string | undefined;
  const descStart = lines.findIndex(
    (line, index) => index > fmEnd && line.trim() === DESCRIPTION_START,
  );
  if (descStart >= 0) {
    const descEnd = lines.findIndex(
      (line, index) => index > descStart && line.trim() === DESCRIPTION_END,
    );
    if (descEnd > descStart) {
      description = lines.slice(descStart + 1, descEnd).join('\n').trim();
    }
  }

  const roots: TaskNode[] = [];
  const byId = new Map<string, TaskNode>();
  const stack: TaskNode[] = [];
  const syntheticSeed = new Map<string, number>();
  let title: string | undefined;
  let section: string | undefined;
  let inFence = false;
  let inDescription = false;

  for (let lineNo = Math.max(0, fmEnd + 1); lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
    // Description content is documentation only: never let headings or task
    // markers inside it pollute the parsed project tree.
    if (raw.trim() === DESCRIPTION_START) {
      inDescription = true;
      continue;
    }
    if (raw.trim() === DESCRIPTION_END) {
      inDescription = false;
      continue;
    }
    if (inDescription) continue;
    if (!raw.trim()) continue;

    if (FENCE_LINE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING_LINE.exec(raw);
    if (heading) {
      stack.length = 0;
      if (heading[1].length === 1 && !title) title = heading[2];
      if (heading[1].length === 2) section = heading[2];
      continue;
    }

    const taskMatch = TASK_LINE.exec(raw);
    if (taskMatch) {
      const indent = indentWidth(taskMatch[1]);
      const node = buildTask(
        relPath,
        taskMatch[3] ?? '',
        taskMatch[2],
        lineNo,
        indent,
        syntheticSeed,
        warnings,
      );

      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(node);
      } else {
        node.section = section;
        roots.push(node);
      }

      if (byId.has(node.id)) {
        warnings.push(`第 ${lineNo + 1} 行：任务 ID 重复 ${node.id}`);
      } else {
        byId.set(node.id, node);
      }
      stack.push(node);
      continue;
    }

    const progressMatch = PROGRESS_LINE.exec(raw);
    if (progressMatch) {
      const indent = indentWidth(progressMatch[1]);
      const owner = [...stack].reverse().find((node) => node.indent < indent);
      if (!owner) {
        warnings.push(`第 ${lineNo + 1} 行：进展记录找不到所属任务`);
        continue;
      }

      const body = progressMatch[4];
      const author = /\[by::([^\]]*)\]/.exec(body)?.[1]?.trim();
      owner.progress.push({
        date: progressMatch[2],
        time: progressMatch[3],
        author,
        text: body
          .replace(FIELD_TOKEN_STRIP, '')
          .replace(/\s+/g, ' ')
          .trim(),
        line: lineNo,
      });
      continue;
    }

    // Quotes, paragraphs and plain lists are intentionally preserved but not parsed.
  }

  return { meta, title, description, roots, byId, lines, eol, warnings };
}

function buildTask(
  relPath: string,
  body: string,
  mark: string,
  line: number,
  indent: number,
  seed: Map<string, number>,
  warnings: string[],
): TaskNode {
  let text = body;
  let id: string | undefined;

  const idMatch = ID_COMMENT.exec(text);
  if (idMatch) {
    id = idMatch[1];
    text = text.slice(0, idMatch.index);
  }

  const fields: TaskFields = {};
  const title = text
    .replace(FIELD_TOKEN, (_match, key: string, value: string) => {
      const canonical = FIELD_ALIASES[key] ?? key.toLowerCase();
      fields[canonical] = value.trim();
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (fields.priority && /^p\d$/i.test(fields.priority)) {
    fields.priority = fields.priority.toUpperCase();
  }
  if (fields.due && !/^\d{4}-\d{2}-\d{2}$/.test(fields.due)) {
    warnings.push(`第 ${line + 1} 行：due 应为 YYYY-MM-DD（当前 ${fields.due}）`);
  }

  let synthetic = false;
  if (!id) {
    synthetic = true;
    const key = `${relPath}\u0000${body.trim()}`;
    const occurrence = (seed.get(key) ?? 0) + 1;
    seed.set(key, occurrence);
    id = `s_${fnv1a(`${key}\u0000${occurrence}`)}`;
  }

  return {
    id,
    synthetic,
    line,
    indent,
    title: title || '（未命名任务）',
    done: mark.toLowerCase() === 'x',
    fields,
    progress: [],
    children: [],
  };
}

const FIELD_ORDER = [
  'owner',
  'priority',
  'importance',
  'start',
  'due',
  'cycle',
  'confirm',
  'progress',
  'deps',
];

/** Serialize one task line. Untouched lines are never passed through this. */
export function serializeTaskLine(task: {
  indent: number;
  done: boolean;
  title: string;
  fields: TaskFields;
  id?: string;
}): string {
  const keys = Object.keys(task.fields)
    .filter((key) => task.fields[key]?.trim())
    .sort((a, b) => fieldRank(a) - fieldRank(b));

  const tokens = keys
    .map((key) => `[${key}::${sanitizeFieldValue(task.fields[key]!)}]`)
    .join(' ');

  return [
    ' '.repeat(Math.max(0, task.indent)),
    `- [${task.done ? 'x' : ' '}] ${task.title.trim()}`,
    tokens ? ` ${tokens}` : '',
    task.id ? ` <!-- id:${task.id} -->` : '',
  ].join('');
}

function fieldRank(key: string): number {
  const index = FIELD_ORDER.indexOf(key);
  return index < 0 ? FIELD_ORDER.length : index;
}

function sanitizeFieldValue(value: string): string {
  return value.replace(/[[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function indentWidth(whitespace: string): number {
  return whitespace.replace(/\t/g, '  ').length;
}

/**
 * Ordered list of H2 group names (`## name`). Fence-aware and description-
 * aware: headings inside the project description block are documentation,
 * never real groups. Empty groups are included so the UI can show them while
 * managing task sections.
 */
export function collectSections(lines: string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let inDescription = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === DESCRIPTION_START) {
      inDescription = true;
      continue;
    }
    if (trimmed === DESCRIPTION_END) {
      inDescription = false;
      continue;
    }
    if (inDescription) continue;
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = HEADING_LINE.exec(line);
    if (heading && heading[1].length === 2) {
      const name = heading[2].trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}
