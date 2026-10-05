# Architecture

[English](design.md) | [简体中文](design.zh-CN.md)

## Scope and modules

The client is an independent Electron shell around a selected local dsh service's Web UI. It does not reproduce dsh RPC, model execution, sessions, or tool authorization. The dsh runtime is installed separately; select its Node executable, JavaScript CLI, Home, and working directory explicitly.

| Module | Responsibility |
| --- | --- |
| `src/contracts.ts` | Shared backend interface and immutable connection projection. |
| `src/backend.ts` | Readiness, connection state, process ownership, diagnostics, and cleanup. |
| `src/config.ts` | Strict settings validation, discovery, launch inputs, and persistence. |
| `src/main.ts` | Windows, trusted IPC, navigation rules, menus, and quit coordination. |
| `src/preload.cts` | Narrow CommonJS bridge for the local settings page. |
| `src/renderer.ts`, `ui/` | Connection forms, transport status, errors, and retry actions. |

## Connection state and ownership

`BackendManager` implements `DesktopBackend`. Consumers call `startOwned`, `attach`, `disconnect`, and `dispose`, and subscribe to immutable state. Phases are `idle`, `starting`, `connected`, `stopping`, and `error`; ownership is `owned`, `external`, or `null`. Connection state describes transport availability, never model or task success.

Owned launches use the selected executable and CLI:

```text
node /absolute/path/to/launcher.js web --host 127.0.0.1 --port 0 --no-open
```

Startup requires a complete `dsh web: http://127.0.0.1:<port>` readiness line with a nonzero port, followed by a successful HTTP GET to the service root. Invalid readiness addresses, HTTP errors, timeouts, and cancellation fail startup. Both output streams are continuously drained while retained diagnostics are bounded. Exit code, signal, timeout, and forced termination are separate facts; a timed-out process exiting zero remains a failed startup.

Cancellation revokes the current operation before signaling its process, blocks late readiness and health updates, and waits for child stream closure. Concurrent disconnects and disposal coalesce. Disposal closes subscriptions and seals the manager against subsequent launches. Listener failures cannot break startup or cleanup.

## Shutdown

On POSIX, owned children launch in a separate process group. Cleanup sends TERM to the recorded group, escalates to KILL after the grace period, and confirms child closure and group disappearance within the configured deadline. Processes that escape the recorded group are outside this guarantee. On Windows, cleanup uses `taskkill /T` for a registered live owned PID and waits for closure or an explicit failure.

External attachments disconnect without signaling the service. Ownership is never inferred from a port or URL. Closing the last visible window or choosing Quit awaits cleanup. Failed cleanup retains ownership, an error, and a window offering retry; it cannot be reported as idle or bypassed by launching another backend. Persistent Homes, workspaces, and sessions survive exit.

## Trust boundaries

All windows use `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. The dsh window has no preload and no Node bridge. It loads only the selected loopback HTTP origin; external navigation, file navigation, new windows, and webviews are rejected. Same-origin fetch, WebSocket, and dsh tool permission prompts remain owned by the service.

The local settings window loads only application files. Its narrow bridge exposes settings, state, connect, stop, path selection, and subscription operations. Main-process handlers verify the exact window, main frame, file URL, and allowed payload fields. Unknown fields and malformed values are rejected. The settings page denies browser permissions and network requests; the dsh page allows only same-origin safe clipboard writes among browser permissions.

Explicit endpoints accept HTTP roots on `localhost`, `127.0.0.1`, or `[::1]`. Remote hosts, embedded credentials, query strings, and redirects are rejected. A non-loopback readiness address stops the owned backend and reports an error without changing global dsh patches.

## Configuration and interface

Successful connection parameters persist in the client's application data directory. Credentials are resolved by dsh from its selected Home and environment; the client does not copy them. Discovery reads PATH, known installation paths, and realpaths. It does not run dsh help commands that may write configuration.

The settings window offers existing-service and client-launch tabs, editable address/path fields, path pickers, connection actions, errors, and bounded diagnostics. The service window hosts dsh's UI directly. Keyboard access and visible focus states are required. The UI uses system fonts, a light background (`#f7f9fc`), dark text (`#1f2a44`), blue accents (`#4d6bfe`), and warning text (`#b54708`). Page failure is displayed separately from transport state.

## Verification boundaries

Fixture tests cover endpoint rejection, readiness and health checks, exit facts, output draining, cancellation, descendant cleanup, preservation of external services, repeated actions, and listener isolation. Linux/macOS fixture tests and Windows compilation in CI are distinct from packaged application and native Windows cleanup verification.

For runtime integration, use an isolated dsh Home and check launch, readiness, HTTP access, stop, port release, and reopen. Native checks must exercise the actual Electron application, window controls, and quit/reopen behavior. Model, tool, permission, and request-cancellation checks require a configured real service and actual results. Record omitted checks explicitly; fixture success does not substitute for them. Signing, notarization, automatic updates, and global installation are outside the current implementation.
