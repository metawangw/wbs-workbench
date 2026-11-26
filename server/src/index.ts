import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import { PathError, ROOT, WEB_DIST, decodeProjectId, getDataRoot, resolveProjectPath, setDataRoot } from './paths';
import {
  DEFAULT_SETTINGS,
  isLockedProjectStatus,
  isProjectPageKey,
  normalizeAppearance,
  normalizeBrand,
  normalizeProjectStatuses,
  normalizeSettings,
  type AppSettings,
} from '@wbs/shared';
import { getProject, invalidateAll, listFolders, listProjects } from './store';
import {
  HttpError,
  addProgress,
  createFolder,
  createProject,
  createSection,
  createTask,
  deleteProjectFolder,
  deleteSection,
  deleteTask,
  moveProject,
  moveTask,
  moveTaskToSection,
  renameProjectFolder,
  renameSection,
  reorderProjects,
  updateSectionDescription,
  updateMilestoneTasks,
  updateProgress,
  updateProjectMeta,
  updateProjectPage,
  updateProjectPageOrder,
  updateTask,
} from './repo';
import { broadcast, sseHandler } from './sse';
import { restartWatcher, startWatcher, suspendWatcher } from './watch';

const PORT = Number(process.env.PORT ?? 5178);
const HOST = process.env.HOST ?? '127.0.0.1';
const CONFIG_FILE = path.join(ROOT, '.wbs-config.json');

const app = express();
app.disable('x-powered-by');
// The HTML/PDF export posts a finished document, which is larger than a
// regular API payload; every other route stays tiny by comparison.
app.use(express.json({ limit: '10mb' }));
const MAX_EXPORT_HTML = 9_500_000;

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function wrap(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function projectPath(pid: string): string {
  return resolveProjectPath(decodeProjectId(pid));
}

/** Timestamp of the frontend build (web/dist), falling back to package.json. */
async function builtAt(): Promise<string> {
  const candidates = [path.join(WEB_DIST, 'index.html'), path.join(ROOT, 'package.json')];
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat) return stat.mtime.toISOString();
  }
  return new Date().toISOString();
}

