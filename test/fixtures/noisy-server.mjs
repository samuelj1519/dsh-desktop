const drain = () => new Promise(resolve => process.stdout.write('x'.repeat(131072) + '\n', resolve));
await drain();await new Promise(resolve=>process.stderr.write('y'.repeat(131072)+'\n',resolve));
await import('./server.mjs');
