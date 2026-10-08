import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const child=spawn(process.execPath,['tools/serve.mjs'],{cwd:root,env:{...process.env,PORT:'8793',HOST:'127.0.0.1',ZOMBIES_SHARED_ASSETS:process.env.ZOMBIES_SHARED_ASSETS||'E:\\WaW zombies webui'},stdio:['ignore','pipe','pipe']});
try{
  await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{if(String(chunk).includes('Listening on'))resolve();});child.stderr.on('data',chunk=>reject(new Error(String(chunk))));child.once('exit',code=>reject(new Error('Preview server exited '+code)));});
  const base='http://127.0.0.1:8793',get=p=>fetch(base+p);
  const page=await get('/black-ops/?map=shangri-la');assert.equal(page.status,200);const html=await page.text();assert(html.includes('launch-screen'));
  const version=html.match(/runtime\/([a-f0-9]{16})/)[1];assert((await (await get('/runtime/'+version+'/maps.js')).text()).includes("id:'shangri-la'"));
  assert.equal((await get('/data/gameplay/bo1-temple/manifest.json')).status,200);
  assert.equal((await get('/data/gameplay/bo1-kino/preload.json')).status,200,'Read-only existing-map fallback');
  const kino=await (await get('/data/gameplay/bo1-kino/preload.json')).json();assert.equal((await fetch(base+kino.packs[0].url,{method:'HEAD'})).status,200);
  const temple=JSON.parse(await readFile(new URL('../local-data/gameplay/bo1-temple/preload.json',import.meta.url),'utf8'));assert.equal((await fetch(base+temple.packs[0].url,{method:'HEAD'})).status,200);
  const movie=await fetch(base+'/data/launch/shangri-la.mp4',{headers:{Range:'bytes=0-1023'}});assert.equal(movie.status,206);assert.equal((await movie.arrayBuffer()).byteLength,1024);
  for(const path of ['/data/saves/temple/0.json','/data/bo1-temple-extract.log','/data/%2e%2e%2ftools/serve.mjs','/data/gameplay/%2e%2e/%2e%2e/tools/serve.mjs'])assert([403,404].includes((await get(path)).status),'Private/traversal blocked: '+path);
  const saves=await get('/api/saves');assert.equal(saves.status,200);assert.equal((await get('/api/saves/shangri-la/0')).status,404,'No inherited production save');
  console.log('Shangri server passed: themed route, own/shared packs, movie ranges, isolated saves and private-path protection');
}finally{child.kill();}
