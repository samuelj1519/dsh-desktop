import { constants } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import type { ConnectionState, OwnedLaunchSpec } from './contracts.js';

export interface DesktopSettings {
  mode: 'external' | 'owned';
  endpoint: string;
  nodePath: string;
  launcherPath: string;
  homePath: string;
  cwd: string;
}

export interface SettingsSnapshot {
  settings: DesktopSettings;
  saved: boolean;
  configError: string | null;
}

export interface DesktopViewState {
  connection: ConnectionState;
  actionError: string | null;
  actionPending: boolean;
  lifecycle: 'active' | 'exiting' | 'exit-failed';
}

export type PathField = 'nodePath' | 'launcherPath' | 'homePath' | 'cwd';

export interface DesktopBridge {
  config(): Promise<SettingsSnapshot>;
  state(): Promise<DesktopViewState>;
  connect(payload: { settings: DesktopSettings; repairConfig: boolean }): Promise<void>;
  stop(): Promise<void>;
  choose(payload: { field: PathField }): Promise<string | null>;
  subscribe(listener: (state: DesktopViewState) => void): () => void;
}

const SETTINGS_KEYS = ['mode', 'endpoint', 'nodePath', 'launcherPath', 'homePath', 'cwd'];

/** Reject extra fields instead of treating arbitrary renderer data as launch options. */
export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数必须是对象。');
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error('参数字段不匹配。');
  return result;
}

export function validateSettings(value: unknown): DesktopSettings {
  const object = exactObject(value, SETTINGS_KEYS);
  if (object.mode !== 'external' && object.mode !== 'owned') throw new Error('请选择现有服务或客户端启动。');
  for (const key of SETTINGS_KEYS.slice(1)) {
    if (typeof object[key] !== 'string' || (object[key] as string).length > 4096 || (object[key] as string).includes('\0')) {
      throw new Error('地址和路径必须是有效文本，长度不能超过 4096 个字符。');
    }
  }
  return object as unknown as DesktopSettings;
}

async function firstFile(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      const resolved = await realpath(path);
      if ((await stat(resolved)).isFile()) return resolved;
    } catch { /* A missing discovery candidate is not a configuration failure. */ }
  }
  return '';
}

async function versionFiles(root: string, suffix: string): Promise<string[]> {
  try {
    const versions = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).slice(0, 100);
    return versions.map(entry => entry.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(version => join(root, version, suffix));
  } catch { return []; }
}

/** Only filesystem/PATH discovery; dsh --help can write generated configuration. */
export async function defaultSettings(userData: string): Promise<DesktopSettings> {
  const paths = (process.env.PATH ?? '').split(delimiter).filter(path => isAbsolute(path)).slice(0, 100);
  const mise = join(homedir(), '.local', 'share', 'mise', 'installs');
  const nodePath = await firstFile([
    ...await versionFiles(join(mise, 'node'), 'bin/node'),
    ...paths.map(path => join(path, process.platform === 'win32' ? 'node.exe' : 'node')),
    '/opt/homebrew/bin/node', '/usr/local/bin/node',
  ]);
  const launcherPath = await firstFile([
    ...await versionFiles(join(mise, 'npm-deepseek-ai-dsh'), 'lib/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    ...paths.map(path => join(path, 'dsh')),
    join(homedir(), '.local', 'bin', 'dsh'),
    '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
  ]);
  return { mode: 'external', endpoint: 'http://127.0.0.1:3080', nodePath, launcherPath, homePath: join(userData, 'dsh-home'), cwd: join(userData, 'workspace') };
}

export class ConfigStore {
  readonly path: string;
  private damaged = false;

  constructor(userData: string) { this.path = join(userData, 'connection.json'); }

  async load(fallback: DesktopSettings): Promise<SettingsSnapshot> {
    let raw: string;
    try { raw = await readFile(this.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { settings: fallback, saved: false, configError: null };
      throw error;
    }
    try {
      const parsed = exactObject(JSON.parse(raw) as unknown, ['version', 'settings']);
      if (parsed.version !== 1) throw new Error('不支持的设置版本。');
      return { settings: validateSettings(parsed.settings), saved: true, configError: null };
    } catch (error) {
      this.damaged = true;
      return { settings: fallback, saved: false, configError: `连接设置无法读取：${String(error)}。修改参数后使用「修复设置并连接」；原文件将保留备份。` };
    }
  }

  async save(settings: DesktopSettings, repair: boolean): Promise<void> {
    if (this.damaged && !repair) throw new Error('连接设置已损坏，需要明确选择修复后再保存。');
    const content = JSON.stringify({ version: 1, settings: validateSettings(settings) }, null, 2) + '\n';
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    if (this.damaged) await copyFile(this.path, `${this.path}.damaged-${Date.now()}`, constants.COPYFILE_EXCL);
    const temporary = `${this.path}.tmp-${randomUUID()}`;
    let handle: FileHandle | undefined;
    let created = false;
    let failure: unknown;
    try {
      handle = await open(temporary, 'wx', 0o600);
      created = true;
      await handle.writeFile(content, 'utf8');
      await handle.close();
      handle = undefined;
      await rename(temporary, this.path);
      created = false;
      this.damaged = false;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      const cleanupErrors: unknown[] = [];
      if (handle) {
        try { await handle.close(); } catch (error) { cleanupErrors.push(error); }
      }
      if (created) {
        try { await unlink(temporary); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupErrors.push(error); }
      }
      if (cleanupErrors.length) {
        throw new AggregateError(failure === undefined ? cleanupErrors : [failure, ...cleanupErrors],
          `临时设置文件清理失败：${temporary}。请检查应用数据目录写权限后重试；原保存错误保留在错误详情中。`);
      }
    }
  }
}

function nodeVersion(nodePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(nodePath, ['--version'], { timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      if (error) reject(new Error(`Node 验证失败：${error.message}`));
      else if (!/^v\d+\.\d+\.\d+\s*$/.test(stdout)) reject(new Error('所选程序没有返回有效 Node 版本。'));
      else resolve();
    });
  });
}

/** All timing/log limits are explicit at the trusted boundary, never hidden backend defaults. */
export async function resolveOwnedSpec(settings: DesktopSettings): Promise<OwnedLaunchSpec> {
  for (const [label, path] of [['Node', settings.nodePath], ['dsh CLI', settings.launcherPath], ['Home', settings.homePath], ['工作目录', settings.cwd]]) {
    if (!isAbsolute(path)) throw new Error(`${label} 必须是绝对路径。`);
  }
  const nodePath = await realpath(settings.nodePath);
  const launcherPath = await realpath(settings.launcherPath);
  if (!(await stat(nodePath)).isFile() || !(await stat(launcherPath)).isFile()) throw new Error('Node 和 dsh CLI 必须指向文件。');
  await access(nodePath, constants.X_OK);
  await access(launcherPath, constants.R_OK);
  await nodeVersion(nodePath);
  await mkdir(settings.homePath, { recursive: true, mode: 0o700 });
  await mkdir(settings.cwd, { recursive: true, mode: 0o700 });
  return {
    nodePath, launcherPath, homePath: await realpath(settings.homePath), cwd: await realpath(settings.cwd),
    startupTimeoutMs: 45_000, healthTimeoutMs: 3_000, stopGraceMs: 7_000,
    forceExitTimeoutMs: 2_000, maxLogBytes: 64 * 1024,
  };
}
