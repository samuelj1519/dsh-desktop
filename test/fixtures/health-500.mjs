import http from 'node:http';
import { writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
const name=basename(process.argv[1]);
const status=name.includes('404')?404:500;
writeFileSync(join(process.cwd(),'pid'),String(process.pid));
const sockets=new Set();
const server=http.createServer((_,res)=>{
 writeFileSync(join(process.cwd(),'http-received'),'yes');
 if(name.includes('hang'))return;
 if(name.includes('barrier')){const poll=setInterval(()=>{if(!existsSync(join(process.cwd(),'release-http')))return;clearInterval(poll);if(!res.destroyed){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>fixture</title>');}},15);res.once('close',()=>clearInterval(poll));return;}
 res.statusCode=status;res.end('not ready');
});
server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
server.listen(0,'127.0.0.1',()=>{const url=`http://127.0.0.1:${server.address().port}`;writeFileSync(join(process.cwd(),'url'),url);process.stdout.write(`dsh web: ${url}\n`);});
process.on('SIGTERM',()=>{for(const socket of sockets)socket.destroy();server.close(()=>process.exit(0));});
