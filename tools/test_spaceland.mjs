import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {BulletTrace} from '../web/bullet-trace.js';
import {SpacelandMovement} from '../web/iw7-test-movement.js';
import {pageRoute} from '../web/routes.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),data=path.join(root,'local-data/gameplay/iw7-spaceland');
const manifest=JSON.parse(await readFile(path.join(data,'manifest.json'),'utf8'));
assert.equal(pageRoute(new URL('http://localhost/infinite-warfare/?map=spaceland')).template,'iw7.html');
assert.equal(manifest.world.indices/3,403042);assert.equal(manifest.static.length,17010);assert.equal(Object.keys(manifest.models).length,916);
assert.equal(manifest.chunks.reduce((sum,c)=>sum+c.indices,0),manifest.world.indices);
assert.equal(manifest.sky.length,6);assert.equal(manifest.spawns.length,4);
const traces=new BulletTrace(),spawn=manifest.spawns[0].origin,materials=new Map(Object.keys(manifest.materials).map(id=>[id,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})]));
for(const definition of [...manifest.chunks,...Object.values(manifest.models)]){
  const raw=await readFile(path.join(data,definition.url)),buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),h=new DataView(buffer);
  assert.equal(h.getUint32(0,true),0x47375749);assert.equal(h.getUint32(4,true),1);
  const count=h.getUint32(8,true),indices=h.getUint32(12,true);assert.equal(count,definition.vertices);assert.equal(indices,definition.indices);assert.equal(buffer.byteLength,16+count*32+indices*4);
  const vertices=new Float32Array(buffer,16,count*8),ids=new Uint32Array(buffer,16+count*32,indices);
  assert(vertices.every(Number.isFinite));assert(ids.every(id=>id<count));
  assert.equal(definition.groups.reduce((sum,g)=>sum+g.count,0),indices);
  for(const group of definition.groups)assert(manifest.materials[group.material]);
  if(manifest.chunks.includes(definition)&&definition.bounds[0][0]<spawn[0]+512&&definition.bounds[1][0]>spawn[0]-512&&definition.bounds[0][1]<spawn[1]+512&&definition.bounds[1][1]>spawn[1]-512){
    const g=new THREE.BufferGeometry(),interleaved=new THREE.InterleavedBuffer(vertices,8);g.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));g.setIndex(new THREE.BufferAttribute(ids,1));definition.groups.forEach((group,i)=>g.addGroup(group.start,group.count,i));traces.addGeometry(g,definition.groups.map(group=>materials.get(group.material)),new THREE.Matrix4());
  }
}
const images=new Map();for(const material of Object.values(manifest.materials))for(const image of [material.diffuse,material.emissive])if(image)images.set(image.url,image);
for(const face of manifest.sky)images.set(face.url,face);
for(const image of images.values()){const raw=await readFile(path.join(data,image.url));assert.equal(raw.length,image.bytes);assert.equal(raw.subarray(1,4).toString(),'PNG');assert(raw.readUInt32BE(16)<=manifest.textureLimit);assert(raw.readUInt32BE(20)<=manifest.textureLimit);}
for(const instance of manifest.static){assert(manifest.models[instance.model]);assert(instance.origin.every(Number.isFinite));assert(instance.axis.every(Number.isFinite));assert(Number.isFinite(instance.scale)&&instance.scale>0);}
const hit=traces.trace([spawn[0],spawn[1],spawn[2]+80],[0,0,-1],180);assert(hit&&hit.normal[2]>.9,'Native spawn must have a walkable floor');const floor=spawn[2]+80-hit.distance;
assert(Math.abs(floor-spawn[2])<2,`Native spawn/floor mismatch: ${floor}`);
for(const start of manifest.spawns){assert(start.origin.every(Number.isFinite));assert(start.angles.every(Number.isFinite));const hit=traces.trace([start.origin[0],start.origin[1],start.origin[2]+80],[0,0,-1],180);assert(hit&&hit.normal[2]>.9);assert(Math.abs(start.origin[2]+80-hit.distance-start.origin[2])<2);}
const tracer=(o,d,r)=>traces.trace(o,d,r);
for(const fps of [30,60,120,240]){const movement=new SpacelandMovement(tracer,spawn);let accumulator=0;for(let frame=0;frame<fps*6;frame++){accumulator+=1/fps;while(accumulator>=1/120){movement.step(1/120);accumulator-=1/120;}}assert(movement.grounded);assert(Math.abs(movement.position[2]-floor)<.1,`${fps} FPS native floor stability`);}
const flat=(o,d,r)=>{if(d[2]>=0)return null;const distance=-o[2]/d[2];return distance>=0&&distance<r?{distance,normal:[0,0,1]}:null;};
const movement=new SpacelandMovement(flat,[0,0,0]);movement.step(1/120);movement.step(1/120,{jump:true});assert(movement.vz>0);for(let i=0;i<180;i++)movement.step(1/120);assert(movement.grounded);movement.noclip=true;movement.step(1,{vertical:1});assert(movement.position[2]>180);movement.reset();assert.deepEqual(movement.position,[0,0,0]);
const movie=JSON.parse(await readFile(path.join(root,'local-data/launch/spaceland.json'),'utf8'));assert.equal(movie.audioChannels,2);assert.equal(movie.hasAudio,true);assert(movie.duration>200&&movie.duration<210);assert.deepEqual(movie.sourceStamp.audioStreams,[0,1,2,3,4]);
console.log(`Spaceland test: all native geometry/indices/materials, ${images.size} textures, 17,010 placements, native spawn floors at 30–240 FPS, jump/free camera and stereo intro passed.`);
