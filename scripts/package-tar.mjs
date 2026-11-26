import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 绿色迁移包：把源码、便携运行时、依赖与前端产物打成一个 tar.gz。
// 解压到任意目录后，双击 background_start.bat 即可运行，无需安装 Node/npm。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INCLUDES = [
  '.gitattributes',
  '.gitignore',
  'README.md',
  'package.json',
  'package-lock.json',
  'background_start.bat',
  'background_stop.bat',
  'frontground_start.bat',
  'docs',
  'examples',
  'node_modules',
  'runtime',
  'scripts',
  'server',
  'shared',
  'web',
];

const missing = INCLUDES.filter((item) => !existsSync(path.join(ROOT, item)));
if (missing.length > 0) {
  console.error('缺少打包项：' + missing.join(', '));
  process.exit(1);
}

const probe = spawnSync('tar', ['--version'], { encoding: 'utf8' });
const tar = probe.status === 0
  ? 'tar'
  : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const now = new Date();
const stamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('.');
const output = path.join(ROOT, `wbs-workbench-portable-${stamp}.tar.gz`);

// tar 会把 Windows 绝对路径里的 "C:" 当成远程主机，必须传相对文件名。
// -h 解引用符号链接：node_modules/@wbs/* 指向本机绝对路径，不解引用换机即失效。
const outputName = path.basename(output);
const result = spawnSync(
  tar,
  ['-czhf', outputName, ...INCLUDES],
  {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
);
if (result.status !== 0) {
  console.error((result.stderr || result.stdout || '').trim());
  process.exit(result.status ?? 1);
}

const size = statSync(output).size;
console.log(`打包完成：${path.basename(output)}`);
console.log(`大小：${(size / 1024 / 1024).toFixed(1)} MB`);
console.log('解压后双击 background_start.bat 启动，background_stop.bat 停止。');
