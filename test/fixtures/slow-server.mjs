import { writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.cwd(), 'pid'), String(process.pid));
appendFileSync(join(process.cwd(), 'starts'), `${process.pid}\n`);
process.on('SIGTERM', () => process.exit(0));
const poll = setInterval(async () => { if (!existsSync(join(process.cwd(), 'release-ready'))) return; clearInterval(poll); await import('./server.mjs'); }, 20);
