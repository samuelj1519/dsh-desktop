process.on('SIGTERM', () => {});
await import('./server.mjs');
process.removeAllListeners('SIGTERM');
process.on('SIGTERM', () => {});