async function readConfigFile(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Persist the whole config object (dataDir + settings) without losing keys. */
async function writeConfigFile(patch: Record<string, unknown>): Promise<void> {
  const current = await readConfigFile();
  const next = { ...current, ...patch };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

function sanitizeFolderList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
}

/** Apply a persisted folder order to the directories currently on disk. */
function orderFolders(known: string[], order: string[]): string[] {
  const rank = new Map(order.map((folder, index) => [folder, index]));
  return [...known].sort((a, b) => {
    const rankA = rank.get(a);
    const rankB = rank.get(b);
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

async function readFolderOrder(): Promise<string[]> {
  return sanitizeFolderList((await readConfigFile()).folderOrder);
}

/** Update order entries after a rename, or drop them after a deletion. */
function mapFolderOrder(order: string[], from: string, to: string | null): string[] {
  return order
    .map((folder) => {
      if (folder === from) return to;
      if (folder.startsWith(`${from}/`)) {
        return to ? `${to}/${folder.slice(from.length + 1)}` : null;
      }
      return folder;
    })
    .filter((folder): folder is string => folder !== null);
}

async function persistFolderOrder(known: string[], order: string[]): Promise<string[]> {
  const next = orderFolders(known, order);
  await writeConfigFile({ folderOrder: next });
  return next;
}

/** Read the persisted settings, normalised and merged with defaults. */
async function readSettings(): Promise<AppSettings> {
  const config = await readConfigFile();
  return normalizeSettings(config.settings ?? DEFAULT_SETTINGS);
}

/** Apply the persisted data root (if any) at startup. */
async function loadConfig(): Promise<void> {
  const config = await readConfigFile();
  const dataDir = config.dataDir;
  if (typeof dataDir !== 'string' || !dataDir.trim() || !path.isAbsolute(dataDir)) {
    return;
  }
  await fs.mkdir(dataDir, { recursive: true });
  setDataRoot(dataDir);
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

app.get('/api/config', wrap(async (_req, res) => {
  res.json({
    dataDir: getDataRoot(),
    port: PORT,
    version: '0.1.0',
    builtAt: await builtAt(),
    settings: await readSettings(),
  });
}));

app.get('/api/settings', wrap(async (_req, res) => {
  res.json(await readSettings());
}));

app.put('/api/settings', wrap(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const current = await readSettings();
  // Merge partial patches: a patch may carry only `appearance` or only `brand`.
  const appearance = 'appearance' in body
    ? normalizeAppearance({ ...current.appearance, ...(body.appearance as Record<string, unknown>) })
    : current.appearance;
  const brand = 'brand' in body
    ? normalizeBrand({ ...current.brand, ...(body.brand as Record<string, unknown>) })
    : current.brand;
  const statuses = 'statuses' in body
    ? normalizeProjectStatuses(body.statuses)
    : current.statuses;
  const next: AppSettings = { appearance, brand, statuses };
  await writeConfigFile({ settings: next });
  broadcast({ type: 'settings-changed', settings: next, at: Date.now() });
  res.json(next);
}));

app.post('/api/config', wrap(async (req, res) => {
  const input = req.body?.dataDir;
  if (typeof input !== 'string' || !input.trim()) {
    throw new HttpError(400, '数据目录不能为空');
  }
  const dataDir = input.trim();
  if (!path.isAbsolute(dataDir)) {
    throw new HttpError(400, '数据目录必须是绝对路径');
  }
  if (/[\u0000-\u001f]/.test(dataDir)) {
    throw new HttpError(400, '数据目录包含非法字符');
  }

  await fs.mkdir(dataDir, { recursive: true });
  setDataRoot(dataDir);
  invalidateAll();
  await restartWatcher();
  await writeConfigFile({ dataDir });
  broadcast({ type: 'config-changed', dataDir, at: Date.now() });
  res.json({ ok: true, dataDir: getDataRoot() });
}));

app.get(
  '/api/projects/:pid/images/:filename',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const filename = req.params.filename ?? '';
    if (
      !filename ||
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('\0') ||
      filename === '.' ||
      filename === '..'
    ) {
      throw new HttpError(400, '非法图片文件名');
    }
    const ext = path.extname(filename).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) throw new HttpError(400, '不支持的图片格式');

    const filePath = path.join(path.dirname(abs), filename);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) throw new HttpError(404, '图片不存在');

    const data = await fs.readFile(filePath);
    res.type(mime).send(data);
  }),
);

// ---------------------------------------------------------------------------
// Project file actions: open with the OS, or export the current view.
// Every handler goes through projectPath() -> resolveProjectPath() so the
// data-root sandbox (relative only, no hidden segments, .md only) still holds.
// ---------------------------------------------------------------------------

/** Strip characters Windows/macOS refuse in a download filename. */
function safeFilename(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || fallback;
}

