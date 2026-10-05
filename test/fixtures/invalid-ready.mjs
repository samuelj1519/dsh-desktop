process.stdout.write('dsh web: http://example.com:3080\n');
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
