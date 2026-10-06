import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {DEFAULT_DIVE_CONFIG,configureDive,predictedDive,meters,normalizeDiveConfig} from '../web/dive-config.js';
import {divePresentation} from '../web/player-movement.js';
import {DiveAudio,contactSurfaceName} from '../web/dive-audio.js';
import {posePlayerBody} from '../web/player-body.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/bo1-kino/manifest.json'),presentation=await read('gameplay/bo1-kino/presentation.json'),native=new CollisionWorld(await read('bo1-kino/web-world/zombie_theater.collision.json'),manifest.entities),paths=await read('bo1-kino/web-world/zombie_theater.paths.json');
const events=[],fakeAudio={sounds:manifest.sounds,played:[],play(alias,volume,options){const record={alias,volume,options,stopped:false,stop(){this.stopped=true;},setVolume(v){this.volume=v;}};this.played.push(record);return record;}},audio=new DiveAudio(fakeAudio,manifest.diveAudio);
const g=new BlackOpsEngine(manifest,native,paths,{diveEvent:e=>{events.push(e);audio.handle(e);},contactSurface:()=> 'wood'},presentation);
const box=(mins,maxs)=>({mins,maxs,contents:1,planes:[]});
const arena=brushes=>new CollisionWorld({models:[{brushes:[]}],brushes},[]);
const flat=[box([-1000,-1000,-128],[3000,1000,0])];
const reset=(brushes=flat)=>{g.collision=native;g.newGame();g.start();g.roundDue=1e9;g.ambientDue=1e9;g.tickEnemy=()=>{};g.collision=arena(brushes);g.player.position=[0,0,0];g.player.previousPosition=[0,0,0];g.player.grounded=true;g.aim(0,0);audio.reset();fakeAudio.played.length=0;events.length=0;configureDive(g,DEFAULT_DIVE_CONFIG);};
const run=(time,hz=120,input={})=>{for(let i=0;i<Math.round(time*hz);i++)g.update(1/hz,input);};
const launch=hz=>{run(.5,hz,{forward:1,sprint:true});assert(g.changeStance('prone'));assert(g.dive);return g.dive;};
const reports=[],predicted=predictedDive();assert(Math.abs(predicted.totalDistanceMeters-3.3)<.03);assert(Math.abs(predicted.airSeconds-.42)<.01);
for(const hz of [30,60,120,240]){
  reset();const d=launch(hz),look=g.yaw;g.aim(Math.PI/2,.2);while(g.dive||g.diveRecovery){g.update(1/hz,{forward:1,sprint:true});if(g.dive?.phase==='air'){assert(Math.abs(g.player.position[1])<1e-6,'Camera rotation cannot steer a committed dive');assert(!g.fire());assert(!g.melee());assert(!g.throwGrenade());}}
  const report=g.lastDive;assert(Math.abs(report.peakRootRiseMeters-.45)<.002);assert(Math.abs(report.airborneSeconds-predicted.airSeconds)<.01);assert(Math.abs(report.finalStopDistanceMeters-predicted.totalDistanceMeters)<.02);assert.equal(report.launchEvents,1);assert.equal(report.landingEvents,1);assert.equal(g.player.health,100,'Flat-ground diving does not cause damage');assert.equal(g.player.stance,'prone');assert(report.movementReadySeconds<report.weaponReadySeconds);assert(Math.abs(report.weaponReadySeconds-report.airborneSeconds-.5)<.01);assert(Math.abs(report.movementReadySeconds-report.airborneSeconds-.35)<.01);
  assert.equal(fakeAudio.played.filter(s=>s.alias==='chr_launch_exert_plr').length,1);assert.equal(fakeAudio.played.filter(s=>s.alias==='chr_land_exert_plr').length,1);assert(fakeAudio.played.some(s=>s.alias==='fly_dtp_land_plr_wood'));assert(fakeAudio.played.some(s=>s.alias==='fly_dtp_land_plr_lfe'));const loop=fakeAudio.played.find(s=>s.alias==='fly_dtp_slide_loop_plr_wood');assert(loop?.stopped);assert.equal(audio.loops.size,0);
  assert.equal(g.yaw,Math.PI/2,'Camera presentation never writes permanent aim offsets');const neutral=divePresentation(g,g.time+1);assert.equal(neutral.cameraOffsetUnits,0);assert.equal(neutral.cameraPitchRadians,0);
  reports.push({hz,...report});
}
// Movement and weapon timers overlap. Finishing either does not cancel an
// unrelated reload/cooldown or enable weapons early.
reset();launch(120);while(g.dive?.phase==='air')g.update(1/120,{});const landed=g.dive.landingAt;g.reloadEnd=g.time+2;while(g.dive)g.update(1/120,{});assert(g.diveRecovery);assert(g.movementBlocked);assert(!g.fire());assert(g.changeStance('crouch'),'Movement-ready permits a new valid stance');while(g.diveRecovery)g.update(1/120,{});assert(g.reloadEnd>g.time,'Recovery leaves unrelated weapon locks intact');assert(!g.fire());
// Wall and ceiling contacts play collision foley, not premature landing grunts.
reset([...flat,box([170,-100,0],[180,100,400])]);launch(120);while(g.dive?.phase==='air'){g.update(1/120,{});if(events.some(e=>e.type==='collision')&&g.player.position[2]>1)assert(!events.some(e=>e.type==='landing'));}run(1);assert(g.lastDive.finalStopDistanceMeters<predicted.totalDistanceMeters);assert(g.player.position[0]<157);assert.equal(g.lastDive.landingEvents,1);assert(g.lastDive.collisionEvents>0);
reset([...flat,box([165,-100,44],[500,100,90])]);launch(120);run(2);assert(g.lastDive.collisionEvents>0);assert.equal(g.lastDive.landingEvents,1);assert(Number.isFinite(g.player.position[2]));
// Launch close to a ledge, then wait for the lower floor. No apex timer,
// fake landing, early weapon recovery or slide audio can end the fall.
reset([box([-1000,-1000,-128],[165,1000,0]),box([170,-1000,-200],[2000,1000,-120])]);launch(120);run(.5);assert.equal(g.dive?.phase,'air');assert.equal(events.filter(e=>e.type==='landing').length,0);assert.equal(g.diveRecovery,null);while(g.dive||g.diveRecovery)g.update(1/120,{});assert(g.lastDive.airborneSeconds>predicted.airSeconds+.15);assert.equal(g.lastDive.landingEvents,1);
// Capture actual horizontal sprint direction, not an already rotated view.
reset();run(.5,120,{forward:1,side:1,sprint:true});g.aim(Math.PI/2,0);g.changeStance('prone');assert(g.dive.velocity[0]>0&&g.dive.velocity[1]<0);const before=g.player.position.slice();run(.05);assert(g.player.position[0]>before[0]&&g.player.position[1]<before[1]);
reset();launch(120);g.damagePlayer(25);assert.equal(g.player.health,75,'Normal damage reception stays active');const d=g.dive;assert(!g.changeStance('prone'));assert.equal(g.dive,d);assert.equal(events.filter(e=>e.type==='launch').length,1,'Held/repeated stance does not restart the dive');
// Profile values are bounded; invalid input cannot corrupt movement.
assert.equal(normalizeDiveConfig({rootRiseMeters:Infinity}).rootRiseMeters,.45);assert.equal(normalizeDiveConfig({slideSeconds:-1}).slideSeconds,.02);reset();configureDive(g,{rootRiseMeters:.3,launchSpeedMps:5});launch(120);run(2);assert(Math.abs(g.lastDive.peakRootRiseMeters-.3)<.002);assert(g.lastDive.finalStopDistanceMeters<3);
// Event identities prevent local prediction/replication duplicates, and the
// original nonverbal takes do not immediately repeat.
audio.reset();fakeAudio.played.length=0;const event={type:'launch',id:1,session:99,sequence:0,position:[0,0,0],character:0,config:DEFAULT_DIVE_CONFIG};audio.handle(event);audio.handle(event);assert.equal(fakeAudio.played.filter(s=>s.alias==='chr_launch_exert_plr').length,1);const takes=[];for(let i=2;i<10;i++){audio.handle({...event,id:i});takes.push(fakeAudio.played.filter(s=>s.alias==='chr_launch_exert_plr').at(-1).options.variant);}for(let i=1;i<takes.length;i++)assert.notEqual(takes[i],takes[i-1]);audio.handle({...event,id:10,playerId:'remote'},{local:false});assert(fakeAudio.played.findLast(s=>s.alias==='chr_launch_exert_npc').options.position);audio.reset();assert.equal(audio.loops.size,0);
for(const material of ['metal','wood','dirt','concrete'])assert.equal(contactSurfaceName({texture:'assets/'+material+'_floor.dds'}),material);
for(const alias of ['chr_launch_exert_plr','chr_land_exert_plr','fly_dtp_launch_plr','fly_dtp_collide_plr','fly_dtp_land_plr_concrete','fly_dtp_land_plr_metal','fly_dtp_land_plr_wood','fly_dtp_land_plr_dirt','fly_dtp_slide_loop_plr_default']){assert(manifest.sounds[alias]?.length);for(const entry of manifest.sounds[alias]){const bytes=await readFile(new URL('../local-data/'+entry.url.slice(6),import.meta.url));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');}}
// Pose the installed skeletons, retaining their bind axes and bone lengths.
const bodyPoses=[];
for(const definition of manifest.playerBodies){
  const bytes=await readFile(new URL('../local-data/bo1-kino/model_export/'+definition.body+'_lod0.glb',import.meta.url)),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),joints=new Set(json.skins.flatMap(s=>s.joints)),nodes=json.nodes.map((n,i)=>{const b=joints.has(i)?new THREE.Bone():new THREE.Group();b.name=n.name||'';if(n.translation)b.position.fromArray(n.translation);if(n.rotation)b.quaternion.fromArray(n.rotation);if(n.scale)b.scale.fromArray(n.scale);return b;});json.nodes.forEach((n,i)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));
  const object=new THREE.Group();object.rotation.x=Math.PI/2;for(const i of json.scenes[json.scene||0].nodes)object.add(nodes[i]);const root=new THREE.Group(),pivot=new THREE.Group();root.add(pivot);pivot.add(object);root.updateMatrixWorld(true);const rest=new Map();object.traverse(b=>{if(b.isBone)rest.set(b,{position:b.position.clone(),quaternion:b.quaternion.clone(),scale:b.scale.clone()});});const corners=[];for(let i=0;i<8;i++)corners.push(new THREE.Vector3(i&1?16:-12,i&2?36:-36,i&4?75:0));const rig={root,pivot,object,rest,corners,neckHeight:object.getObjectByName('j_neck').getWorldPosition(new THREE.Vector3()).z};
  reset();launch(120);run(.15);posePlayerBody(rig,g,divePresentation(g),g.player.position);assert(Math.abs(pivot.rotation.y-Math.PI/2)<.01);for(const side of ['le','ri']){const foot=object.getObjectByName('j_ankle_'+side).getWorldPosition(new THREE.Vector3());assert(foot.z>0,'Character feet visibly leave the floor');}const head=object.getObjectByName('j_head').getWorldPosition(new THREE.Vector3());assert(head.z>0);const first=object.getObjectByName('j_wrist_ri').getWorldPosition(new THREE.Vector3());posePlayerBody(rig,g,divePresentation(g),g.player.position);assert(first.distanceTo(object.getObjectByName('j_wrist_ri').getWorldPosition(new THREE.Vector3()))<1e-6,'Body pose never accumulates transforms');bodyPoses.push({character:definition.name,bones:rest.size,headHeight:meters(head.z)});
}
await writeFile(new URL('../local-data/dive-verification.json',import.meta.url),JSON.stringify({predicted,reports,bodyPoses},null,2));
console.log('Dive specification passed:',JSON.stringify({predicted,rates:reports.map(r=>({hz:r.hz,rise:r.peakRootRiseMeters,distance:r.finalStopDistanceMeters,air:r.airborneSeconds,movementReady:r.movementReadySeconds,weaponReady:r.weaponReadySeconds})),bodyPoses,groundContactEvents:true,ledgeFall:true,separateRecovery:true,surfaceAudio:true,noDuplicateGrunts:true,configurable:true}));
