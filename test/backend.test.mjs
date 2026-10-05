import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{timeout:10000},fn);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { BackendManager, validateLocalEndpoint } from '../lib/backend.js';
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
async function setup(t, fixture='server.mjs', extra={}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-test-'));
  const manager = new BackendManager();
  const spec = { nodePath:process.execPath, launcherPath:join(fixtures,fixture), homePath:join(root,'home'), cwd:root, startupTimeoutMs:2500, healthTimeoutMs:500, stopGraceMs:250, forceExitTimeoutMs:1200, maxLogBytes:2048, ...extra };
  const rescue=()=>{for(const name of ['descendant.pid','pid']){try{const pid=Number(readFileSync(join(root,name),'utf8'));if(Number.isSafeInteger(pid)&&pid>1)process.kill(pid,'SIGKILL');}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}}};
  t.signal.addEventListener('abort',rescue,{once:true});
  t.after(async () => {let timer;let cleaned=false;try{await Promise.race([manager.dispose(),new Promise((_,reject)=>{timer=setTimeout(()=>{rescue();reject(new Error('independent fixture cleanup deadline'));},1600);})]);cleaned=true;}catch(error){try{rescue();}catch(rescueError){console.error('independent rescue failure:',rescueError);}throw error;}finally{clearTimeout(timer);t.signal.removeEventListener('abort',rescue);if(cleaned)await rm(root,{recursive:true,force:true});else console.error('failed fixture preserved:',root);}});
  return {manager,spec,root};
}
async function waitPid(root) { const end=Date.now()+2500; while(Date.now()<end) { try { return Number(await readFile(join(root,'pid'),'utf8')); } catch(e) { if(e.code!=='ENOENT')throw e; await new Promise(r=>setTimeout(r,15)); } } throw new Error('fixture did not start'); }
async function existsPid(pid) { try { process.kill(pid,0); return true; } catch(e) { if(e.code==='ESRCH')return false; throw e; } }
test('local endpoints accept explicit loopback and reject remote, credentials and non-http', () => {
 for(const url of ['http://127.0.0.1:3080','http://localhost:3080','http://[::1]:3080']) assert.match(validateLocalEndpoint(url), /^http:/);
 for(const url of ['https://example.com','http://example.com:3080','file:///etc/passwd','http://user:pass@127.0.0.1:3080','http://127.0.0.1:3080/?token=x']) assert.throws(()=>validateLocalEndpoint(url));
});
test('owned ready and HTTP yield connected, stop awaits process exit and releases URL', async t => {
 const {manager,spec,root}=await setup(t);const state=await manager.startOwned(spec);
 assert.equal(state.phase,'connected');assert.equal(state.ownership,'owned');assert.equal((await fetch(state.url)).status,200);
 const pid=Number(await readFile(join(root,'pid'),'utf8'));await manager.disconnect();assert.equal(manager.getState().phase,'idle');assert.equal(await existsPid(pid),false);await assert.rejects(fetch(state.url));
});
test('external attachment disconnects without stopping its server', async t => {
 const external=await setup(t);const running=await external.manager.startOwned(external.spec);const attached=new BackendManager();t.after(()=>attached.dispose());
 const result=await attached.attach(running.url,500);assert.equal(result.ownership,'external');await attached.disconnect();assert.equal((await fetch(running.url)).status,200);assert.equal(external.manager.getState().phase,'connected');
});
test('a failed executable produces an actionable error rather than connected', async t => {
 const {manager,spec}=await setup(t);await assert.rejects(manager.startOwned({...spec,nodePath:'/nonexistent/dsh-node'}));assert.equal(manager.getState().phase,'error');assert.ok(manager.getState().error);
});
test('nonzero startup preserves stderr and exit facts', async t => {
 const {manager,spec}=await setup(t,'exit-failure.mjs');await assert.rejects(manager.startOwned(spec));const s=manager.getState();assert.equal(s.phase,'error');assert.equal(s.lastExit.code,17);assert.match(s.diagnostics,/fixture startup failure/);
});
test('startup timeout remains timeout when the child handles TERM and exits zero', async t => {
 const {manager,spec}=await setup(t,'silent.mjs',{startupTimeoutMs:1000});await assert.rejects(manager.startOwned(spec));const s=manager.getState();assert.equal(s.phase,'error');assert.equal(s.lastExit.code,0);assert.equal(s.lastExit.timedOut,true);
});
test('cancel before ready prevents late connected and closes owned child', async t => {
 const {manager,spec,root}=await setup(t,'slow-server.mjs');const phases=[];manager.subscribe(s=>phases.push(s.phase));const pending=manager.startOwned(spec);const rejected=assert.rejects(pending);
 await waitPid(root);await manager.disconnect();await rejected;await writeFile(join(root,'release-ready'),'go');await new Promise(r=>setTimeout(r,100));assert.equal(manager.getState().phase,'idle');assert.ok(!phases.includes('connected'));const pid=Number(await readFile(join(root,'pid'),'utf8'));assert.equal(await existsPid(pid),false);
});
test('output beyond diagnostic limit is still drained and ready is reachable', async t => {
 const {manager,spec}=await setup(t,'noisy-server.mjs');const state=await manager.startOwned(spec);assert.equal(state.phase,'connected');assert.ok(Buffer.byteLength(state.diagnostics)<=spec.maxLogBytes);
});
test('a non-loopback ready line is rejected and never navigated', async t => {
 const {manager,spec}=await setup(t,'invalid-ready.mjs');await assert.rejects(manager.startOwned(spec));assert.equal(manager.getState().phase,'error');assert.equal(manager.getState().url,null);
});
test('a stubborn owned process is forced after grace and its actual exit observed', async t => {
 const {manager,spec,root}=await setup(t,'stubborn.mjs');await manager.startOwned(spec);const pid=Number(await readFile(join(root,'pid'),'utf8'));await manager.disconnect();assert.equal(await existsPid(pid),false);assert.equal(manager.getState().lastExit.forced,true);
});
test('a broken presentation listener does not break transport startup or cleanup', async t => {
 const {manager,spec}=await setup(t);manager.subscribe(()=>{throw new Error('presentation was disposed');});assert.equal((await manager.startOwned(spec)).phase,'connected');await manager.disconnect();assert.equal(manager.getState().phase,'idle');
});
test('starting twice does not spawn a second owned child', async t => {
 const {manager,spec,root}=await setup(t,'slow-server.mjs');const first=manager.startOwned(spec);await assert.rejects(manager.startOwned(spec));await waitPid(root);await writeFile(join(root,'release-ready'),'go');assert.equal((await first).phase,'connected');assert.equal((await readFile(join(root,'starts'),'utf8')).trim().split('\n').length,1);
});

