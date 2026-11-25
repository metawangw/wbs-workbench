import { spawn, execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';

// Prefer the Node runtime bundled next to the project so the package also runs
// on machines without Node installed. x86 and x64 Windows are both supported;
// the launcher is started with the matching binary by the .bat wrapper.
const LOCAL_NODE = path.join(
  ROOT,
  'runtime',
  process.platform === 'win32'
    ? path.join(process.arch === 'ia32' ? 'x86' : 'x64', 'node.exe')
    : path.join(process.arch === 'ia32' ? 'x86' : 'x64', 'bin', 'node'),
);
// Backward compatibility with the earlier flat runtime layout.
const LEGACY_LOCAL_NODE = path.join(
  ROOT,
  'runtime',
  'node',
  process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'),
);
const NODE_BIN = [LOCAL_NODE, LEGACY_LOCAL_NODE].find((file) =>
  existsSync(file),
) ?? process.execPath;
const DIST_INDEX = path.join(ROOT, 'web', 'dist', 'index.html');

// Checked lazily: the `--stop` path must not pay the cost of spawning
// `where.exe npm`. Start/build paths call this only when they need it.
let cachedSystemNpm = null;
function hasSystemNpm() {
  if (cachedSystemNpm !== null) return cachedSystemNpm;
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['npm'], {
      stdio: 'ignore',
    });
    cachedSystemNpm = true;
  } catch {
    cachedSystemNpm = false;
  }
  return cachedSystemNpm;
}

function runtimeEnv() {
  const env = { ...process.env };
  const key =
    Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  const nodeDir = path.dirname(NODE_BIN);
  env[key] = nodeDir + path.delimiter + (env[key] ?? '');
  return env;
}
const requestedPort = Number(process.env.PORT ?? 5178);
if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
  console.error('[WBS] PORT 环境变量必须是 1-65535 的整数。');
  process.exit(1);
}
const DEFAULT_PORT = requestedPort;
const MAX_PORT = DEFAULT_PORT + 14;
const RUNTIME_FILE = path.join(ROOT, '.wbs-runtime.json');
const logFilePath = (port) => path.join(ROOT, `wbs-background-${port}.log`);
const BACKGROUND = process.argv.includes('--background');
const STOP = process.argv.includes('--stop');
const noOpen =
  process.argv.includes('--no-open') || process.env.WBS_NO_OPEN === '1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In background mode the launcher itself has no visible console. Mirror every
// message into the launcher log so startup progress/errors stay observable.
const LAUNCHER_LOG = path.join(ROOT, 'wbs-launcher.log');
const rawLog = (...args) => console.log('[WBS]', ...args);
const log = (...args) => {
  rawLog(...args);
  if (!BACKGROUND) return;
  try {
    appendFileSync(LAUNCHER_LOG, `[WBS] ${args.join(' ')}\n`);
  } catch {
    /* ignore */
  }
};

function readRuntime() {
  try {
    const value = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function saveRuntime(port, info) {
  const all = readRuntime();
  all[String(port)] = info;
  writeFileSync(RUNTIME_FILE, JSON.stringify(all, null, 2), 'utf8');
}

function forgetRuntime(port) {
  const all = readRuntime();
  if (!port) {
    writeFileSync(RUNTIME_FILE, '{}', 'utf8');
    return;
  }
  delete all[String(port)];
  writeFileSync(RUNTIME_FILE, JSON.stringify(all, null, 2), 'utf8');
}

function belongsToProject(pid, port) {
  const commandLine = commandLineOf(pid);
  if (commandLine) {
    const normalized = commandLine.toLowerCase().replace(/\//g, '\\');
    if (
      normalized.includes(ROOT.toLowerCase()) &&
      /src\\index\.ts|src\/index\.ts/i.test(commandLine)
    ) {
      return true;
    }
    // A Chinese folder name can be mangled by PowerShell's console encoding.
    // Fall back to signature matching plus a port/PID cross-check.
    const looksLikeWbs =
      /tsx[\\/]dist[\\/]cli\.mjs/i.test(commandLine) &&
      /server[\\/]src[\\/]index\.ts/i.test(commandLine);
    return looksLikeWbs && port !== undefined && pidOnPort(port) === pid;
  }
  // Some sandboxed shells cannot spawn PowerShell to read a command line.
  // The PID came from our own runtime file, so at least confirm the port still
  // belongs to it before trusting it.
  if (port !== undefined) {
    const currentPid = pidOnPort(port);
    if (currentPid !== null) return currentPid === pid;
  }
  return true;
}

async function fetchJson(url, timeout = 500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function isCurrentWbs(port) {
  const config = await fetchJson(`http://${HOST}:${port}/api/config`, 450);
  if (!config || typeof config !== 'object' || !('dataDir' in config)) {
    return false;
  }
  const folders = await fetchJson(`http://${HOST}:${port}/api/folders`, 450);
  return Array.isArray(folders);
}

async function findRunningWbs() {
  const ports = Array.from(
    { length: MAX_PORT - DEFAULT_PORT + 1 },
    (_, index) => DEFAULT_PORT + index,
  );
  const checks = await Promise.all(
    ports.map(async (port) => ((await isCurrentWbs(port)) ? port : null)),
  );
  return checks.find((port) => port !== null) ?? null;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: HOST }, () => {
      server.close(() => resolve(true));
    });
  });
}

