import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,['tools/serve.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:'8794',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Five test server did not start')),10000);child.stdout.on('data',s=>{if(String(s).includes('Listening on')){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',c=>{clearTimeout(timer);reject(new Error('Test server exited '+c));});});
  const base='http://127.0.0.1:8794',get=p=>fetch(base+p),html=await (await get('/black-ops/?map=five')).text();assert(html.includes('launch-screen'));const hash=html.match(/runtime\/([a-f0-9]{16})/)[1];
  for(const n of ['bo1-five.js','bo1-five-view.js'])assert.equal((await get('/runtime/'+hash+'/'+n)).status,200);assert.equal((await (await get('/data/gameplay/bo1-five/manifest.json')).json()).map.id,'five');
  const pre=await (await get('/data/gameplay/bo1-five/preload.json')).json();assert.equal((await fetch(base+pre.packs[0].url,{method:'HEAD'})).status,200);
  const media=await (await get('/data/launch/five.json')).json();assert(media.hasAudio&&media.audioChannels===2);const movie=await fetch(base+media.url,{headers:{Range:'bytes=0-1023'}});assert.equal(movie.status,206);assert.equal((await movie.arrayBuffer()).byteLength,1024);
  for(const path of ['/data/bo1-five-extract.log','/data/saves/five/0.json','/data/%2e%2e/tools/serve.mjs'])assert([403,404].includes((await get(path)).status));
  console.log('Five HTTP: BO1 menu route, engine, cached pack, stereo native intro and private paths passed.');
}finally{child.kill();}
