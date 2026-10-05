import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.cwd(), 'pid'), String(process.pid));
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
