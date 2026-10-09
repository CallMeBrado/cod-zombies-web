import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,['tools/serve.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:'8794',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Listening on')){clearTimeout(timeout);resolve();}});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code));});child.once('error',reject);});
  const base='http://127.0.0.1:8794',get=p=>fetch(base+p),html=await (await get('/black-ops-2/?map=mob-of-the-dead')).text();
  assert(html.includes('launch-screen')&&html.includes('Black Ops II'));const build=html.match(/runtime\/([a-f0-9]{16})/)[1];
  for(const name of ['bo2-mob-engine.js','bo2-mob.js','bo2-mob-view.js','bo2-engine.js'])assert.equal((await get('/runtime/'+build+'/'+name)).status,200);
  const m=await (await get('/data/gameplay/bo2-mob/manifest.json')).json();assert.equal(m.map.id,'mob-of-the-dead');
  const preload=await (await get('/data/gameplay/bo2-mob/preload.json')).json();assert.equal((await fetch(base+preload.packs[0].url,{method:'HEAD'})).status,200);
  const launch=await (await get('/data/launch/mob-of-the-dead.json')).json();assert.equal(launch.audioChannels,2);assert.equal(launch.sourceAudioTracks.length,3);
  const movie=await fetch(base+launch.url,{headers:{Range:'bytes=0-1023'}});assert.equal(movie.status,206);assert.equal((await movie.arrayBuffer()).byteLength,1024);
  assert.equal((await get('/data/bo2-mob/images/skybox_zm_alcatraz_ft.dds')).status,200);
  for(const p of ['/data/bo2-mob-extract.log','/data/bo2-mob-scripts/t6/maps/mp/zm_prison.gsc','/data/saves/mob-of-the-dead/0.json'])assert([403,404].includes((await get(p)).status),'Private file must stay private');
  console.log('Mob of the Dead HTTP checks passed: BO2 lobby, engine modules, own pack, escaped textures, stereo launch movie and private paths.');
}finally{child.kill();}
