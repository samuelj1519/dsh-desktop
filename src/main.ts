import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BackendManager, validateLocalEndpoint } from './backend.js';
import {
  ConfigStore, defaultSettings, exactObject, resolveOwnedSpec, validateSettings,
  type DesktopSettings, type DesktopViewState, type PathField, type SettingsSnapshot,
} from './config.js';

const base = dirname(fileURLToPath(import.meta.url));
const localPath = join(base, '..', 'ui', 'index.html');
const localURL = pathToFileURL(localPath).href;
const manager = new BackendManager();
let localWindow: BrowserWindow | null = null;
let remoteWindow: BrowserWindow | null = null;
let store: ConfigStore;
let snapshot: SettingsSnapshot;
let actionError: string | null = null;
let operation: Promise<void> | null = null;
let generation = 0;
let lifecycle: DesktopViewState['lifecycle'] = 'active';
let quitAllowed = false;
let quitOperation: Promise<void> | null = null;
let bootstrapError: unknown = null;

try {
  const override = process.env.DSH_DESKTOP_USER_DATA;
  if (override !== undefined) {
    if (!isAbsolute(override)) throw new Error('DSH_DESKTOP_USER_DATA 必须是绝对路径。');
    mkdirSync(override, { recursive: true, mode: 0o700 });
    app.setPath('userData', override);
    app.setPath('sessionData', override);
  }
} catch (error) { bootstrapError = error; }

function viewState(): DesktopViewState {
  return { connection: manager.getState(), actionError, actionPending: operation !== null, lifecycle };
}

