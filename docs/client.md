# Client Implementation

[English](client.md) | [简体中文](client.zh-CN.md)

## Backend state and limits

`BackendManager` and `src/contracts.ts` are authoritative for transport state. The settings page consumes an immutable projection and separately displays page errors, pending parameter checks, and incomplete exit. It does not create session or model-success state.

`src/config.ts` resolves owned-launch limits at the trusted boundary:

| Limit | Default |
| --- | --- |
| Startup deadline | 45 seconds |
| HTTP health deadline | 3 seconds |
| Graceful stop | 7 seconds |
| Forced-exit wait | 2 seconds |
| Retained backend diagnostics | 64 KiB |
| Node `--version` check | 3 seconds, 4 KiB output |

Paths must be absolute. The selected Node executable must be executable and the dsh CLI readable. Discovery reads PATH, common installation directories, and realpaths; it does not invoke dsh `--help`.

## Windows and IPC

`src/main.ts` creates two window types:

- **Local settings:** loads `ui/index.html` and a sandboxed CommonJS preload exposing `config`, `state`, `connect`, `stop`, `choose`, and state subscriptions. Each IPC handler checks the sender's webContents, main frame, and exact local file URL. Field, type, and length mismatches are rejected. Unknown configuration fields produce an error rather than being silently discarded.
- **dsh service:** loads the verified loopback URL directly, without a preload or Node bridge. Both window types enable sandboxing and context isolation and disable Node integration.

The settings page denies browser permissions and network requests. The service page permits only same-origin safe clipboard writes among browser permissions and preserves standard copy, cut, and paste menus. dsh tool authorization remains part of the service's same-origin UI.

Navigation and redirects in the service window must remain at the active HTTP loopback origin. New windows, external origins, file jumps, and webviews are blocked. The settings page permits only its own file URL. Same-origin fetch and WebSocket communicate directly with dsh; the client does not duplicate RPC implementations. Page rendering failures preserve connection facts and display a separate error.

## Persistence and repair

Successful connection parameters are saved as version 1 of `connection.json` under application `userData`. `DSH_DESKTOP_USER_DATA` sets both `userData` and `sessionData` before Electron is ready and requires an absolute path.

Damaged settings do not trigger automatic restore. Explicit repair happens only after a successful connection and preserves a timestamped copy of the damaged original. Owned Home, working directory, and persistent dsh service records are retained on exit. No model credentials are copied into client settings.

## Exit coordination

Quit and closing the last visible window await `dispose()`. In-flight parameter checks lose permission to launch when quitting begins. The client calls quit only after backend cleanup succeeds and pending checks finish.

If cleanup fails, the client retains the error and ownership and displays settings so exit can be retried. It does not report idle or launch a replacement backend to bypass cleanup. See [architecture](design.md) for process-group semantics and verification requirements.
