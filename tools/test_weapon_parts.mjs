import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {originalAnimation} from '../web/assets.js';
import {WeaponView} from '../web/weapon-view.js';

const dataRoot=new URL('../local-data/',import.meta.url);
const read=p=>JSON.parse(fs.readFileSync(new URL(p,dataRoot)));
const manifest=read('gameplay/manifest.json');
globalThis.location=new URL('http://weapon-test.local/');
globalThis.fetch=async url=>{
  try{return new Response(fs.readFileSync(new URL(String(url).replace(/^\/data\//,''),dataRoot)));}
  catch{return new Response('',{status:404});}
};
function nativeSkeleton(name,relative){
  let bytes;
  for(const zone of ['nacht','common'])try{bytes=fs.readFileSync(new URL(`${zone}/model_export/${name}_lod0.glb`,dataRoot));break;}catch{}
  assert(bytes,`Missing native model ${name}`);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),joints=new Set(gltf.skins.flatMap(s=>s.joints));
  const nodes=gltf.nodes.map((n,i)=>{const bone=joints.has(i)?new THREE.Bone():new THREE.Group();bone.name=n.name||'';if(n.translation)bone.position.fromArray(n.translation);if(n.rotation)bone.quaternion.fromArray(n.rotation);if(n.scale)bone.scale.fromArray(n.scale);if(relative&&bone.isBone)bone.userData.animationTranslationBase=bone.position.toArray();return bone;});
  gltf.nodes.forEach((n,i)=>n.children?.forEach(j=>nodes[i].add(nodes[j])));
  const root=new THREE.Group();root.rotation.x=Math.PI/2;gltf.scenes[gltf.scene||0].nodes.forEach(i=>root.add(nodes[i]));return root;
}
const d=manifest.weapons.zombie_colt,object=nativeSkeleton('viewmodel_hands',false),gun=nativeSkeleton(d.gunModel,true);object.getObjectByName('tag_weapon').add(gun);
const clips=new Map();for(const name of new Set(Object.entries(d).filter(([key,value])=>key.endsWith('Anim')&&value).map(([,v])=>v)))clips.set(name,await originalAnimation(name,object));
const scene=new THREE.Scene(),view=new WeaponView(scene,{play(){}}),weapon={name:'zombie_colt',definition:d,clip:8},rig={object,root:new THREE.Group(),mixer:new THREE.AnimationMixer(object),clips,adsAction:null,knife:new THREE.Group(),flash:new THREE.Group()};rig.root.add(object);view.activate(rig,weapon);
const bolt=gun.getObjectByName('j_bolt'),mag=gun.getObjectByName('j_clip'),base=bolt.userData.animationTranslationBase,magBase=mag.userData.animationTranslationBase;
const step=seconds=>{for(let i=0;i<Math.round(seconds*240);i++)view.update(1/240,{ads:0,moving:false,sprinting:false,time:i/240,reloading:false});};
const near=(a,b,tolerance=.002)=>assert(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
// Native recoil must move the slide back along the barrel while preserving
// its height above the frame. Absolute-track application detaches it instead.
view.shot(0);step(1/24);assert(bolt.position.x<base[0]-.7);near(bolt.position.y,base[1]);assert(Math.abs(bolt.position.z-base[2])<.04);
step(.4);bolt.position.toArray().forEach((v,i)=>near(v,base[i]));
weapon.clip=0;view.shot(0);step(.4);assert.equal(view.current.getClip().name,d.emptyIdleAnim);near(bolt.position.x,base[0]-2.154507637);near(bolt.position.y,base[1]);near(bolt.position.z,base[2]-.004940271);
view.reload({empty:true,duration:d.reloadEmptyTime});step(d.reloadEmptyTime+.1);assert.equal(view.current.getClip().name,d.emptyIdleAnim);weapon.clip=8;step(.1);assert.equal(view.current.getClip().name,d.idleAnim);bolt.position.toArray().forEach((v,i)=>near(v,base[i]));mag.position.toArray().forEach((v,i)=>near(v,magBase[i]));
// A rapid magazine followed by reload/re-activation must not retain a moved
// slide or magazine from the previous clip's sparse tracks.
for(let round=0;round<3;round++){
  for(let i=7;i>=0;i--){weapon.clip=i;view.shot(0);step(.1);}
  step(.3);near(bolt.position.x,base[0]-2.154507637);
  weapon.clip=8;view.activate(rig,weapon);step(.1);bolt.position.toArray().forEach((v,i)=>near(v,base[i]));
}
const report={model:d.gunModel,bindSlide:base,emptySlideOffset:-2.154507637,rapidMagazines:3,animations:clips.size};
fs.writeFileSync(new URL('colt-parts-verification.json',dataRoot),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
