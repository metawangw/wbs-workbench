import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '../..');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');

/**
 * Live-mutable data root. It defaults to `<ROOT>/data` (or WBS_DATA_DIR) and
 * can be switched at runtime via setDataRoot() — see POST /api/config.
 */
export let DATA_ROOT = path.resolve(ROOT, process.env.WBS_DATA_DIR ?? 'data');

export function getDataRoot(): string {
  return DATA_ROOT;
}

export function setDataRoot(next: string): void {
  DATA_ROOT = path.resolve(next);
}

export class PathError extends Error {}

function normalizeForCompare(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

const INVALID_FOLDER_CHARS = /[<>:"|?*\u0000-\u001f]/;
const WINDOWS_RESERVED_SEGMENT =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Normalize a user-entered relative folder path ("a\b/c" -> "a/b/c"). */
export function normalizeFolderInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input !== 'string') throw new PathError('文件夹路径必须是文本');

  const normalized = input.replace(/\\/g, '/').trim();
  if (!normalized) return '';

  const parts = normalized.split('/').map((part) => part.trim()).filter(Boolean);
  const cleaned = parts.map((part) => {
    if (part === '.' || part === '..') throw new PathError('文件夹路径不能包含 . 或 ..');
    if (part.startsWith('.')) throw new PathError('文件夹名称不能以 . 开头');
    if (INVALID_FOLDER_CHARS.test(part)) throw new PathError('文件夹名称包含非法字符');
    const value = part.replace(/[. ]+$/g, '');
    if (!value) throw new PathError('文件夹名称无效');
    if (WINDOWS_RESERVED_SEGMENT.test(value)) {
      throw new PathError('文件夹名称是系统保留名');
    }
    return value;
  });

  return cleaned.join('/');
}

export function resolveFolderPath(rel: string, allowRoot = false): string {
  const root = getDataRoot();
  const normalized = normalizeFolderInput(rel);
  if (!normalized) {
    if (allowRoot) return root;
    throw new PathError('文件夹名称不能为空');
  }

  const abs = path.resolve(root, ...normalized.split('/'));
  const rootPrefix = normalizeForCompare(root + path.sep);
  if (!normalizeForCompare(abs).startsWith(rootPrefix)) {
    throw new PathError('非法文件夹路径');
  }
  return abs;
}

export function resolveProjectPath(rel: string): string {
  const root = getDataRoot();
  if (!rel || rel.includes('\0') || path.isAbsolute(rel)) {
    throw new PathError('非法项目路径');
  }
  if (rel.split(/[\\/]/).some((part) => part.startsWith('.'))) {
    throw new PathError('不允许访问隐藏路径');
  }
  if (path.extname(rel).toLowerCase() !== '.md') {
    throw new PathError('仅支持 .md 文件');
  }

  const abs = path.resolve(root, rel);
  const rootPrefix = normalizeForCompare(root + path.sep);
  if (!normalizeForCompare(abs).startsWith(rootPrefix)) {
    throw new PathError('非法项目路径');
  }
  return abs;
}

export function toRelPath(abs: string): string {
  return path.relative(getDataRoot(), abs).split(path.sep).join('/');
}

export function encodeProjectId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

export function decodeProjectId(id: string): string {
  let rel: string;
  try {
    rel = Buffer.from(id, 'base64url').toString('utf8');
  } catch {
    throw new PathError('非法项目 ID');
  }
  // Reject garbage that decodes to control characters or mojibake.
  if (!rel || /[\u0000-\u001f]/.test(rel)) throw new PathError('非法项目 ID');
  return rel;
}
