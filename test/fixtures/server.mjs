import http from 'node:http';
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
if(!existsSync(join(process.cwd(),'pid')) || readFileSync(join(process.cwd(),'pid'),'utf8')!==String(process.pid)){writeFileSync(join(process.cwd(),'pid'),String(process.pid));appendFileSync(join(process.cwd(),'starts'),`${process.pid}\n`);}
const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>dsh fixture</title>'); });
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  writeFileSync(join(process.cwd(), 'url'), `http://127.0.0.1:${port}`);
  process.stdout.write(`dsh web: http://127.0.0.1:${port}\n`);
});
process.on('SIGTERM', () => {writeFileSync(join(process.cwd(),'parent-term'),'observed');server.close(()=>{writeFileSync(join(process.cwd(),'parent-exit'),'after close');process.exit(0);});});
