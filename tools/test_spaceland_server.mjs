import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),port=Number(process.env.SPACELAND_TEST_PORT||18996),base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['tools/serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',v=>output+=v);server.stderr.on('data',v=>output+=v);
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/status')).ok)break;}catch{}if(server.exitCode!==null)throw new Error(output);await new Promise(resolve=>setTimeout(resolve,100));if(i===99)throw new Error('Spaceland HTTP test server did not start');}
  const page=await fetch(base+'/infinite-warfare/?map=spaceland');assert.equal(page.status,200);const html=await page.text();assert(html.includes('SURVIVAL TEST'));assert(!html.includes('__BUILD__'));assert(html.includes('Original map, character rigs and combat animations'));
  const home=await(await fetch(base+'/')).text();assert(home.includes('href="/infinite-warfare/?map=spaceland"'));assert(home.includes('Early solo survival.'));
  const moduleUrl=html.match(/src="([^"\n]*iw7-test\.js)"/)[1],runtime=await fetch(base+moduleUrl);assert.equal(runtime.status,200);assert((await runtime.text()).includes('SpacelandMovement'));
  const asset=await fetch(base+'/data/gameplay/iw7-spaceland/manifest.json');assert.equal(asset.status,200);const manifest=await asset.json();
  const geometry=await fetch(base+'/data/gameplay/iw7-spaceland/'+manifest.chunks[0].url,{method:'HEAD'});assert.equal(geometry.status,200);assert.equal(Number(geometry.headers.get('content-length')),manifest.chunks[0].bytes);
  const movie=await fetch(base+'/data/launch/spaceland.mp4',{headers:{Range:'bytes=0-63'}});assert.equal(movie.status,206);assert.equal((await movie.arrayBuffer()).byteLength,64);assert.equal(movie.headers.get('content-type'),'video/mp4');
  const poster=await fetch(base+'/data/gameplay/iw7-spaceland/poster.jpg',{method:'HEAD'});assert.equal(poster.status,200);assert.equal(poster.headers.get('content-type'),'image/jpeg');
  for(const privatePath of ['/data/iw7-spaceland/inventory.json','/data/iw7-spaceland/native/entities.txt','/.tools/cordycep/Data/CurrentHandler.csi'])assert.equal((await fetch(base+privatePath)).status,404);
  assert((await fetch(base+'/black-ops/?map=five')).ok);assert((await fetch(base+'/black-ops-2/?map=origins')).ok);
  console.log('Spaceland HTTP: test route, versioned modules, native geometry, stereo movie ranges, poster and private extraction paths passed; Five/Origins routes remain available.');
}finally{server.kill();}
