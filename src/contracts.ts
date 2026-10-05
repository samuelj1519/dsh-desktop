/** Backend connection status describes the transport, never an agent task result. */
export type ConnectionPhase = 'idle' | 'starting' | 'connected' | 'stopping' | 'error';
export type Ownership = 'owned' | 'external' | null;

/** Exit facts stay separate so a timed-out child exiting zero remains a timeout. */
export interface ExitFacts {
  readonly code: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly forced: boolean;
}

/** Immutable UI projection. Privileged process objects and credentials are not exposed. */
export interface ConnectionState {
  readonly phase: ConnectionPhase;
  readonly ownership: Ownership;
  readonly url: string | null;
  readonly error: string | null;
  readonly diagnostics: string;
  readonly lastExit: ExitFacts | null;
}

/** Explicit owned-runtime launch inputs resolved and validated by the trusted settings boundary. */
export interface OwnedLaunchSpec {
  readonly nodePath: string;
  readonly launcherPath: string;
  readonly homePath: string;
  readonly cwd: string;
  readonly startupTimeoutMs: number;
  readonly healthTimeoutMs: number;
  readonly stopGraceMs: number;
  readonly forceExitTimeoutMs: number;
  readonly maxLogBytes: number;
}

/** A thin native carrier uses this shared interface without copying dsh RPC implementations. */
export interface DesktopBackend {
  getState(): ConnectionState;
  subscribe(listener: (state: ConnectionState) => void): () => void;
  startOwned(spec: OwnedLaunchSpec): Promise<ConnectionState>;
  attach(endpoint: string, healthTimeoutMs: number): Promise<ConnectionState>;
  /**
   * Cancel any pending startup, detach external connections without signalling them, or stop owned resources.
   * Owned success requires child close and disappearance of its known process group. Incomplete cleanup
   * rejects and retains ownership/error rather than reporting idle. Repeated concurrent calls coalesce.
   */
  disconnect(): Promise<ConnectionState>;
  /**
   * Stop owned resources using the same completion/failure rules, silence subscriptions first, and seal
   * this controller against new launches. Concurrent/repeated disposal is idempotent, including startup.
   */
  dispose(): Promise<void>;
}
