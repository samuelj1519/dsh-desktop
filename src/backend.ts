import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isAbsolute } from 'node:path';
import type { ConnectionState, DesktopBackend, ExitFacts, OwnedLaunchSpec } from './contracts.js';

/** Only explicit loopback HTTP service roots are accepted; no credentials, redirects or query strings. */
export function validateLocalEndpoint(endpoint: string): string {
  if (typeof endpoint !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?\/?$/.test(endpoint)) {
    throw new Error('Use a local HTTP service root, such as http://127.0.0.1:3080, without credentials or query strings.');
  }
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new Error('Select a valid loopback HTTP address with a port between 1 and 65535.'); }
  if (url.port === '0') throw new Error('The service must have an actual nonzero port.');
  return url.href;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

interface Operation {
  controller: AbortController;
  finished: Deferred<void>;
  cancelled: boolean;
}

interface OwnedResource {
  child: ChildProcess;
  pid: number | undefined;
  spec: OwnedLaunchSpec;
  operation: Operation;
  ready: Deferred<string>;
  exited: boolean;
  closed: boolean;
  facts: { code: number | null; signal: string | null; timedOut: boolean; forced: boolean };
  stop: Promise<void> | null;
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const abortReason = (signal: AbortSignal): Error => signal.reason instanceof Error ? signal.reason : new Error('Connection cancelled.');
class DeadlineError extends Error {}

const loopbackLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) { callback(error, []); return; }
    const local = addresses.filter(address => address.address === '127.0.0.1' || address.address === '::1');
    if (!local.length) { callback(new Error('The local service hostname did not resolve to loopback.'), []); return; }
    if (options.all) callback(null, local);
    else callback(null, local[0]!.address, local[0]!.family);
  });
};

/** GET readiness never follows redirects, and cancellation/deadlines destroy the local request and socket. */
function checkHealth(endpoint: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortReason(signal)); return; }
    let settled = false;
    const request = http.get(endpoint, { agent: false, lookup: loopbackLookup }, response => {
      const status = response.statusCode ?? 0;
      response.resume();
      if (status < 200 || status >= 300) finish(new Error(`Local service returned HTTP ${status}. Check the selected dsh service and retry.`));
      else finish();
      response.destroy();
    });
    const timer = setTimeout(() => finish(new DeadlineError(`Local service health check timed out after ${timeoutMs} ms. Check the service and retry.`)), timeoutMs);
    const onAbort = () => finish(abortReason(signal));
    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      request.destroy();
      if (error) reject(error); else resolve();
    }
    request.on('error', error => finish(new Error(`Cannot reach the local dsh service: ${error.message}`)));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function validateTimeout(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error(`${name} must be a positive timeout in milliseconds.`);
}

function validateLaunch(spec: OwnedLaunchSpec): void {
  for (const name of ['nodePath', 'launcherPath', 'homePath', 'cwd'] as const) {
    if (typeof spec[name] !== 'string' || !isAbsolute(spec[name]) || spec[name].includes('\0')) throw new Error(`Select an absolute ${name} path before starting dsh.`);
  }
  for (const name of ['startupTimeoutMs', 'healthTimeoutMs', 'stopGraceMs', 'forceExitTimeoutMs'] as const) validateTimeout(spec[name], name);
  if (!Number.isSafeInteger(spec.maxLogBytes) || spec.maxLogBytes <= 0) throw new Error('maxLogBytes must be a positive byte limit.');
}

/**
 * Owns only children it spawned. dsh loads credentials/model settings from the explicitly selected
 * DSH_HOME and inherited environment; this controller never opens, copies or exposes credential files.
 * POSIX detached children have a recorded process group. Cleanup succeeds only after child close and
 * group disappearance, including descendants holding pipes. Escaped groups cannot be inferred or killed.
 * Windows uses taskkill /T on a recorded, still-live child PID; native Windows behavior needs host testing.
 */