function pidOnPort(port) {
  try {
    const output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`,
      ],
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
    const pid = Number(output);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function commandLineOf(pid) {
  try {
    return execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      ],
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
  } catch {
    return '';
  }
}

async function killStaleWbs(port) {
  const pid = pidOnPort(port);
  if (!pid) return false;

  const commandLine = commandLineOf(pid);
  const normalized = commandLine.toLowerCase().replace(/\//g, '\\');
  const root = ROOT.toLowerCase();
  const ours =
    normalized.includes(root) &&
    /src\\index\.ts|src\/index\.ts/i.test(commandLine);

  if (!ours) {
    log(`端口 ${port} 被其他程序占用（PID ${pid}），将改用其他端口。`);
    return false;
  }

  log(`检测到本项目残留的旧服务进程（PID ${pid}），正在停止…`);
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 5000,
    });
  } catch {
    /* 进程可能已退出 */
  }
  await sleep(700);
  return true;
}

async function findFreePort() {
  for (let port = DEFAULT_PORT; port <= MAX_PORT; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `端口 ${DEFAULT_PORT}-${MAX_PORT} 均被占用，无法启动服务。`,
  );
}

function runNpm(args) {
  return new Promise((resolve, reject) => {
    let command;
    let commandArgs;
    if (process.platform === 'win32') {
      command = process.env.ComSpec || 'cmd.exe';
      commandArgs = ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`];
    } else {
      command = 'npm';
      commandArgs = args;
    }

    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: runtimeEnv(),
      // `inherit` would attach npm's cmd.exe to the visible console (a blank
      // window). In background mode hide it and stream output into our log.
      stdio: BACKGROUND ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: BACKGROUND,
    });
    if (BACKGROUND) {
      child.stdout?.on('data', (chunk) => log(chunk.toString().trimEnd()));
      child.stderr?.on('data', (chunk) => log(chunk.toString().trimEnd()));
    }
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} 退出码 ${code}`));
    });
  });
}

async function ensureDependencies() {
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (existsSync(tsxCli)) return;
  if (!hasSystemNpm()) {
    throw new Error(
      '缺少运行依赖，且未找到可用的 npm；请使用完整迁移包或安装 Node.js 20+。',
    );
  }
  log('未检测到依赖，正在执行 npm install…');
  await runNpm(['install']);
}

async function buildWeb() {
  if (existsSync(DIST_INDEX) && !hasSystemNpm()) {
    log('使用包内已构建的前端（未内置 npm，跳过构建）。');
    return;
  }
  log('正在构建前端（首次或更新后需要十几秒）…');
  try {
    await runNpm(['run', 'build']);
    log('前端构建完成。');
  } catch (error) {
    if (existsSync(DIST_INDEX)) {
      log(`前端构建失败（${error.message}），改用包内已构建的 dist 继续启动。`);
      return;
    }
    throw error;
  }
}

function openBrowser(url) {
  if (noOpen) {
    log('已跳过自动打开浏览器（--no-open）。');
    return;
  }
  try {
    const command =
      process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : process.platform === 'darwin'
          ? { file: 'open', args: [url] }
          : { file: 'xdg-open', args: [url] };
    spawn(command.file, command.args, {
      // On Windows keep windowsHide only: detached injects DETACHED_PROCESS,
      // which can give the short-lived cmd a momentary visible console window.
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch {
    log(`请手动打开 ${url}`);
  }
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`服务进程提前退出（退出码 ${child.exitCode}）。`);
    }
    const config = await fetchJson(`http://${HOST}:${port}/api/config`, 500);
    if (config && typeof config === 'object') return;
    await sleep(400);
  }
  throw new Error('服务启动超时，请查看上方日志。');
}