/** `Content-Disposition` with an ASCII fallback plus the real UTF-8 filename. */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Locate a Chromium-based browser for headless PDF printing. */
function findBrowserExecutable(): string | null {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const bases = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ];
    const relatives = [
      path.join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join('Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const base of bases) {
      if (!base) continue;
      for (const relative of relatives) candidates.push(path.join(base, relative));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push(
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    );
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Run `browser --headless --print-to-pdf` and resolve once it exits. */
function printToPdf(
  browser: string,
  profileDir: string,
  htmlPath: string,
  pdfPath: string,
): Promise<void> {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    `--print-to-pdf=${pdfPath}`,
    '--print-to-pdf-no-header',
    pathToFileURL(htmlPath).href,
  ];

  return new Promise<void>((resolve, reject) => {
    const child = spawn(browser, args, { stdio: 'ignore', windowsHide: true });
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    timer = setTimeout(() => {
      child.kill();
      finish(new HttpError(501, 'PDF 生成超时，请稍后重试'));
    }, 30_000);

    child.once('error', (error: Error) => {
      finish(new HttpError(500, `无法启动浏览器：${error.message}`));
    });
    child.once('exit', () => finish());
  });
}

/** Render the given HTML document to a PDF buffer via headless Edge/Chrome. */
async function renderPdfBuffer(html: string): Promise<Buffer> {
  const browser = findBrowserExecutable();
  if (!browser) {
    throw new HttpError(501, '未找到可用的 Microsoft Edge 或 Chrome，无法导出 PDF');
  }

  const workDir = path.join(os.tmpdir(), `wbs-export-${randomUUID()}`);
  const htmlPath = path.join(workDir, 'document.html');
  const pdfPath = path.join(workDir, 'document.pdf');

  try {
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(htmlPath, html, 'utf8');
    await printToPdf(browser, path.join(workDir, 'profile'), htmlPath, pdfPath);

    const data = await fs.readFile(pdfPath).catch(() => null);
    if (!data || data.length === 0) {
      throw new HttpError(501, 'PDF 生成失败，请确认 Microsoft Edge 或 Chrome 可正常启动');
    }
    return data;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Open a file or folder with the platform default handler (fire and forget). */
function openWithSystem(target: string, kind: 'file' | 'folder'): Promise<void> {
  const isWin = process.platform === 'win32';
  let command: string;
  let args: string[];

  if (isWin) {
    // Route BOTH files and directories through the shell `start` verb.
    // Passing a directory straight to explorer.exe is unreliable when the
    // server has no console; `start` hands the path to the registered shell
    // association, which opens Explorer for directories and the default app
    // for files. The explicit empty argument is the window-title slot, so a
    // path containing spaces is never consumed as the title.
    command = 'cmd.exe';
    args = ['/d', '/c', 'start', '', target];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [target];
  } else {
    command = 'xdg-open';
    args = [target];
  }

  const printableArgs = args.map((arg) => (arg === '' ? '""' : arg)).join(' ');
  console.log(`[wbs] 打开${kind === 'folder' ? '目录' : '文件'}：${command} ${printableArgs}`);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        stdio: 'ignore',
        // On Windows windowsHide injects CREATE_NO_WINDOW. A hidden console
        // can leave the shell helper with no desktop to surface its GUI from,
        // which is why "open folder" did nothing. GUI launches stay visible.
        windowsHide: false,
      });
    } catch (error) {
      finish(new HttpError(500, `无法调用系统程序：${(error as Error).message}`));
      return;
    }

    child.once('error', (error: Error) => {
      finish(new HttpError(500, `无法调用系统程序：${error.message}`));
    });
    child.once('spawn', () => {
      child.unref();
      finish();
    });
    // `start` is a fast-exiting shell helper: on Windows it can exit before
    // Node emits 'spawn'. Do not leave the HTTP request hanging in that race.
    const fallback = setTimeout(finish, 1500);
    fallback.unref();
  });
}

app.post(
  '/api/projects/:pid/open-file',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) throw new HttpError(404, '任务 Markdown 文件不存在');

    await openWithSystem(abs, 'file');
    res.json({ ok: true, path: abs });
  }),
);

app.post(
  '/api/projects/:pid/open-folder',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const dir = path.dirname(abs);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new HttpError(404, '文件目录不存在');

    await openWithSystem(dir, 'folder');
    res.json({ ok: true, path: dir });
  }),
);

/**
 * Print a client-rendered "what you see" document to PDF.
 *
 * The browser is the only place that knows how the board/list currently looks
 * (filters, title-task switch, expansion state, appearance colours), so the web
 * app posts the finished standalone HTML and this route only turns it into a
 * PDF via headless Edge/Chrome.
 */