test('owned descendant holding stdout after parent exits is joined by group cleanup', async t => {
 const {manager,spec,root}=await setup(t,'descendant-server.mjs');const state=await manager.startOwned(spec);const pid=Number(await readFile(join(root,'descendant.pid'),'utf8'));
 await manager.disconnect();assert.equal(await readFile(join(root,'parent-exit'),'utf8'),'after close');assert.equal(await existsPid(pid),false);await assert.rejects(fetch(state.url));assert.equal(manager.getState().phase,'idle');
});

for(const fixture of ['health-404.mjs','health-500.mjs','health-hang.mjs'])test(`valid owned ready with ${fixture} is rejected and fully cleaned`,async t=>{
 const {manager,spec,root}=await setup(t,fixture,{healthTimeoutMs:250});await assert.rejects(manager.startOwned(spec));assert.equal(manager.getState().phase,'error');assert.equal(manager.getState().url,null);assert.equal(await existsPid(Number(await readFile(join(root,'pid'),'utf8'))),false);await assert.rejects(fetch(await readFile(join(root,'url'),'utf8')));
});
test('external HTTP refusal cannot become connected and does not affect that server',async t=>{
 const server=http.createServer((_,res)=>{res.statusCode=404;res.end('unavailable');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url=`http://127.0.0.1:${server.address().port}`;const manager=new BackendManager();t.after(()=>manager.dispose());await assert.rejects(manager.attach(url,250));assert.equal(manager.getState().phase,'error');assert.equal((await fetch(url)).status,404);
});
test('cancelling during health wait blocks late success and releases owned port',async t=>{
 const {manager,spec,root}=await setup(t,'health-barrier.mjs');const phases=[];manager.subscribe(s=>phases.push(s.phase));const pending=manager.startOwned(spec);const rejected=assert.rejects(pending);const end=Date.now()+2000;while(Date.now()<end){try{await readFile(join(root,'http-received'));break;}catch(e){if(e.code!=='ENOENT')throw e;await new Promise(r=>setTimeout(r,15));}}await readFile(join(root,'http-received'));await manager.disconnect();await rejected;await writeFile(join(root,'release-http'),'go');await new Promise(r=>setTimeout(r,75));assert.ok(!phases.includes('connected'));assert.equal(manager.getState().phase,'idle');await assert.rejects(fetch(await readFile(join(root,'url'),'utf8')));
});
test('concurrent dispose is idempotent and start cannot resurrect a disposed controller',async t=>{
 const {manager,spec}=await setup(t);await manager.startOwned(spec);await Promise.all([manager.dispose(),manager.dispose()]);assert.equal(manager.getState().phase,'idle');await assert.rejects(manager.startOwned(spec));
});
