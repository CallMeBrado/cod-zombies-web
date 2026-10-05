import fs from 'node:fs';
import assert from 'node:assert/strict';
import {BakedLightSamples} from '../web/baked-light.js';
const folder=new URL('../local-data/nacht/web-world/',import.meta.url),world=JSON.parse(fs.readFileSync(new URL('nazi_zombie_prototype.json',folder))),vertices=fs.readFileSync(new URL(world.vertices,folder));
const samples=[],seen=new Set();let repeated=0;
for(const surface of world.surfaces){if(!world.lightmaps[surface.lightmap])continue;for(let i=surface.firstVertex;i<surface.firstVertex+surface.vertexCount;i+=3){
  repeated++;const id=surface.lightmap*world.vertexCount+i;if(seen.has(id))continue;seen.add(id);
  samples.push({id,p:[0,1,2].map(k=>vertices.readFloatLE(i*32+k*4)),uv:[vertices.readFloatLE(i*32+20),vertices.readFloatLE(i*32+24)],lightmap:surface.lightmap});
}}
const referenceCells=new Map();for(const sample of samples){const key=sample.p.map(v=>Math.floor(v/128)).join(',');if(!referenceCells.has(key))referenceCells.set(key,[]);referenceCells.get(key).push(sample);}
const original=position=>{const cell=position.map(v=>Math.floor(v/128));let best=null,distance=Infinity;
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const s of referenceCells.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))||[]){const d=s.p.reduce((sum,v,i)=>sum+(v-position[i])**2,0);if(d<distance){distance=d;best=s;}}
  return best;
};
const began=performance.now(),lighting=new BakedLightSamples(samples),buildMs=performance.now()-began;
let seed=313;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const positions=[[0,424,1],[-179.9,482.4,1],[0,424,145],[100000,100000,100000]];
for(let i=0;i<2000;i++)positions.push(i<1000?samples[i*29%samples.length].p.slice():[-1500+random()*3000,-1000+random()*2500,-200+random()*700]);
const originalStart=performance.now(),expected=positions.map(original),originalMs=performance.now()-originalStart;
const fastStart=performance.now(),actual=positions.map(p=>lighting.nearest(p)),indexedMs=performance.now()-fastStart;
actual.forEach((v,i)=>assert.equal(v,expected[i],'Nearest lighting sample differs at '+positions[i]));
// Equal-distance samples keep the same first-in-cell and cell-loop ordering.
const tied=[{p:[10,0,0],id:0},{p:[10,0,0],id:1},...Array.from({length:30},(_,i)=>({p:[20+i,0,0],id:i+2}))];
assert.equal(new BakedLightSamples(tied).nearest([0,0,0]).id,0);
const cellsTie=[{p:[128,0,0],id:0},{p:[-128,0,0],id:1}];assert.equal(new BakedLightSamples(cellsTie).nearest([0,0,0]).id,1);
const report={originalRepeatedSamples:repeated,uniqueSamples:samples.length,comparisons:positions.length,identicalSamples:true,buildMs,originalMs,indexedMs};
fs.writeFileSync(new URL('../local-data/baked-light-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
