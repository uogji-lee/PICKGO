// Local development only: survives the terminal and restarts a crashed server.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'data', 'runtime');
fs.mkdirSync(dir, {recursive:true});
const lock = path.join(dir, 'supervisor.pid');
const stop = path.join(dir, 'stop');
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock,'utf8'));
  let alive = false;
  try { process.kill(pid,0); alive = true; } catch {}
  if (alive) process.exit(0);
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, String(process.pid), {flag:'wx'});
if (fs.existsSync(stop)) fs.unlinkSync(stop);
const logPath = path.join(dir,'server.log');
if (fs.existsSync(logPath) && fs.statSync(logPath).size > 5 * 1024 * 1024) fs.renameSync(logPath,path.join(dir,'server.previous.log'));
const log = fs.openSync(logPath,'a');
const note = message => fs.writeSync(log, `${new Date().toISOString()} ${message}\n`);
let child, stopping = false, attempts = [];
function finish() { if (fs.existsSync(lock)) fs.unlinkSync(lock); process.exit(0); }
function shutdown() { stopping = true; note('Supervisor stopped'); if(child) child.kill(); else finish(); }
function start() {
  note('Starting PICKGO');
  child = spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});
  child.on('error', error => { note(`Spawn error: ${error.code}`); shutdown(); });
  child.on('exit', (code,signal) => {
    child = null; note(`Server exit code=${code} signal=${signal}`);
    if (stopping || code === 98) return finish();
    attempts = attempts.filter(time => Date.now()-time<60000); attempts.push(Date.now());
    if (attempts.length > 5) { note('Repeated failures: inspect server.log before restarting'); return finish(); }
    setTimeout(() => { if(!stopping) start(); },2000);
  });
}
setInterval(() => { if(fs.existsSync(stop)) shutdown(); },1000).unref();
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
start();