app.post(
  '/api/export/pdf',
  wrap(async (req, res) => {
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    if (!html.trim()) throw new HttpError(400, '缺少要导出的内容');
    if (html.length > MAX_EXPORT_HTML) throw new HttpError(413, '导出内容过大，请先收起部分任务');

    const rawName = typeof req.body?.filename === 'string' ? req.body.filename : '';
    const filename = `${safeFilename(rawName, 'wbs')}.pdf`;

    const pdf = await renderPdfBuffer(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachmentDisposition(filename));
    res.send(pdf);
  }),
);

/** Existing drive roots on Windows (C:\, D:\ ...). */
function listDriveRoots(): Array<{ name: string; path: string }> {
  const roots: Array<{ name: string; path: string }> = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (existsSync(root)) roots.push({ name: root, path: root });
  }
  return roots;
}

// Read-only directory browser for the sidebar "choose data directory" dialog.
// Lists sub-directories only; never reads file contents.
app.get(
  '/api/fs/dirs',
  wrap(async (req, res) => {
    const raw = typeof req.query.path === 'string' ? req.query.path : '';
    const target = raw.trim();

    // No path supplied -> drive roots (Windows) or filesystem root (POSIX).
    if (!target) {
      if (process.platform === 'win32') {
        res.json({ path: '', parent: null, dirs: listDriveRoots() });
      } else {
        res.json({ path: '/', parent: null, dirs: [{ name: '/', path: '/' }] });
      }
      return;
    }

    if (target.includes('\0')) throw new HttpError(400, '路径包含非法字符');
    if (!path.isAbsolute(target)) throw new HttpError(400, '路径必须是绝对路径');

    const entries = await fs
      .readdir(target, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        const code = error?.code;
        if (code === 'ENOENT') throw new HttpError(404, '目录不存在');
        if (code === 'EACCES' || code === 'EPERM') {
          throw new HttpError(403, '没有权限访问该目录');
        }
        if (code === 'ENOTDIR') throw new HttpError(400, '该路径不是目录');
        throw new HttpError(400, '无法读取该目录');
      });

    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    const parent = path.dirname(target);
    res.json({ path: target, parent: parent === target ? null : parent, dirs });
  }),
);

app.get(
  '/api/folders',
  wrap(async (_req, res) => {
    const known = await listFolders();
    res.json(orderFolders(known, await readFolderOrder()));
  }),
);

app.post(
  '/api/folders',
  wrap(async (req, res) => {
    const result = await createFolder({ folder: req.body?.folder });
    const known = await listFolders();
    await persistFolderOrder(known, await readFolderOrder());
    broadcast({ type: 'files-changed', at: Date.now() });
    res.status(201).json(result);
  }),
);

app.put(
  '/api/folders/order',
  wrap(async (req, res) => {
    const requested = sanitizeFolderList(req.body?.folders);
    const known = await listFolders();
    if (requested.some((folder) => !known.includes(folder))) {
      throw new HttpError(400, '文件夹顺序包含不存在的目录');
    }
    const next = await persistFolderOrder(known, requested);
    broadcast({ type: 'folders-changed', folders: next, at: Date.now() });
    res.json(next);
  }),
);

app.post(
  '/api/folders/rename',
  wrap(async (req, res) => {
    await suspendWatcher();
    let result: { from: string; to: string };
    try {
      result = await renameProjectFolder({
        from: req.body?.from,
        to: req.body?.to,
      });
    } finally {
      startWatcher();
    }
    const known = await listFolders();
    const order = mapFolderOrder(await readFolderOrder(), result.from, result.to);
    const folders = await persistFolderOrder(known, order);
    broadcast({ type: 'files-changed', at: Date.now() });
    res.json({ ...result, folders });
  }),
);