function publish(): void {
  if (localWindow && !localWindow.isDestroyed()) localWindow.webContents.send('dsh:state-update', viewState());
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function trustedSender(event: IpcMainInvokeEvent): void {
  if (!localWindow || localWindow.isDestroyed() || event.sender !== localWindow.webContents ||
      event.senderFrame !== localWindow.webContents.mainFrame || event.senderFrame.url !== localURL) {
    throw new Error('拒绝来自非设置页面的请求。');
  }
}

function noPayload(payload: unknown): void {
  if (payload !== undefined) throw new Error('此操作不接受参数。');
}

function protectWindow(window: BrowserWindow, permitted: (url: string) => boolean): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!permitted(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!permitted(url)) event.preventDefault(); });
  window.webContents.on('will-frame-navigate', event => { if (!permitted(event.url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => {
    if (quitAllowed) return;
    const others = BrowserWindow.getAllWindows().filter(other => other !== window && other.isVisible() && !other.isDestroyed());
    if (others.length === 0) {
      event.preventDefault();
      void requestQuit();
    }
  });
}

function showSettings(): void {
  if (!localWindow || localWindow.isDestroyed()) createSettingsWindow();
  localWindow!.show();
  localWindow!.focus();
  publish();
}

function createSettingsWindow(): void {
  const window = new BrowserWindow({
    width: 640, height: 650, minWidth: 420, minHeight: 460, title: '连接 dsh', backgroundColor: '#f7f9fc',
    webPreferences: { preload: join(base, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:dsh-settings' },
  });
  localWindow = window;
  protectWindow(window, url => url === localURL);
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('closed', () => { if (localWindow === window) localWindow = null; });
  void window.loadFile(localPath).catch(error => dialog.showErrorBox('设置页面无法打开', message(error)));
}

async function showRemote(url: string): Promise<void> {
  const endpoint = validateLocalEndpoint(url);
  const origin = new URL(endpoint).origin;
  if (remoteWindow && !remoteWindow.isDestroyed()) {
    const old = remoteWindow;
    remoteWindow = null;
    old.destroy();
  }
  const window = new BrowserWindow({
    width: 1180, height: 820, minWidth: 640, minHeight: 480, title: 'dsh', show: false, backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:dsh-web' },
  });
  remoteWindow = window;
  protectWindow(window, target => {
    try { return new URL(target).origin === origin; } catch { return false; }
  });
  const session = window.webContents.session;
  session.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    contents === window.webContents && requestingOrigin === origin && permission === 'clipboard-sanitized-write');
  session.setPermissionRequestHandler((contents, permission, callback) => {
    let sameOrigin = false;
    try { sameOrigin = new URL(contents.getURL()).origin === origin; } catch { /* Not an origin-bearing page. */ }
    callback(contents === window.webContents && sameOrigin && permission === 'clipboard-sanitized-write');
  });
  window.on('closed', () => { if (remoteWindow === window) remoteWindow = null; });
  window.webContents.on('render-process-gone', (_event, details) => {
    actionError = `dsh 页面已停止（${details.reason}）。请重新连接。`;
    showSettings();
  });
  try {
    await window.loadURL(endpoint);
    if (!window.isDestroyed() && lifecycle === 'active' && manager.getState().phase === 'connected') {
      window.show();
      window.focus();
      localWindow?.hide();
    }
  } catch (error) {
    if (window.isDestroyed() || lifecycle !== 'active') return;
    actionError = `服务已连接，但 dsh 页面无法打开：${message(error)}。请检查地址后重试。`;
    showSettings();
  }
}

async function connect(settings: DesktopSettings, repairConfig: boolean): Promise<void> {
  if (lifecycle !== 'active') throw new Error('应用正在退出或退出未完成，请先重试退出。');
  if (operation) throw new Error('已有连接操作正在进行，请等待或取消。');
  if (snapshot.configError && !repairConfig) throw new Error('连接设置损坏；请使用「修复设置并连接」。');
  const token = ++generation;
  actionError = null;
  const run = async (): Promise<void> => {
    const endpoint = settings.mode === 'external' ? validateLocalEndpoint(settings.endpoint) : null;
    const spec = settings.mode === 'owned' ? await resolveOwnedSpec(settings) : null;
    if (token !== generation || lifecycle !== 'active') return;
    if (manager.getState().phase !== 'idle') await manager.disconnect();
    if (token !== generation || lifecycle !== 'active') return;
    const state = spec ? await manager.startOwned(spec) : await manager.attach(endpoint!, 3_000);
    if (token !== generation || lifecycle !== 'active') return;
    if (state.phase !== 'connected' || !state.url) throw new Error(state.error ?? '服务未达到可连接状态。');
    await store.save(settings, repairConfig);
    snapshot = { settings: { ...settings }, saved: true, configError: null };
    if (token !== generation || lifecycle !== 'active') return;
    await showRemote(state.url);
  };
  operation = run();
  publish();
  try { await operation; }
  catch (error) {
    if (token !== generation || lifecycle !== 'active') return;
    actionError = message(error);
    showSettings();
    throw error;
  } finally { operation = null; publish(); }
}

async function stop(): Promise<void> {
  if (lifecycle === 'exit-failed') { await requestQuit(); return; }
  if (lifecycle !== 'active') return;
  ++generation;
  actionError = null;
  if (remoteWindow && !remoteWindow.isDestroyed()) remoteWindow.destroy();
  remoteWindow = null;
  try {
    await manager.disconnect();
    await operation?.catch(() => {});
  } catch (error) { actionError = message(error); throw error; }
  finally { showSettings(); }
}

/** before-quit and the last visible window use the same awaited ownership cleanup. */
function requestQuit(): Promise<void> {
  if (quitOperation) return quitOperation;
  ++generation;
  lifecycle = 'exiting';
  if (remoteWindow && !remoteWindow.isDestroyed()) remoteWindow.destroy();
  remoteWindow = null;
  if (snapshot) showSettings();
  publish();
  quitOperation = (async () => {
    try {
      await manager.dispose();
      await operation?.catch(() => {});
      quitAllowed = true;
      app.quit();
    } catch (error) {
      lifecycle = 'exit-failed';
      actionError = `退出未完成：${message(error)}。应用仍保留后端所有权，请点击「重试退出」。`;
      showSettings();
    } finally { quitOperation = null; publish(); }
  })();
  return quitOperation;
}

function installIPC(): void {
  ipcMain.handle('dsh:config', (event, payload: unknown) => { trustedSender(event); noPayload(payload); return snapshot; });
  ipcMain.handle('dsh:state', (event, payload: unknown) => { trustedSender(event); noPayload(payload); return viewState(); });
  ipcMain.handle('dsh:connect', async (event, payload: unknown) => {
    trustedSender(event);
    const value = exactObject(payload, ['settings', 'repairConfig']);
    if (typeof value.repairConfig !== 'boolean') throw new Error('repairConfig 必须是布尔值。');
    await connect(validateSettings(value.settings), value.repairConfig);
  });
  ipcMain.handle('dsh:stop', async (event, payload: unknown) => { trustedSender(event); noPayload(payload); await stop(); });
  ipcMain.handle('dsh:choose', async (event, payload: unknown) => {
    trustedSender(event);
    const value = exactObject(payload, ['field']);
    if (!['nodePath', 'launcherPath', 'homePath', 'cwd'].includes(value.field as string)) throw new Error('未知路径字段。');
    const field = value.field as PathField;
    const result = await dialog.showOpenDialog(localWindow!, {
      title: field === 'nodePath' ? '选择 Node 程序' : field === 'launcherPath' ? '选择 dsh CLI JavaScript 文件' : field === 'homePath' ? '选择 dsh Home' : '选择工作目录',
      properties: [field === 'nodePath' || field === 'launcherPath' ? 'openFile' : 'openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}

function installMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'dsh', submenu: [
      { label: '连接设置…', accelerator: 'CmdOrCtrl+,', click: showSettings },
      { label: '重新连接', accelerator: 'CmdOrCtrl+R', click: () => { showSettings(); void connect(snapshot.settings, false).catch(() => {}); } },
      { label: '停止客户端后端 / 断开现有服务', click: () => { void stop().catch(() => {}); } },
      { type: 'separator' }, { label: '退出 dsh', accelerator: 'CmdOrCtrl+Q', click: () => { void requestQuit(); } },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]));
}

app.on('before-quit', event => { if (!quitAllowed) { event.preventDefault(); void requestQuit(); } });
app.on('window-all-closed', () => { if (!quitAllowed) void requestQuit(); });
app.on('activate', () => { if (snapshot && lifecycle !== 'exiting' && !remoteWindow?.isVisible()) showSettings(); });

void app.whenReady().then(async () => {
  if (bootstrapError) throw bootstrapError;
  store = new ConfigStore(app.getPath('userData'));
  snapshot = await store.load(await defaultSettings(app.getPath('userData')));
  installIPC();
  manager.subscribe(state => {
    publish();
    if (state.phase === 'error' && lifecycle === 'active') showSettings();
  });
  installMenu();
  createSettingsWindow();
  if (snapshot.saved && !snapshot.configError) void connect(snapshot.settings, false).catch(() => {});
}).catch(error => {
  dialog.showErrorBox('dsh 客户端无法启动', message(error));
  quitAllowed = true;
  app.exit(1);
});
