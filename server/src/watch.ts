import path from 'node:path';
import chokidar from 'chokidar';
import { getDataRoot, toRelPath } from './paths';
import { invalidate } from './store';
import { broadcast } from './sse';

let watcher: ReturnType<typeof chokidar.watch> | null = null;
let pending = new Set<string>();
let timer: NodeJS.Timeout | undefined;

export function startWatcher(): void {
  if (watcher) return;
  const root = getDataRoot();

  watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (candidate) => {
      const base = path.basename(candidate);
      return base.startsWith('.') && candidate !== root;
    },
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 30,
    },
  });

  watcher.on('all', (event, file) => {
    if (!/\.md$/i.test(file)) return;
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;

    invalidate(file);
    pending.add(toRelPath(file));

    clearTimeout(timer);
    timer = setTimeout(() => {
      broadcast({ type: 'files-changed', files: [...pending], at: Date.now() });
      pending.clear();
    }, 150);
  });

  watcher.on('error', (error) => {
    console.warn('[wbs] 文件监听异常:', error);
  });

  console.log(`[wbs] 正在监听 ${root}`);
}

/** Close the current watcher and re-watch the (possibly new) data root. */
export async function restartWatcher(): Promise<void> {
  await suspendWatcher();
  startWatcher();
}

/**
 * Temporarily stop watching so Windows can rename/remove directories that a
 * watch handle would otherwise keep locked (EPERM). Always pair with
 * startWatcher() in a finally block.
 */
export async function suspendWatcher(): Promise<void> {
  const old = watcher;
  watcher = null;
  pending = new Set<string>();
  if (timer) clearTimeout(timer);
  if (old) await old.close().catch(() => {});
}