app.post(
  '/api/folders/delete',
  wrap(async (req, res) => {
    await suspendWatcher();
    let result: { folder: string; moved: number };
    try {
      result = await deleteProjectFolder({ folder: req.body?.folder });
    } finally {
      startWatcher();
    }
    const known = await listFolders();
    const order = mapFolderOrder(await readFolderOrder(), result.folder, null);
    const folders = await persistFolderOrder(known, order);
    broadcast({ type: 'files-changed', at: Date.now() });
    res.json({ ...result, folders });
  }),
);

// 已归档 / 已终止项目只允许修改项目信息；任务、页面、分组等写入一律拒绝。
// 前端已禁用相应入口，这里再守一道，避免直接调接口绕过。
app.use(
  '/api/projects/:pid',
  wrap(async (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const subPath = req.path.replace(/^\/+|\/+$/g, '');
    // PATCH /api/projects/:pid 修改项目信息，/move 属于项目组合管理，均保留。
    if (!subPath || subPath === 'move') {
      next();
      return;
    }
    const project = await getProject(req.params.pid);
    if (isLockedProjectStatus(project.status)) {
      throw new HttpError(403, '项目已归档或终止，仅可修改项目信息');
    }
    next();
  }),
);

app.get(
  '/api/projects',
  wrap(async (_req, res) => {
    res.json(await listProjects());
  }),
);

app.post(
  '/api/projects',
  wrap(async (req, res) => {
    const result = await createProject({
      name: req.body?.name,
      code: req.body?.code,
      status: req.body?.status,
      folder: req.body?.folder,
    });
    res.status(201).json(result);
  }),
);

app.post(
  '/api/projects/reorder',
  wrap(async (req, res) => {
    res.json(await reorderProjects({ ids: req.body?.ids }));
  }),
);

app.post(
  '/api/projects/:pid/move',
  wrap(async (req, res) => {
    const result = await moveProject({ id: req.params.pid, folder: req.body?.folder });
    res.json(result);
  }),
);

app.patch(
  '/api/projects/:pid',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    await updateProjectMeta(abs, {
      name: req.body?.name,
      code: req.body?.code,
      status: req.body?.status,
      description: req.body?.description,
      tags: req.body?.tags,
    });
    res.json({ ok: true });
  }),
);

app.get(
  '/api/projects/:pid',
  wrap(async (req, res) => {
    res.json(await getProject(req.params.pid));
  }),
);

// 里程碑 / 风险 / 成本 / 相关方：各自一个 Markdown 标记块，写入项目文件本体。
app.put(
  '/api/projects/:pid/pages/:key',
  wrap(async (req, res) => {
    const key = req.params.key;
    if (!isProjectPageKey(key)) throw new HttpError(400, '未知的页面类型');
    const abs = projectPath(req.params.pid);
    await updateProjectPage(abs, key, req.body?.text);
    res.json(await getProject(req.params.pid));
  }),
);

// 页面展示顺序（拖动调整后写回 Front Matter 的 pageOrder）。
app.put(
  '/api/projects/:pid/page-order',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    await updateProjectPageOrder(abs, req.body?.order);
    res.json(await getProject(req.params.pid));
  }),
);

// 里程碑关联任务（写回 Front Matter 的 milestoneTasks）。
app.put(
  '/api/projects/:pid/milestone-tasks',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    await updateMilestoneTasks(abs, req.body?.ids);
    res.json(await getProject(req.params.pid));
  }),
);

app.patch(
  '/api/projects/:pid/tasks/:tid',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const result = await updateTask(abs, req.params.tid, {
      done: req.body?.done,
      title: req.body?.title,
      fields: req.body?.fields,
    });
    res.json(result);
  }),
);

app.post(
  '/api/projects/:pid/tasks/:tid/progress',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    await addProgress(abs, req.params.tid, {
      text: req.body?.text,
      author: req.body?.author,
    });
    res.json({ ok: true });
  }),
);

app.patch(
  '/api/projects/:pid/tasks/:tid/progress',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    await updateProgress(abs, req.params.tid, {
      line: req.body?.line,
      text: req.body?.text,
    });
    res.json({ ok: true });
  }),
);

