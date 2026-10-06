import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import {SoloGame} from '../web/game.js';
import {BulletTrace} from '../web/bullet-trace.js';
import {ZombieHitTrace} from '../web/zombie-hit-trace.js';
import {damageAtRange,hitDamage,rayCapsule,raySphere} from '../web/ballistics.js';
const read=async file=>JSON.parse(await readFile(new URL('../local-data/'+file,import.meta.url),'utf8'));
const report={weapons:0,round3Shotguns:[],collaterals:[],rangeFloors:[]};
assert.equal(raySphere([0,0,0],[1,0,0],[10,0,0],2),8);
assert.equal(raySphere([0,3,0],[1,0,0],[10,0,0],2),null);
assert.equal(rayCapsule([0,0,5],[1,0,0],[10,0,0],[10,0,10],2),8);
assert.equal(rayCapsule([10,0,-5],[0,0,1],[10,0,0],[10,0,10],2),3);
assert.equal(damageAtRange({damage:100,minDamage:20,maxDamageRange:0,minDamageRange:100},50),60);
assert.equal(damageAtRange({damage:100,minDamage:20,maxDamageRange:100,minDamageRange:200},10000),20);
assert.equal(hitDamage({damage:50,minDamage:50},100,false),50,'Missing legacy hit multipliers cannot zero the damage');

for(const [map,folder,rifle]of [['nacht','gameplay','kar98k'],['der-riese','gameplay/der-riese','zombie_kar98k'],['kino','gameplay/bo1-kino','m14_zm']]){
  const native=await read(folder+'/manifest.json');
  const collision={disabled:new Set(),move:p=>({position:p.slice(),grounded:true}),trace:(a,b)=>({fraction:1,normal:[0,0,1],end:b})};
  const manifest={...native,map:null,entities:[{targetname:'initial_spawn_points',origin:'0 0 0',angles:'0 0 0'}]};
  let world=new BulletTrace(),actors=[];
  const g=new SoloGame(manifest,collision,{nodes:[]},{traceShot:(origin,dir,range)=>world.shot(origin,dir,range,(origin,dir,max)=>{
    const ray=new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(...dir)),hits=[];
    for(const actor of actors){if(actor.enemy.dead)continue;const hit=actor.trace.trace(ray,max,g.physicsTicks);if(hit)hits.push({enemy:actor.enemy,head:hit.head,distance:hit.distance});}
    return hits;
  })});
  const enemy=(x,health=5000)=>{
    const root=new THREE.Group();root.position.x=x;
    for(const [name,z]of [['j_spinelower',24],['j_spineupper',48],['j_head',67]]){const bone=new THREE.Bone();bone.name=name;bone.position.z=z;root.add(bone);}
    root.updateMatrixWorld(true);const enemy={id:actors.length+1,position:[x,0,0],health,dead:false,stage:'approach'};
    const actor={root,enemy,trace:new ZombieHitTrace(root)};actors.push(actor);g.enemies.push(enemy);return actor;
  };
  const reset=name=>{g.newGame();actors=[];world=new BulletTrace();g.start();g.phase='round';g.round=3;g.remaining=0;g.inventory=[g.makeWeapon(name)];g.slot=0;g.ads=1;g.aim(0,0);};
  for(const [name,d]of Object.entries(native.weapons)){
    report.weapons++;
    if(d.weaponType!=='bullet')continue;
    assert.equal(damageAtRange(d,d.maxDamageRange),d.damage,name+' close damage');
    assert.equal(damageAtRange(d,d.minDamageRange+500),d.minDamage,name+' far floor');
    assert(Number.isFinite(hitDamage(d,16000,true))&&hitDamage(d,16000,true)>0,name+' far head damage');
    if(d.shotCount<=1)continue;
    for(let rotation=0;rotation<12;rotation++){
      reset(name);const target=enemy(150,350);g.aim(0,Math.atan2(7,150));
      const original=Math.random;Math.random=()=>rotation/12;
      try{assert(g.fire());}finally{Math.random=original;}
      assert(target.enemy.dead,`${map} ${name}: aimed close shotgun blast must kill a round-3 zombie, rotation ${rotation}`);
    }
    report.round3Shotguns.push({map,name,distance:150,rotations:12});
  }
  reset(rifle);g.weapon.definition={...g.weapon.definition,adsSpread:0};enemy(100);enemy(200);enemy(300);g.aim(0,Math.atan2(7,200));assert(g.fire());
  assert(g.enemies.every(e=>e.health<5000),map+' rifles damage multiple living zombies in one shot');assert.equal(g.shots,1);assert.equal(g.weapon.clip,native.weapons[rifle].clipSize-1);
  report.collaterals.push({map,weapon:rifle,damage:g.enemies.map(e=>5000-e.health)});
  // A solid wall between living zombies stops the rest of the bullet path.
  reset(rifle);g.weapon.definition={...g.weapon.definition,adsSpread:0};const front=enemy(100),back=enemy(300);
  const cover=new THREE.Mesh(new THREE.BoxGeometry(8,200,200),new THREE.MeshBasicMaterial());cover.position.set(200,0,60);world.addRoot(cover);assert(g.fire());assert(front.enemy.health<5000);assert.equal(back.enemy.health,5000);
  // Visible models behind a distant head still receive the native minimum damage.
  reset(rifle);g.weapon.definition={...g.weapon.definition,adsSpread:0};const far=enemy(4000);g.aim(0,Math.atan2(7,4000));assert(g.fire());assert(far.enemy.health<5000);report.rangeFloors.push({map,weapon:rifle,damage:5000-far.enemy.health});
  far.root.position.x=4500;far.root.updateMatrixWorld(true);far.trace.tick=-1;
  const hit=far.trace.trace(new THREE.Ray(new THREE.Vector3(0,0,67),new THREE.Vector3(1,0,0)),5000,1);assert(Math.abs(hit.distance-4491)<1e-5,'Animated bone combat volumes remain valid after movement at long range');
}
await writeFile(new URL('../local-data/ballistics-verification.json',import.meta.url),JSON.stringify(report,null,2));
console.log('Ballistics passed:',JSON.stringify({weapons:report.weapons,shotguns:report.round3Shotguns.length,closeHeadshotRotations:report.round3Shotguns.length*12,collaterals:report.collaterals,rangeFloors:report.rangeFloors,solidCoverBlocks:true}));
