import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,['tools/serve.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:'8794',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Listening on')){clearTimeout(timeout);resolve();}});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code));});child.once('error',reject);});
  const base='http://127.0.0.1:8794',get=p=>fetch(base+p),html=await (await get('/black-ops-2/?map=origins')).text();
  assert(html.includes('launch-screen')&&html.includes('Black Ops II'));const build=html.match(/runtime\/([a-f0-9]{16})/)[1];
  for(const name of ['bo2-origins-engine.js','bo2-origins.js','bo2-origins-view.js','weapon-attachments.js'])assert.equal((await get('/runtime/'+build+'/'+name)).status,200);
  const m=await (await get('/data/gameplay/bo2-origins/manifest.json')).json();assert.equal(m.map.id,'origins');
  const preload=await (await get('/data/gameplay/bo2-origins/preload.json')).json();assert.equal((await fetch(base+preload.packs[0].url,{method:'HEAD'})).status,200);
  const launch=await (await get('/data/launch/origins.json')).json();assert.equal(launch.audioChannels,2);assert.equal(launch.sourceAudioTracks.length,2);
  const movie=await fetch(base+launch.url,{headers:{Range:'bytes=0-1023'}});assert.equal(movie.status,206);assert.equal((await movie.arrayBuffer()).byteLength,1024);
  assert.equal((await get('/data/bo2-origins/images/fxt_env_water_blur_pcloud%230.dds')).status,200);
  for(const p of ['/data/bo2-origins-extract.log','/data/bo2-origins-scripts/t6/maps/mp/zm_tomb.gsc','/data/saves/origins/0.json'])assert([403,404].includes((await get(p)).status),'Private file must stay private');
  console.log('Origins HTTP checks passed: BO2 lobby, engine modules, own pack, escaped textures, stereo launch movie and private paths.');
}finally{child.kill();}
