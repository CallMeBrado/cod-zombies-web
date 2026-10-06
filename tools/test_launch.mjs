import assert from 'node:assert/strict';
import {LaunchGate} from '../web/launch-screen.js';
import {readPackResponse,preloadAssets,preloadState,assetData} from '../web/preload.js';
import {mediaRange} from './media-response.mjs';

for(const order of [['loaded','ended'],['ended','loaded']]){
  let starts=0;const gate=new LaunchGate(()=>starts++);assert.equal(gate.skip(),false);
  gate[order[0]]();assert.equal(starts,0);gate[order[1]]();assert.equal(starts,1);
  gate.loaded();gate.ended();gate.skip();assert.equal(starts,1);
}
let starts=0;const gate=new LaunchGate(()=>starts++);gate.loaded();assert.equal(starts,0);assert(gate.skip());assert.equal(starts,1);
const stream=(bytes,chunk=30)=>{let at=0;return new Response(new ReadableStream({pull(controller){if(at===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(at,at+=Math.min(chunk,bytes.length-at)));}}));};
const raw=new Uint8Array(150).fill(7),counts=[];
assert.deepEqual(new Uint8Array(await readPackResponse(stream(raw),150,n=>counts.push(n))),raw);
assert.equal(counts.reduce((n,v)=>n+v,0),150);assert(counts.length>1);
await assert.rejects(readPackResponse(stream(raw),151),/Incomplete/);
await assert.rejects(readPackResponse(stream(raw),149),/larger/);
await assert.rejects(readPackResponse(new Response('',{status:503}),1),/503/);
assert.equal(mediaRange(undefined,100),null);assert.deepEqual(mediaRange('bytes=0-9',100),{start:0,end:9});
assert.deepEqual(mediaRange('bytes=50-',100),{start:50,end:99});assert.deepEqual(mediaRange('bytes=-10',100),{start:90,end:99});
assert.deepEqual(mediaRange('bytes=90-999',100),{start:90,end:99});
for(const header of ['bytes=100-','bytes=40-30','bytes=-0','bytes=0-1,4-5','bytes=-','hello'])assert.equal(mediaRange(header,100),false);

function pack(url,length){
  const index=new TextEncoder().encode(JSON.stringify([{url,offset:0,length}])),bytes=new Uint8Array(12+index.length+length),view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('WWPK'));view.setUint32(4,1,true);view.setUint32(8,index.length,true);bytes.set(index,12);bytes.fill(8,12+index.length);return bytes;
}
const small=pack('/data/small.bin',30),large=pack('/data/large.bin',9000),packs=[{url:'/small.pack',bytes:small.length},{url:'/large.pack',bytes:large.length}];
const oldFetch=globalThis.fetch,oldDocument=globalThis.document,oldLocation=globalThis.location,updates=[];
try{
  globalThis.document={documentElement:{dataset:{preload:encodeURIComponent(JSON.stringify(packs))}}};
  globalThis.location=new URL('http://localhost/world-at-war/');
  globalThis.fetch=async url=>stream(url==='/small.pack'?small:large);
  await preloadAssets(()=>{},info=>updates.push({...info}));
  assert.equal(preloadState.bytes,small.length+large.length);assert.equal(preloadState.loadedBytes,preloadState.totalBytes);
  assert(updates.some(u=>u.loadedBytes>0&&u.completedPacks===0),'Progress must advance while a pack is still streaming');
  const firstFinished=updates.find(u=>u.completedPacks===1);assert(firstFinished.loadedBytes/firstFinished.totalBytes<.1,'Progress must measure unequal pack bytes, not count completed packs');
  for(let i=1;i<updates.length;i++)assert(updates[i].loadedBytes>=updates[i-1].loadedBytes);
  assert.equal((await assetData('/data/large.bin')).byteLength,9000);
}finally{globalThis.fetch=oldFetch;globalThis.document=oldDocument;globalThis.location=oldLocation;}
console.log('Launch checks passed: both completion orders, ready-only skip, single start, streamed byte progress, unequal packs, truncation failures and movie byte ranges.');
