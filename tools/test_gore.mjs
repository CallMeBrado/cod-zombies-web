import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {BloodEffects,SeveredHead} from '../web/gore.js';
import {SkeletonRagdoll} from '../web/ragdoll.js';
import {ZombieActors} from '../web/actors.js';
import {ZombieHitTrace} from '../web/zombie-hit-trace.js';
import {CollisionWorld} from '../web/collision.js';
import {BulletTrace} from '../web/bullet-trace.js';
import {SoloGame} from '../web/game.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {MAPS,BO1_MAPS} from '../web/maps.js';
import {nativeActor} from './native_actor_fixture.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const box=(mins,maxs,contents=1)=>({mins,maxs,contents,planes:[]}),arena=extra=>new CollisionWorld({models:[{brushes:[]}],brushes:[box([-1000,-1000,-128],[1000,1000,0]),...extra]},[]);
let reference;for(const hz of [30,60,240]){
  const root=new THREE.Group(),head=new SeveredHead(root),world=arena([]);head.start([0,0,65],[1,0,0],4);for(let f=0;f<hz*4.5;f++)head.update(1/hz,world);
  assert(head.sleeping);assert(head.p.z>=8);assert(head.p.x>25,'Detached head moves independently');assert(head.p.z<10,'Detached head lands on the floor');if(reference)assert(head.p.distanceTo(reference)<1e-6,'Detached-head physics is independent of FPS');else reference=head.p.clone();head.reset();assert(!head.active);
}
for(const contents of [1,0x10000]){const root=new THREE.Group(),head=new SeveredHead(root),world=arena([box([30,-100,0],[40,100,160],contents)]);head.start([0,0,65],[1,0,0]);for(let i=0;i<240;i++)head.update(1/60,world);if(contents===1)assert(head.p.x+8<=30.1,'Head cannot fly through solid cover');else assert(head.p.x>40,'Invisible movement clips do not catch detached heads');}