async function stopBackground() {
  const runtime = readRuntime();
  const explicitPort = process.env.PORT !== undefined;
  const entries = Object.entries(runtime).filter(
    ([port]) => !explicitPort || Number(port) === DEFAULT_PORT,
  );

  if (!entries.length) {
    log('没有发现正在运行的 WBS 后台服务。');
    return;
  }

  // Fast stop path: the runtime file is written by this launcher itself, so a
  // plain HTTP probe of our own API is enough to confirm the port still hosts
  // this WBS service. This avoids spawning PowerShell/WMI (several seconds of
  // cold start) on the exit path. If the probe fails the service is already
  // gone, so there is nothing to kill and we just clear the stale entry.
  let stopped = 0;
  for (const [port, info] of entries) {
    const portNumber = Number(port);
    const alive = await isCurrentWbs(portNumber);

    if (!alive) {
      forgetRuntime(portNumber);
      log(`端口 ${port} 的服务已不在运行，清理记录。`);
      continue;
    }

    const pid = Number(info?.pid);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000,
        });
        stopped++;
        log(`已停止后台服务（端口 ${port}，PID ${pid}）。`);
      } catch {
        log(`停止 PID ${pid} 失败，服务可能已自行退出。`);
      }
    }
    forgetRuntime(portNumber);
  }
  if (!stopped) log('没有发现正在运行的 WBS 后台服务。');
}

async function main() {
  log(`项目目录：${ROOT}`);
  log(`Node 运行时：${NODE_BIN}`);

  if (STOP) {
    await stopBackground();
    return;
  }

  const runningPort = await findRunningWbs();
  if (runningPort) {
    const url = `http://${HOST}:${runningPort}`;
    log(`WBS 工作台已在运行：${url}`);
    if (BACKGROUND) {
      saveRuntime(runningPort, { pid: pidOnPort(runningPort), url, mode: 'background' });
    }
    openBrowser(url);
    return;
  }

  await ensureDependencies();

  if (!(await isPortFree(DEFAULT_PORT))) {
    await killStaleWbs(DEFAULT_PORT);
  }

  const port = await findFreePort();
  await buildWeb();

  const serverEntry = path.join(ROOT, 'server', 'src', 'index.ts');
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  log(`正在启动${BACKGROUND ? '后台' : '前台'}服务，端口 ${port}…`);

  // Background mode keeps this launcher alive as a daemon (see the BACKGROUND
  // branch below): the server always has a live parent, so we never rely on the
  // child outliving a dying parent. On Windows only `detached` lets a child
  // outlive its parent, but detached injects DETACHED_PROCESS which spawns a
  // visible blank console window, so we do NOT use it there.
  // stdio MUST be the string 'ignore' (not an fd array): libuv only sets
  // CREATE_NO_WINDOW when no stdio slot is an inherited fd (UV_INHERIT_FD), and
  // CREATE_NO_WINDOW gives the child an invisible console (no blank window).
  // Service logs are preserved via WBS_LOG_FILE (redirected inside index.ts).
  const stdio = BACKGROUND ? 'ignore' : 'inherit';
  const isWin = process.platform === 'win32';
  const spawnEnv = { ...runtimeEnv(), HOST, PORT: String(port) };
  if (BACKGROUND) {
    // When stdio is 'ignore' the child has no stdout/stderr; route its logs to
    // the per-port log file from inside the server process instead.
    spawnEnv.WBS_LOG_FILE = logFilePath(port);
  }
  const spawnOptions = {
    cwd: ROOT,
    env: spawnEnv,
    stdio,
    windowsHide: BACKGROUND,
  };
  if (BACKGROUND && !isWin) {
    spawnOptions.detached = true;
  }
  const child = spawn(NODE_BIN, [tsxCli, serverEntry], spawnOptions);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  };

  if (!BACKGROUND) {
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('exit', stop);
  }

  try {
    await waitForServer(port, child);
  } catch (error) {
    stop();
    throw error;
  }

  const url = `http://${HOST}:${port}`;
  console.log('');
  log(`服务已启动：${url}`);

  if (BACKGROUND) {
    saveRuntime(port, {
      pid: child.pid,
      url,
      mode: 'background',
      startedAt: new Date().toISOString(),
    });
    log('后台服务已启动并常驻（无窗口）。');
    log(`日志：${logFilePath(port)}`);
    log('停止服务：右键通知区域图标选择「退出服务」，或运行 background_stop.bat。');
    // Do NOT unref the child: keeping it referenced keeps this launcher's event
    // loop alive after main() returns, so the launcher stays resident as the
    // server's parent and the service keeps running. When the server exits
    // (e.g. background_stop -> taskkill), the launcher cleans up and exits too.
    child.on('exit', (code) => {
      log(`服务已停止（退出码 ${code ?? 0}）。`);
      forgetRuntime(port);
      process.exit(code ?? 0);
    });
    console.log('');
    openBrowser(url);
    return;
  }

  log('关闭此窗口即可停止服务。');
  console.log('');
  openBrowser(url);

  child.on('exit', (code) => {
    log(`服务已停止（退出码 ${code ?? 0}）。`);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error('');
  console.error(`[WBS] 启动失败：${error.message}`);
  process.exitCode = 1;
});