export class BackendManager implements DesktopBackend {
  private state: ConnectionState = Object.freeze({ phase: 'idle', ownership: null, url: null, error: null, diagnostics: '', lastExit: null });
  private readonly listeners = new Set<(state: ConnectionState) => void>();
  private owned: OwnedResource | null = null;
  private operation: Operation | null = null;
  private disconnecting: Promise<ConnectionState> | null = null;
  private disposing: Promise<void> | null = null;
  private sealed = false;
  private logs = Buffer.alloc(0);
  private logLimit = 16_384;

  getState(): ConnectionState { return this.state; }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    if (this.sealed) return () => {};
    this.listeners.add(listener);
    this.deliver(listener);
    return () => { this.listeners.delete(listener); };
  }

  private deliver(listener: (state: ConnectionState) => void, state = this.state): void {
    try { listener(state); } catch { /* A presentation callback cannot disrupt transport ownership. */ }
  }

  private update(patch: Partial<ConnectionState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    const state = this.state;
    for (const listener of this.listeners) this.deliver(listener, state);
  }

  private begin(): Operation {
    if (this.sealed) throw new Error('This backend controller is disposed. Open a new controller to connect.');
    if (this.operation || this.owned || this.disconnecting || !['idle', 'error'].includes(this.state.phase)) throw new Error('Disconnect the current service before starting another connection.');
    const op: Operation = { controller: new AbortController(), finished: deferred<void>(), cancelled: false };
    this.operation = op;
    this.logs = Buffer.alloc(0);
    return op;
  }

  private finishOperation(op: Operation): void {
    if (this.operation === op) this.operation = null;
    op.finished.resolve();
  }

  private eligible(op: Operation): boolean {
    return this.operation === op && !op.controller.signal.aborted && !this.sealed && this.state.phase === 'starting';
  }

  private appendLog(text: string): void {
    this.logs = Buffer.concat([this.logs, Buffer.from(text)]);
    if (this.logs.length > this.logLimit) {
      let start = this.logs.length - this.logLimit;
      while (start < this.logs.length && (this.logs[start]! & 0xc0) === 0x80) start++;
      this.logs = this.logs.subarray(start);
    }
    this.update({ diagnostics: this.logs.toString('utf8') });
  }

  private exitSnapshot(resource: OwnedResource): ExitFacts { return Object.freeze({ ...resource.facts }); }

  async startOwned(input: OwnedLaunchSpec): Promise<ConnectionState> {
    validateLaunch(input);
    const spec = Object.freeze({ ...input });
    const op = this.begin();
    this.logLimit = Math.min(spec.maxLogBytes, 1_048_576);
    let resource: OwnedResource | undefined;
    let deadline: NodeJS.Timeout | undefined;
    try {
      const child = spawn(spec.nodePath, [spec.launcherPath, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
        cwd: spec.cwd,
        env: { ...process.env, DSH_HOME: spec.homePath, DSH_TELEMETRY_DISABLED: '1' },
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      resource = { child, pid: child.pid, spec, operation: op, ready: deferred<string>(), exited: false, closed: false, facts: { code: null, signal: null, timedOut: false, forced: false }, stop: null };
      this.owned = resource;
      const current = resource;
      void current.ready.promise.catch(() => {});
      op.controller.signal.addEventListener('abort', () => current.ready.reject(abortReason(op.controller.signal)), { once: true });
      let line = '';
      let oversized = false;
      child.stdout!.setEncoding('utf8');
      child.stderr!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        this.appendLog(chunk);
        for (const part of chunk.split(/(?<=\n)/)) {
          const complete = part.endsWith('\n');
          if (!oversized && line.length + part.length <= 8192) line += part;
          else { oversized = true; line = ''; }
          if (!complete) continue;
          if (!oversized && this.eligible(op) && line.startsWith('dsh web: ')) {
            try {
              const raw = line.replace(/\r?\n$/, '').slice('dsh web: '.length);
              if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[1-9][0-9]{0,4}\/?$/.test(raw)) throw new Error('dsh did not announce an explicit loopback HTTP port. Check the selected runtime configuration.');
              current.ready.resolve(validateLocalEndpoint(raw));
            } catch (error) { op.controller.abort(new Error(message(error))); }
          }
          line = ''; oversized = false;
        }
      });
      child.stderr!.on('data', (chunk: string) => this.appendLog(chunk));
      child.stdout!.on('error', error => op.controller.abort(new Error(`Cannot read dsh stdout: ${error.message}`)));
      child.stderr!.on('error', error => op.controller.abort(new Error(`Cannot read dsh stderr: ${error.message}`)));
      child.once('error', error => op.controller.abort(new Error(`Cannot launch dsh with the selected Node, CLI and working directory: ${error.message}`)));
      child.once('exit', (code, signal) => {
        current.exited = true;
        current.facts.code = code; current.facts.signal = signal;
        this.observeExit(current);
      });
      child.once('close', (code, signal) => {
        current.closed = true;
        current.facts.code = code; current.facts.signal = signal;
        this.observeExit(current);
      });
      deadline = setTimeout(() => {
        current.facts.timedOut = true;
        op.controller.abort(new Error(`dsh startup timed out after ${spec.startupTimeoutMs} ms. Check the selected runtime and configuration, then retry.`));
      }, spec.startupTimeoutMs);
      this.update({ phase: 'starting', ownership: 'owned', url: null, error: null, diagnostics: '', lastExit: null });
      const endpoint = await current.ready.promise;
      await checkHealth(endpoint, spec.healthTimeoutMs, op.controller.signal);
      if (!this.eligible(op) || current.exited || current.closed) throw abortReason(op.controller.signal);
      clearTimeout(deadline);
      this.update({ phase: 'connected', url: endpoint, error: null });
      return this.state;
    } catch (error) {
      let failure = new Error(message(error));
      if (deadline) clearTimeout(deadline);
      if (resource) {
        if (error instanceof DeadlineError) resource.facts.timedOut = true;
        try { await this.stopOwned(resource); }
        catch (cleanupError) { failure = new Error(`${failure.message} Cleanup incomplete: ${message(cleanupError)}`); }
      }
      if (!op.cancelled || this.owned) this.update({ phase: 'error', ownership: this.owned ? 'owned' : null, url: null, error: failure.message });
      throw failure;
    } finally {
      if (deadline) clearTimeout(deadline);
      this.finishOperation(op);
    }
  }

  private observeExit(resource: OwnedResource): void {
    if (this.owned !== resource) return;
    const error = new Error(`dsh exited (code ${resource.facts.code ?? 'none'}, signal ${resource.facts.signal ?? 'none'}). Check the runtime diagnostics and retry.`);
    if (this.operation === resource.operation) resource.operation.controller.abort(error);
    if (this.state.phase === 'connected') {
      this.update({ phase: 'error', url: null, error: error.message, lastExit: this.exitSnapshot(resource) });
      void this.stopOwned(resource).then(() => {
        if (!this.owned && !this.operation && this.state.phase === 'error') this.update({ ownership: null });
      }, reason => this.update({ error: `${error.message} Cleanup incomplete: ${message(reason)}` }));
    } else this.update({ lastExit: this.exitSnapshot(resource) });
  }

  async attach(endpoint: string, healthTimeoutMs: number): Promise<ConnectionState> {
    const url = validateLocalEndpoint(endpoint);
    validateTimeout(healthTimeoutMs, 'healthTimeoutMs');
    const op = this.begin();
    this.logLimit = 16_384;
    this.update({ phase: 'starting', ownership: 'external', url: null, error: null, diagnostics: '', lastExit: null });
    try {
      await checkHealth(url, healthTimeoutMs, op.controller.signal);
      if (!this.eligible(op)) throw abortReason(op.controller.signal);
      this.update({ phase: 'connected', url });
      return this.state;
    } catch (error) {
      if (!op.cancelled) this.update({ phase: 'error', ownership: null, url: null, error: message(error) });
      throw error;
    } finally { this.finishOperation(op); }
  }

  /** On POSIX, PID is the group leader captured from our detached spawn, never from a URL or name. */
  private groupAlive(resource: OwnedResource): boolean {
    if (resource.pid === undefined) return false;
    if (process.platform === 'win32') return !resource.exited && !resource.closed;
    try { process.kill(-resource.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw new Error(`Cannot confirm owned process group ${resource.pid} has stopped: ${message(error)}`);
    }
  }

  private async signalOwned(resource: OwnedResource, force: boolean): Promise<void> {
    const pid = resource.pid;
    if (pid === undefined || !this.groupAlive(resource)) return;
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('Refusing an invalid owned process identity.');
    if (force) { resource.facts.forced = true; this.update({ lastExit: this.exitSnapshot(resource) }); }
    if (process.platform !== 'win32') {
      try { process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const taskkill = spawn('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let detail = '';
      for (const stream of [taskkill.stdout!, taskkill.stderr!]) stream.on('data', chunk => { detail = (detail + String(chunk)).slice(-4096); });
      const timer = setTimeout(() => { taskkill.kill(); reject(new Error('Owned Windows process-tree stop timed out. Retry stopping this controller.')); }, resource.spec.forceExitTimeoutMs);
      taskkill.once('error', error => { clearTimeout(timer); reject(error); });
      taskkill.once('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Cannot stop owned Windows process tree (${code}): ${detail}`));
      });
    });
  }

  private async awaitStopped(resource: OwnedResource, timeoutMs: number): Promise<boolean> {
    const end = performance.now() + timeoutMs;
    do {
      if (resource.closed && !this.groupAlive(resource)) return true;
      await pause(Math.min(15, Math.max(1, end - performance.now())));
    } while (performance.now() < end);
    return resource.closed && !this.groupAlive(resource);
  }

  private stopOwned(resource: OwnedResource): Promise<void> {
    if (resource.stop) return resource.stop;
    const stop = (async () => {
      try { await this.signalOwned(resource, false); }
      catch (error) { this.appendLog(`Owned graceful stop failed: ${message(error)}\n`); }
      if (!await this.awaitStopped(resource, resource.spec.stopGraceMs)) {
        await this.signalOwned(resource, true);
        if (!await this.awaitStopped(resource, resource.spec.forceExitTimeoutMs)) throw new Error('Owned child close or process-group disappearance could not be confirmed. Resources remain owned; retry Stop.');
      }
      this.update({ lastExit: this.exitSnapshot(resource) });
      if (this.owned === resource) this.owned = null;
    })();
    resource.stop = stop;
    void stop.finally(() => { if (resource.stop === stop) resource.stop = null; }).catch(() => {});
    return stop;
  }

  disconnect(): Promise<ConnectionState> {
    if (this.disconnecting) return this.disconnecting;
    const pending = deferred<ConnectionState>();
    const stopping = pending.promise;
    this.disconnecting = stopping;
    const op = this.operation;
    if (op) { op.cancelled = true; op.controller.abort(new Error('Connection cancelled by Stop.')); }
    const resource = this.owned;
    this.update({ phase: resource ? 'stopping' : 'idle', url: null, ownership: resource ? 'owned' : null, error: null });
    void (async () => {
      try {
        if (resource) await this.stopOwned(resource);
        if (op) await op.finished.promise;
        this.update({ phase: 'idle', ownership: null, url: null, error: null });
        return this.state;
      } catch (error) {
        if (op) await op.finished.promise;
        this.update({ phase: 'error', ownership: this.owned ? 'owned' : null, url: null, error: `Cannot stop the owned dsh runtime: ${message(error)}` });
        throw error;
      }
    })().then(pending.resolve, pending.reject);
    void stopping.finally(() => { if (this.disconnecting === stopping) this.disconnecting = null; }).catch(() => {});
    return stopping;
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.sealed = true;
    this.listeners.clear();
    const disposal = this.disconnect().then(() => {});
    this.disposing = disposal;
    void disposal.catch(() => { if (this.disposing === disposal) this.disposing = null; });
    return disposal;
  }
}