for(const map of [...MAPS,...BO1_MAPS].filter(m=>m.engine!=='dead-ops')){
  const m=await read(map.data+'/manifest.json'),presentation=await read(map.data+'/presentation.json');for(const url of [presentation.gore.burst,presentation.gore.drops,...presentation.gore.decals])assert((await readFile(new URL('../local-data/'+url.slice(6),import.meta.url))).toString('ascii',0,4)==='DDS ','Native gore texture exists');
  assert(m.sounds[presentation.gore.headSound]?.length,'Native head-gib sound is prepared');for(const entry of m.sounds[presentation.gore.headSound]){const sound=await readFile(new URL('../local-data/'+entry.url.slice(6),import.meta.url));assert.equal(sound.toString('ascii',0,4),'RIFF');assert.equal(sound.toString('ascii',8,12),'WAVE');}
  const collision=new CollisionWorld(await read(map.zone+'/web-world/'+map.asset+'.collision.json'),m.entities),scene=new THREE.Scene(),actors=new ZombieActors(scene,{illumination:()=>[1,1,1]},presentation);actors.collision=collision;
  const fixture=await nativeActor(map,presentation),slot={...fixture,mixer:new THREE.AnimationMixer(fixture.object),actions:new Map(),materials:[],trace:new ZombieHitTrace(fixture.root),ragdoll:new SkeletonRagdoll(fixture.root),headFragment:new SeveredHead(new THREE.Group())};actors.pool.push(slot);
  assert(slot.trace.meshes.every(({mesh})=>!mesh.userData.goreOnly),'Hidden neck geometry must not change living hit detection');
  const g=new (map.game==='black-ops'?BlackOpsEngine:SoloGame)(m,collision,await read(map.zone+'/web-world/'+map.asset+'.paths.json'),{kill:e=>actors.kill(e,[1,0,0])},presentation),enemy={id:1,position:g.player.position.slice(),angle:0,speed:57,stage:'approach',health:350,dead:false};actors.acquire(enemy);
  g.hitEnemy(enemy,50,true);assert(!enemy.dead);assert(!slot.headFragment.active);assert.equal(slot.headModel.parent,slot.headMount,'Nonlethal hit leaves the head attached');
  g.hitEnemy(enemy,300,true);assert(enemy.deathHeadshot);assert.equal(g.player.headshots,1);assert.equal(slot.headModel.parent,slot.headFragment.root,'Lethal headshot physically detaches the native head model');assert(slot.neckModel.visible,'Original gore stump becomes visible');assert(slot.ragdoll.byName.get('j_head').disabled,'Body no longer simulates attached-head mass');
  const localHead=slot.headModel.getObjectByName('j_head'),before=localHead.getWorldPosition(new THREE.Vector3());for(let i=0;i<180;i++)actors.updateOne(slot,1/60,enemy.position);
  assert(localHead.getWorldPosition(new THREE.Vector3()).distanceTo(before)>20,'Head travels and falls instead of following body ragdoll');assert(slot.headFragment.p.z>g.player.position[2]-72,'Original map collision catches the head');
  const geometries=[];slot.root.traverse(n=>{if(n.isMesh)geometries.push(n.geometry);});slot.headModel.traverse(n=>{if(n.isMesh)geometries.push(n.geometry);});actors.release(enemy.id);assert.equal(scene.children.length,0,'Corpse cleanup also removes the detached head');
  const living={...enemy,id:2,dead:false,deathHeadshot:false,health:350};actors.acquire(living);assert.equal(slot.headModel.parent,slot.headMount);assert(!slot.neckModel.visible);assert(!slot.headFragment.active);assert(!slot.ragdoll.byName.get('j_head').disabled);assert(geometries.every(geo=>{let present=false;slot.root.traverse(n=>{present||=n.geometry===geo;});return present;}),'Recycling uses the original geometry');
  g.hitEnemy(living,350,false);assert(!living.deathHeadshot);assert(!slot.headFragment.active,'Body kill does not sever head');actors.reset();
  console.log(map.id+': native head separation, gore stump, body/head physics, hit classification and pooled reset passed.');
}

const scene=new THREE.Scene(),blood=new BloodEffects(scene);blood.ready=true;const world=new BulletTrace(),floor=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})),wall=new THREE.Mesh(new THREE.BoxGeometry(4,200,200),new THREE.MeshBasicMaterial());wall.position.set(100,0,60);world.addRoot(floor);world.addRoot(wall);blood.trace=(o,d,max)=>world.trace(o,d,max);
blood.burst([0,0,60],[1,0,0],0);blood.update(.01);const decals=blood.decals.flatMap(b=>b.slots.map((s,i)=>({s,p:new THREE.Vector3().fromBufferAttribute(b.mesh.geometry.attributes.center,i)}))).filter(({s})=>s.due>0);assert.equal(decals.length,2);assert(decals.some(({p})=>p.z<.2),'Blood splat lies on the floor');assert(decals.some(({p})=>p.x>97&&p.x<99),'Blood splat lies on the solid wall behind the hit');assert(blood.sprays.mesh.visible&&blood.drops.mesh.visible);
const resources=scene.children.map(n=>[n.geometry,n.material]);for(let i=0;i<1000;i++){blood.burst([0,0,60],[1,0,0],i*.02,i%10===0);blood.update(i*.02);}assert.equal(scene.children.length,5);assert(scene.children.every((n,i)=>n.geometry===resources[i][0]&&n.material===resources[i][1]),'Repeated gore does not allocate more GPU objects');blood.update(100);assert(scene.children.every(n=>!n.visible),'Sprays and decals expire');blood.reset();assert(scene.children.every(n=>n.geometry.attributes.opacity.array.every(x=>x===0)),'Restart clears every pooled blood effect');
console.log('Gore passed: 30–240 FPS, solid cover, native models/textures, per-game headshots, surface splats, 1,000 bursts with five fixed GPU batches and corpse cleanup.');
