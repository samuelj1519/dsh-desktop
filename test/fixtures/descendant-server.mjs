import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const marker=join(process.cwd(),'descendant-ready');
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",marker],{stdio:'inherit'});
writeFileSync(join(process.cwd(),'descendant.pid'),String(child.pid));
await new Promise(resolve=>{const poll=setInterval(()=>{if(!existsSync(marker))return;clearInterval(poll);resolve();},15);});
await import('./server.mjs');
