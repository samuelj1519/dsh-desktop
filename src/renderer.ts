import type { DesktopSettings, DesktopViewState, PathField, SettingsSnapshot } from './config.js';
import type { DesktopBridge } from './config.js';

declare global { interface Window { dshDesktop: DesktopBridge; } }

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`缺少界面元素：${id}`);
  return result as T;
}

const bridge = window.dshDesktop;
const form = element<HTMLFormElement>('connection-form');
const connectButton = element<HTMLButtonElement>('connect');
const stopButton = element<HTMLButtonElement>('stop');
const tabs = [element<HTMLButtonElement>('external-tab'), element<HTMLButtonElement>('owned-tab')];
let mode: DesktopSettings['mode'] = 'external';
let configError: string | null = null;
let current: DesktopViewState | null = null;
let localError: string | null = null;

function selectMode(next: DesktopSettings['mode']): void {
  mode = next;
  tabs.forEach((tab, index) => {
    const selected = (index === 0 ? 'external' : 'owned') === mode;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  element('external-panel').hidden = mode !== 'external';
  element('owned-panel').hidden = mode !== 'owned';
  render();
}

function displayError(id: string, text: string | null): void {
  const target = element(id);
  target.textContent = text;
  target.hidden = !text;
}

function readSettings(): DesktopSettings {
  const value = (id: string) => element<HTMLInputElement>(id).value;
  return { mode, endpoint: value('endpoint').trim(), nodePath: value('nodePath'), launcherPath: value('launcherPath'), homePath: value('homePath'), cwd: value('cwd') };
}

function populate(snapshot: SettingsSnapshot): void {
  for (const key of ['endpoint', 'nodePath', 'launcherPath', 'homePath', 'cwd'] as const) {
    element<HTMLInputElement>(key).value = snapshot.settings[key];
  }
  configError = snapshot.configError;
  selectMode(snapshot.settings.mode);
}

function render(): void {
  displayError('config-error', configError);
  if (!current) return;
  const { connection: state, lifecycle, actionPending } = current;
  const busy = actionPending || state.phase === 'starting' || state.phase === 'stopping' || lifecycle !== 'active';
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button[data-choose]').forEach(input => { input.disabled = busy; });
  tabs.forEach(tab => { tab.disabled = busy; });
  connectButton.disabled = busy;
  connectButton.textContent = configError ? '修复设置并连接' : state.phase === 'error' ? '重试' : mode === 'owned' ? '启动并连接' : '连接';
  stopButton.hidden = state.phase === 'idle' && !actionPending && lifecycle === 'active';
  stopButton.disabled = lifecycle === 'exiting' || state.phase === 'stopping';
  stopButton.textContent = lifecycle === 'exit-failed' ? '重试退出' : state.phase === 'starting' || actionPending ? '取消' : state.ownership === 'owned' ? '停止后端' : '断开连接';
  const status = lifecycle === 'exiting' ? '正在等待后端停止后退出…' : lifecycle === 'exit-failed' ? '退出未完成' :
    state.phase === 'starting' ? '正在启动后端并检查服务…' : state.phase === 'stopping' ? '正在停止后端…' :
    actionPending && state.phase !== 'connected' ? '正在检查连接参数…' : state.phase === 'connected' ?
    (state.ownership === 'owned' ? '已连接客户端启动的后端' : '已连接现有服务') : state.phase === 'error' ? '连接失败' : '尚未连接';
  element('status').textContent = status;
  const url = element('connected-url');
  url.textContent = state.url;
  url.hidden = !state.url;
  displayError('action-error', localError ?? current.actionError ?? state.error);
  element('diagnostics').textContent = state.diagnostics;
  element('diagnostic-details').hidden = !state.diagnostics;
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectMode(index === 0 ? 'external' : 'owned'));
  tab.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectMode(mode === 'external' ? 'owned' : 'external');
      tabs[mode === 'external' ? 0 : 1].focus();
    }
  });
});

form.addEventListener('submit', event => {
  event.preventDefault();
  localError = null;
  void bridge.connect({ settings: readSettings(), repairConfig: configError !== null }).then(async () => {
    configError = (await bridge.config()).configError;
  }).catch(error => { localError = String(error); }).finally(() => render());
});

stopButton.addEventListener('click', () => {
  localError = null;
  void bridge.stop().catch(error => { localError = String(error); }).finally(() => render());
});

document.querySelectorAll<HTMLButtonElement>('button[data-choose]').forEach(button => {
  button.addEventListener('click', () => {
    const field = button.dataset.choose as PathField;
    void bridge.choose({ field }).then(path => { if (path) element<HTMLInputElement>(field).value = path; })
      .catch(error => { localError = String(error); render(); });
  });
});

const unsubscribe = bridge.subscribe(state => { current = state; render(); });
window.addEventListener('beforeunload', unsubscribe);
void Promise.all([bridge.config(), bridge.state()]).then(([snapshot, state]) => {
  current = state;
  populate(snapshot);
}).catch(error => {
  element('status').textContent = '连接设置无法加载';
  displayError('action-error', String(error));
});