app.post(
  '/api/projects/:pid/tasks',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const result = await createTask(abs, req.body ?? {});
    res.status(201).json(result);
  }),
);

app.delete(
  '/api/projects/:pid/tasks/:tid',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    await deleteTask(abs, req.params.tid);
    res.status(204).end();
  }),
);

app.post(
  '/api/projects/:pid/tasks/:tid/move',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const result = await moveTask(abs, req.params.tid, {
      targetId: req.body?.targetId,
      position: req.body?.position,
    });
    res.json(result);
  }),
);

app.post(
  '/api/projects/:pid/tasks/:tid/move-section',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const result = await moveTaskToSection(abs, req.params.tid, {
      section: req.body?.section,
    });
    res.json(result);
  }),
);

app.post(
  '/api/projects/:pid/sections',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const result = await createSection(abs, { section: req.body?.section });
    res.status(201).json(result);
  }),
);

app.post(
  '/api/projects/:pid/sections/rename',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const result = await renameSection(abs, {
      from: req.body?.from,
      to: req.body?.to,
    });
    res.json(result);
  }),
);

app.post(
  '/api/projects/:pid/sections/delete',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const result = await deleteSection(abs, { section: req.body?.section });
    res.json(result);
  }),
);

app.post(
  '/api/projects/:pid/sections/description',
  wrap(async (req, res) => {
    const abs = projectPath(req.params.pid);
    const result = await updateSectionDescription(abs, {
      section: req.body?.section,
      description: req.body?.description,
    });
    res.json(result);
  }),
);

app.get('/api/events', sseHandler);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .type('text/plain; charset=utf-8')
      .send(
        'WBS 工作台本地服务运行中。\n开发模式请打开 http://127.0.0.1:5173\n生产模式请先执行 npm run build',
      );
  });
}

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof PathError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    res.status(404).json({ error: '文件不存在或已被删除' });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: '请求 JSON 格式错误' });
    return;
  }

  console.error('[wbs] 未处理异常:', error);
  res.status(500).json({ error: '服务器内部错误' });
};

app.use(errorHandler);

/**
 * Background launches run the server with stdio: 'ignore' (required so libuv
 * sets CREATE_NO_WINDOW and the child gets its own hidden console). With no
 * stdio, console output would be lost. When WBS_LOG_FILE is provided by the
 * launcher, mirror console.log/error into that file so background logs remain
 * observable via wbs-background-<port>.log. Best-effort: never blocks startup.
 */
function setupFileLogging(): void {
  const logFile = process.env.WBS_LOG_FILE;
  if (!logFile) return;

  let stream: ReturnType<typeof createWriteStream>;
  try {
    stream = createWriteStream(logFile, { flags: 'a' });
    stream.on('error', () => {
      /* ignore log write failures; never crash the server for logs */
    });
  } catch {
    return;
  }

  const toText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ?? value.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const emit = (args: unknown[]): void => {
    try {
      stream.write(`${args.map(toText).join(' ')}\n`);
    } catch {
      /* ignore */
    }
  };

  console.log = (...args: unknown[]): void => emit(args);
  console.info = console.log;
  console.debug = console.log;
  console.error = (...args: unknown[]): void => emit(args);
  console.warn = console.error;
}

async function main(): Promise<void> {
  setupFileLogging();
  await loadConfig();
  await fs.mkdir(getDataRoot(), { recursive: true });

  app.listen(PORT, HOST, () => {
    console.log('');
    console.log('  WBS 工作台 · 本地服务已启动');
    console.log(`  服务地址  http://${HOST}:${PORT}`);
    console.log(`  数据目录  ${getDataRoot()}`);
    if (!existsSync(WEB_DIST)) {
      console.log('  开发模式  请打开 http://127.0.0.1:5173');
    }
    console.log('');
  });

  startWatcher();
}

main().catch((error) => {
  console.error('[wbs] 启动失败:', error);
  process.exitCode = 1;
});
