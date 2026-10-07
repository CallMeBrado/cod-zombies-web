import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {SkeletonRagdoll} from '../web/ragdoll.js';
import {ZombieActors} from '../web/actors.js';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {MAPS,BO1_MAPS} from '../web/maps.js';
const root=new URL('../',import.meta.url),read=async name=>JSON.parse(await readFile(new URL('local-data/'+name,root),'utf8'));
async function nativeRig(map,presentation){
  const load=async name=>{let bytes;
  for(const zone of map.assetZones||[map.zone,'common','nacht'])try{bytes=await readFile(new URL('local-data/'+zone+'/model_export/'+name+'_lod0.glb',root));break;}catch{}
  assert(bytes,'Original actor is available');const data=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12))),joints=new Set(data.skins.flatMap(s=>s.joints));
  // Reconstruct the exported native skeleton without loading its textures/GPU.
  const nodes=data.nodes.map((n,i)=>{const b=joints.has(i)?new THREE.Bone():new THREE.Object3D();b.name=n.name||'';if(n.translation)b.position.fromArray(n.translation);if(n.rotation)b.quaternion.fromArray(n.rotation);if(n.scale)b.scale.fromArray(n.scale);return b;});
  data.nodes.forEach((n,i)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));
  const model=new THREE.Group();model.rotation.x=Math.PI/2;for(const n of data.scenes[data.scene||0].nodes)model.add(nodes[n]);return model;
  };
  const model=await load(presentation.actors?.body||'char_ger_honorgd_body1_1'),head=await load(presentation.actors?.head||'char_ger_honorgd_zombiehead1_1');model.getObjectByName('j_spine4').add(head);
  const actor=new THREE.Group();actor.add(model);actor.updateMatrixWorld(true);return actor;
}
const box=(mins,maxs,contents=1)=>({mins,maxs,contents,planes:[]});
const arena=extra=>new CollisionWorld({models:[{brushes:[]}],brushes:[box([-1000,-1000,-128],[1000,1000,0]),...extra]},[]);
const report=[];
for(const map of [...MAPS,...BO1_MAPS].filter(m=>m.engine!=='dead-ops')){
  const manifest=await read(map.data+'/manifest.json'),presentation=await read(map.data+'/presentation.json');
  let reference;
  for(const hz of [30,60,240]){
    const actor=await nativeRig(map,presentation),r=new SkeletonRagdoll(actor),world=arena([]),enemy={id:1,angle:0,speed:57,position:[0,0,0]};assert(r.ready);assert.equal(r.nodes.length,20);
    const head=r.byName.get('j_head'),initial=head.bone.getWorldPosition(new THREE.Vector3()).z;
    assert(r.start(enemy,[1,0,0],60,world));r.restoreFrozen();for(let f=0;f<hz*4.5;f++)r.update(1/hz,world);
    assert(r.sleeping,'Settled corpses stop simulating');assert(head.p.z<initial-25,map.id+' head must fall, rather than remain standing');
    for(const n of r.nodes){assert(n.p.toArray().every(Number.isFinite));assert(n.p.z>=n.radius-.1,map.id+' joint cannot fall through floor');const rendered=n.bone.getWorldPosition(new THREE.Vector3());assert(rendered.distanceTo(n.p)<1e-6,'World physics joints correctly drive the native bone hierarchy');}
    assert(r.followers.length>=4,'Native separate head rig is included');for(const {bone,source}of r.followers)assert(bone.getWorldPosition(new THREE.Vector3()).distanceTo(source.getWorldPosition(new THREE.Vector3()))<1e-6,'Separate head bones follow the ragdoll body');
    const pose=r.nodes.map(n=>n.p.clone());if(reference)pose.forEach((p,i)=>assert(p.distanceTo(reference[i])<1e-6,'Ragdoll physics is independent of render FPS'));else reference=pose;
    const frozen=r.nodes.map(n=>n.p.clone()),time=r.elapsed;r.update(0,world);assert.equal(r.elapsed,time);r.update(.1,world);frozen.forEach((p,i)=>assert(p.equals(r.nodes[i].p),'Sleeping corpses keep their settled pose'));
    r.reset();assert(!r.active);assert.equal(r.constraints.length,0);actor.updateMatrixWorld(true);assert(Math.abs(head.bone.getWorldPosition(new THREE.Vector3()).z-initial)<1e-6,'Recycled actors regain their living skeleton');
    report.push({map:map.id,hz,head:reference.find((_,i)=>r.nodes[i]===head).z,steps:Math.round(time*60)});
  }
  const solid=arena([box([30,-100,-10],[40,100,160])]),actor=await nativeRig(map,presentation),wall=new SkeletonRagdoll(actor);wall.start({id:2,position:[0,0,0],angle:0,speed:0},[1,0,0],120,solid);
  const initiallyLeft=new Set(wall.nodes.filter(n=>n.p.x+n.radius<30));for(let f=0;f<240;f++)wall.update(1/60,solid);
  for(const n of initiallyLeft)assert(n.p.x+n.radius<30.1,'Swept bodies cannot pass through a solid wall');
  const clips=arena([box([30,-100,-10],[40,100,160],0x10000)]),freeActor=await nativeRig(map,presentation),free=new SkeletonRagdoll(freeActor);free.start({id:2,position:[0,0,0],angle:0,speed:0},[1,0,0],120,clips);for(let f=0;f<240;f++)free.update(1/60,clips);
  assert(free.nodes.some(n=>n.p.x+n.radius>40),'Invisible movement clips do not form corpse walls');
  const collision=new CollisionWorld(await read(map.zone+'/web-world/'+map.asset+'.collision.json'),manifest.entities),g=new (map.game==='black-ops'?BlackOpsEngine:SoloGame)(manifest,collision,await read(map.zone+'/web-world/'+map.asset+'.paths.json'),{},presentation);
  const placed=await nativeRig(map,presentation);placed.position.fromArray(g.player.position);const native=new SkeletonRagdoll(placed);native.start({id:3,position:g.player.position,angle:0,speed:57},[1,0,0],60,collision);
  for(let f=0;f<240;f++)native.update(1/60,collision);
  assert(native.nodes.every(n=>n.p.toArray().every(Number.isFinite)&&n.p.z>g.player.position[2]-72),'Native map collision keeps ragdolls above the world');assert(native.byName.get('j_head').p.z<g.player.position[2]+40,'Original-map corpse falls below standing head height');
  // Real actor lifecycle: freeze an animated pose, collapse, then reuse that
  // exact prepared slot as a living zombie without another model allocation.
  const scene=new THREE.Scene(),actors=new ZombieActors(scene,{illumination:()=>[1,1,1]},presentation),pooled=await nativeRig(map,presentation),mixer=new THREE.AnimationMixer(pooled),spine=pooled.getObjectByName('j_spine4');
  const tilted=spine.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.3));
  const clip=new THREE.AnimationClip('ai_zombie_walk_v1',1,[new THREE.QuaternionKeyframeTrack(spine.uuid+'.quaternion',[0,1],[...spine.quaternion.toArray(),...tilted.toArray()])]);
  const slot={root:pooled,object:pooled,mixer,actions:new Map([['ai_zombie_walk_v1',mixer.clipAction(clip)]]),materials:[],trace:{tick:-1},ragdoll:new SkeletonRagdoll(pooled)};
  actors.pool.push(slot);actors.collision=arena([]);const enemy={id:10,position:[0,0,0],angle:0,speed:57,stage:'hunt',dead:false};assert.equal(actors.acquire(enemy),slot);actors.updateOne(slot,.4,enemy.position);
  const frozenHead=pooled.getObjectByName('j_head').getWorldPosition(new THREE.Vector3());enemy.dead=true;assert(actors.kill(enemy,[1,0,0]));assert(pooled.getObjectByName('j_head').getWorldPosition(new THREE.Vector3()).distanceTo(frozenHead)<1e-6,'Stopping animation does not snap the death pose to bind pose');
  for(let f=0;f<240;f++)actors.updateOne(slot,1/60,enemy.position);assert(slot.ragdoll.sleeping);actors.release(enemy.id);assert.equal(actors.pool.length,1);assert.equal(actors.active.size,0);assert.equal(scene.children.length,0);
  const living={...enemy,id:11,dead:false};assert.equal(actors.acquire(living),slot);assert(!slot.ragdoll.active);assert.equal(scene.children.length,1);assert(pooled.getObjectByName('j_head').getWorldPosition(new THREE.Vector3()).z>50,'Reused corpse stands and animates normally');actors.reset();assert.equal(actors.pool.length,1);
}
console.log('Ragdolls passed:',JSON.stringify({runs:report,solidWalls:true,invisibleClipsIgnored:true,nativeMapCollision:true,pooledSkeletonReset:true}));
