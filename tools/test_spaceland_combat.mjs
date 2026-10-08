import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {NativeActor,rigGeometry,sampleKeys,iwHealth,iwRoundCount,iwSpawnDelay,iwMoveMode,nativeStrideSpeed} from '../web/iw7-native.js';
import {combatClips} from '../web/iw7-combat.js';
import {SpacelandMatch} from '../web/iw7-match.js';
import {ParkNavigation} from '../web/iw7-navigation.js';
import {SpacelandAudio} from '../web/iw7-audio.js';

const base=new URL('../local-data/gameplay/iw7-spaceland/',import.meta.url),data=JSON.parse(await readFile(new URL('combat.json',base),'utf8'));
const clips=new Map();for(const c of data.characters)for(const name of combatClips(c)){
  assert(data.animations[name],`Original clip missing: ${name}`);if(clips.has(name))continue;const d=data.animations[name],raw=await readFile(new URL(d.url,base));assert.equal(raw.length,d.bytes);const clip=JSON.parse(raw);assert.equal(clip.name,name);assert(clip.duration>=0&&Object.keys(clip.bones).length>0);for(const bone of Object.values(clip.bones))for(const keys of Object.values(bone)){assert(keys.flat().every(Number.isFinite));assert(keys.every((k,i)=>k[0]>=0&&k[0]<=clip.frames&&(i===0||k[0]>=keys[i-1][0])));}clips.set(name,clip);
}
assert(Object.keys(data.animations).length>=800);assert.equal(data.weapon.clip,8);assert.equal(data.rifle.clip,10);assert.equal(data.weapon.headMultiplier,3.5);
const q=new THREE.Quaternion();sampleKeys([[0,0,0,0,1],[30,0,0,1,0]],15,q,true);assert(Math.abs(q.z-Math.SQRT1_2)<1e-6,'Quaternion interpolation must preserve both endpoints');
const materials=new Map(Object.keys(data.materials).map(id=>[id,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})]));
for(const name of [...data.zombies,...data.characters.map(c=>c.arms),data.weapon.model,data.rifle.model,'zmb_card_01','tactical_knife_iw7_vm']){
  const d=data.rigs[name],raw=await readFile(new URL(d.url,base));assert.equal(raw.length,d.bytes);const buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),g=rigGeometry(buffer,d),j=new Uint16Array(buffer,16+d.vertices*32,d.vertices*8),w=new Float32Array(buffer,16+d.vertices*48,d.vertices*8);assert(j.every(v=>v<d.bones.length));assert(w.every(Number.isFinite));for(let v=0;v<d.vertices;v++)assert(Math.abs(w.subarray(v*8,v*8+8).reduce((a,b)=>a+b,0)-1)<.0001);for(const group of d.groups)assert(materials.has(group.material));
  const gun=[data.weapon.model,data.rifle.model].includes(name),actor=new NativeActor(d,g,materials,{relativePositions:gun});actor.root.updateMatrixWorld(true);actor.skeleton.update();
  if(data.zombies.includes(name)){
    assert(d.vertices>15000);assert(d.bounds[1][2]>70);assert(d.bones.some(b=>b.name==='j_head'));actor.play(clips.get('iw7_cp_zom_walk_forward_01'),{loop:true,blend:0});
    for(const time of [0,.5,1,1.5,2]){actor.time=time;actor.update(0);const head=actor.named.get('j_head').getWorldPosition(new THREE.Vector3());assert(head.z>45&&head.z<85,`NPC translated root must retain bind height: ${name} ${head.z}`);assert(head.toArray().every(Number.isFinite));}
  }else if(data.characters.some(c=>c.arms===name)){actor.play(clips.get('vm_g18_idle'),{loop:true,blend:0});actor.update(0);const gun=actor.named.get('tag_weapon').getWorldPosition(new THREE.Vector3());assert(gun.z>40&&gun.z<75);}
  else if(gun){const clip=clips.get(name===data.rifle.model?'vm_m1_idle':'vm_g18_idle');actor.play(clip,{loop:true,blend:0});actor.update(0);if(name===data.rifle.model)assert(Math.abs(actor.named.get('j_mag1').position.z-1.0033)<.01,'Native M1 magazine offsets must retain the gun bind translation');}
  actor.dispose();g.dispose();
}
assert.deepEqual([1,2,3,9,10].map(iwHealth),[150,250,350,950,1045]);assert.deepEqual([1,2,3,4,5,6].map(r=>iwRoundCount(r)),[6,8,13,18,24,27]);assert.equal(iwRoundCount(30),105);assert.equal(iwSpawnDelay(1),2);
assert.equal(iwMoveMode(1,()=>.99),'slow_walk');assert.equal(iwMoveMode(2,()=>0),'slow_walk');assert.equal(iwMoveMode(2,()=>.99),'walk');assert.equal(iwMoveMode(6,()=>.99),'run');assert.equal(iwMoveMode(12,()=>.99),'sprint');assert.equal(iwMoveMode(20,()=>0),'sprint');
for(const [name,clip]of clips)if(/^iw7_cp_zom_(shamble|walk|run|sprint)_forward/.test(name))assert(nativeStrideSpeed(clip)>10&&nativeStrideSpeed(clip)<350,`Original root-motion speed: ${name}`);
const score=[];let ended=0;const match=new SpacelandMatch(data,{spawn:v=>({...v,position:[0,100,0],entering:false}),score:v=>score.push(v),round:()=>ended++,wallTrace:()=>null});
match.begin();for(let i=0;i<121;i++)match.step(1/60);assert.equal(match.round,1);
for(let round=1;round<=3;round++){
  for(let guard=0;guard<20000&&match.round===round;guard++){match.step(1/60);for(const z of match.enemies)if(!z.dead)match.damage(z,iwHealth(round),true);}
  assert.equal(match.round,round+1);assert(match.phase==='active');
}
assert.equal(match.kills,6+8+13);assert(score.length>=27);assert(ended>=7);
const shooting=new SpacelandMatch(data,{wallTrace:()=>null});shooting.begin();shooting.step(2.01);shooting.enemies=[{position:[0,100,0],health:150,dead:false},{position:[0,150,0],health:150,dead:false}];
assert(shooting.fire([0,0,64],[0,1,0],true));assert.equal(shooting.enemies[0].health,80);assert.equal(shooting.enemies[1].health,91,'A lined-up second zombie must receive collateral damage');
shooting.enemies=[];for(let i=0;i<7;i++){shooting.step(.1);shooting.fire([0,0,64],[0,1,0]);}assert.equal(shooting.weapon.clip,0);shooting.step(.1);assert(shooting.reload,'Empty magazine triggers automatic reload');shooting.step(1.41);assert.equal(shooting.weapon.clip,8);assert.equal(shooting.weapon.reserve,24);shooting.step(1.1);assert.equal(shooting.reload,null);
shooting.enemies=[{position:[0,70,0],health:150,dead:false}];assert(shooting.knife([0,0,60],[0,1,0]));shooting.step(.23);assert(shooting.enemies[0].dead);assert.equal(shooting.kills,1);shooting.step(1);assert(shooting.buyM1());assert.equal(shooting.weapon.definition.native,'iw7_m1c_zm');shooting.switchWeapon();assert.equal(shooting.weapon.definition.native,'iw7_g18_zmr');
shooting.hurt(40);shooting.step(6);assert.equal(shooting.health,100);shooting.hurt(100);assert(shooting.over);shooting.reset();assert.equal(shooting.round,0);assert.equal(shooting.health,100);assert.equal(shooting.inventory.length,1);
const blocked=new SpacelandMatch(data,{wallTrace:()=>({distance:50})});blocked.begin();blocked.step(2.1);blocked.enemies=[{position:[0,100,0],health:150}];blocked.fire([0,0,64],[0,1,0]);assert.equal(blocked.enemies[0].health,150,'Solid world geometry must occlude bullets');
// A wall with a gap: the shared flow must route around it, not cut through it.
const flat=(o,d,range)=>{if(d[2]<0){const distance=-o[2]/d[2];return distance>=0&&distance<range?{distance,normal:[0,0,1]}:null;}if(Math.abs(d[0])>0){const distance=(128-o[0])/d[0],y=o[1]+d[1]*distance;if(distance>=0&&distance<range&&Math.abs(y)<160)return {distance,normal:[-Math.sign(d[0]),0,0]};}return null;};
const nav=new ParkNavigation(flat);nav.begin([0,0,0]);while(nav.pending)nav.work(50);assert(nav.flow.size>100);assert(!nav.connected(nav.cell(1,0,0),nav.cell(3,0,0)));assert(nav.flow.has(nav.cell(4,0,0).key),'Flow must find the opening around the wall');assert(nav.spawns([0,0,0],[{origin:[500,500,0]}]).length>0);
const sounds=JSON.parse(await readFile(new URL('sounds.json',base),'utf8'));for(const name of ['weap_g18_fire_plr','mus_zombies_newwave','mus_zombies_endwave','wondercard_nerd_use_gesture'])assert(sounds[name]);for(const d of new Map(Object.values(sounds).flat().map(d=>[d.url,d])).values()){const raw=await readFile(new URL(d.url,base));assert.equal(raw.length,d.bytes);assert.equal(raw.subarray(0,4).toString(),'OggS');}
const audio=new SpacelandAudio();audio.context={destination:{},createBufferSource:()=>({connect(){},disconnect(){},start(){},stop(){this.onended?.();}}),createGain:()=>({gain:{value:0},connect(){},disconnect(){}})};audio.aliases={zmb_walk:[{url:'step',volume:1}],shot:[{url:'shot',volume:1}]};audio.buffers.set('step',{});audio.buffers.set('shot',{});for(let i=0;i<32;i++)audio.play('zmb_walk');assert.equal(audio.voices.size,8,'Footsteps must leave room for gunfire');for(let i=0;i<25;i++)audio.play('shot');assert.equal(audio.voices.size,32);assert([...audio.voices].some(s=>audio.voiceNames.get(s)==='shot'));audio.stop();assert.equal(audio.voices.size,0);
console.log('IW7 combat: original rigs/skin weights/clip keys, NPC bind-height and VM poses, three rounds, health/count scaling, headshots/collaterals, occlusion, automatic reload, knife, M1 purchase/switch, regeneration/death/reset, obstacle navigation and native sound files passed.');
