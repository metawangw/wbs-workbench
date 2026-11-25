import fs from 'node:fs/promises';
import path from 'node:path';
import {
  collectCodes,
  collectOwners,
  collectStats,
  flattenTasks,
  isFocused,
  normalizeProjectPageOrder,
  normalizeProjectTags,
  type FocusTask,
  type ProjectDetail,
  type ProjectDoc,
  type ProjectSummary,
} from '@wbs/shared';
import {
  collectSectionDescriptions,
  collectSections,
  parseProject,
} from '@wbs/shared/parser';
import {
  decodeProjectId,
  encodeProjectId,
  getDataRoot,
  resolveProjectPath,
  toRelPath,
} from './paths';

interface CacheEntry {
  mtimeMs: number;
  size: number;
  doc: ProjectDoc;
}

const cache = new Map<string, CacheEntry>();

export async function loadDoc(abs: string): Promise<ProjectDoc> {
  const stat = await fs.stat(abs);
  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.doc;
  }

  const raw = await fs.readFile(abs, 'utf8');
  const doc = parseProject(toRelPath(abs), raw);
  cache.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, doc });
  return doc;
}

export function invalidate(abs: string): void {
  cache.delete(abs);
}

export function invalidateAll(): void {
  cache.clear();
}

async function collectFolders(dir: string, base: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    out.push(rel);
    await collectFolders(path.join(dir, entry.name), rel, out);
  }
}

export async function listFolders(): Promise<string[]> {
  const folders: string[] = [];
  await collectFolders(getDataRoot(), '', folders);
  return folders.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(abs)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(abs);
    }
  }
  return files;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function asTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return asString(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/**
 * Flatten every task pinned to 今日关注. The summaries power the overview
 * sticky-note board, so the client never has to fetch each project's detail.
 */
function buildFocusTasks(doc: ProjectDoc): FocusTask[] {
  const codes = collectCodes(doc.roots);
  const tasks: FocusTask[] = [];
  for (const task of flattenTasks(doc.roots)) {
    if (!isFocused(task.fields)) continue;
    // Progress lines are not guaranteed to be date-sorted in the file, so pick
    // the newest entry explicitly instead of assuming the last one.
    const latest = task.progress.reduce<(typeof task.progress)[number] | undefined>(
      (best, entry) =>
        !best ||
        `${entry.date} ${entry.time ?? ''}` > `${best.date} ${best.time ?? ''}`
          ? entry
          : best,
      undefined,
    );
    tasks.push({
      id: task.id,
      code: codes.get(task.id) ?? '',
      title: task.title,
      priority: task.fields.priority,
      owner: task.fields.owner,
      due: task.fields.due,
      color: task.fields.focusColor,
      done: task.done,
      latest: latest?.text.replace(/\s+/g, ' ').slice(0, 140),
      latestDate: latest?.date,
    });
  }
  return tasks;
}

function buildSummary(abs: string, doc: ProjectDoc): ProjectSummary {
  const rel = toRelPath(abs);
  const name =
    asString(doc.meta.project) ??
    doc.title ??
    path.basename(abs, path.extname(abs));

  const tags = normalizeProjectTags(doc.meta.tags);
  const focusTasks = buildFocusTasks(doc);

  return {
    id: encodeProjectId(rel),
    path: rel,
    order: asNumber(doc.meta.order),
    name,
    code: asString(doc.meta.code),
    status: asString(doc.meta.status),
    description: doc.description,
    tags: tags.length ? tags : undefined,
    focusTasks: focusTasks.length ? focusTasks : undefined,
    updated: asTimestamp(doc.meta.updated),
    stats: collectStats(doc.roots),
  };
}

function buildDetail(abs: string, doc: ProjectDoc): ProjectDetail {
  const summary = buildSummary(abs, doc);
  return {
    ...summary,
    meta: doc.meta,
    title: doc.title,
    pages: doc.pages ?? {},
    pageOrder: doc.pageOrder ?? normalizeProjectPageOrder(undefined),
    milestoneTasks: doc.milestoneTasks ?? [],
    roots: doc.roots,
    sections: collectSections(doc.lines),
    sectionDescriptions: collectSectionDescriptions(doc.lines),
    warnings: doc.warnings,
    owners: collectOwners(doc.roots),
    lineCount: doc.lines.length,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const files = await listMarkdownFiles(getDataRoot());
  const projects: ProjectSummary[] = [];

  for (const abs of files) {
    try {
      const doc = await loadDoc(abs);
      projects.push(buildSummary(abs, doc));
    } catch (error) {
      console.warn(`[wbs] 跳过无法解析的文件 ${abs}:`, (error as Error).message);
    }
  }

  projects.sort((a, b) => {
    const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    if (orderDiff !== 0) return orderDiff;
    const byName = a.name.localeCompare(b.name, 'zh-Hans-CN');
    return byName !== 0 ? byName : a.path.localeCompare(b.path);
  });
  return projects;
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const rel = decodeProjectId(id);
  const abs = resolveProjectPath(rel);
  const doc = await loadDoc(abs);
  return buildDetail(abs, doc);
}

export async function findProjectByPath(rel: string): Promise<ProjectDetail> {
  const abs = resolveProjectPath(rel);
  const doc = await loadDoc(abs);
  return buildDetail(abs, doc);
}
