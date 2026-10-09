import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,['tools/serve.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:'8794',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Listening on')){clearTimeout(timeout);resolve();}});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code));});child.once('error',reject);});
  const base='http://127.0.0.1:8794',get=p=>fetch(base+p),html=await (await get('/black-ops-2/?map=town')).text();
  assert(html.includes('launch-screen')&&html.includes('Black Ops II'));const build=html.match(/runtime\/([a-f0-9]{16})/)[1];
  for(const name of ['bo2-town-engine.js','bo2-town.js','bo2-town-view.js','bo2-menu.js'])assert.equal((await get('/runtime/'+build+'/'+name)).status,200);
  const m=await (await get('/data/gameplay/bo2-town/manifest.json')).json();assert.equal(m.map.id,'town');
  assert.equal((await get(m.map.skyTexture)).status,200);
  const preload=await (await get('/data/gameplay/bo2-town/preload.json')).json();assert.equal((await fetch(base+preload.packs[0].url,{method:'HEAD'})).status,200);
  const launch=await (await get('/data/launch/town.json')).json();assert.equal(launch.audioChannels,2);
  const movie=await fetch(base+launch.url,{headers:{Range:'bytes=0-1023'}});assert.equal(movie.status,206);assert.equal((await movie.arrayBuffer()).byteLength,1024);
  assert.equal((await get('/data/bo2-town-mode/model_export/c_zom_suit_viewhands_lod0.glb')).status,200);
  for(const p of ['/data/bo2-town-mode-extract.log','/data/bo2-town-scripts/t6/maps/mp/zm_transit_standard_town.gsc','/data/saves/town/0.json'])assert([403,404].includes((await get(p)).status),'Private file must stay private');
  console.log('Town HTTP checks passed: BO2 lobby, separate Town pack, native CIA hands, stereo launch and private source paths.');
}finally{child.kill();}
