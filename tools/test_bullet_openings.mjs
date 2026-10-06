import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {BulletTrace,textureAlpha} from '../web/bullet-trace.js';
import {SoloGame} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
const solid=new THREE.MeshBasicMaterial(),matrix=new THREE.Matrix4();
// The same native-prop triangles are traced regardless of render instancing.
let bullets=new BulletTrace();
const bar=new THREE.BoxGeometry(2,1,8);
bullets.addInstances(bar,solid,[{matrix:matrix.clone().makeTranslation(10,-2,0)},{matrix:matrix.clone().makeTranslation(10,2,0)}]);
assert.equal(bullets.trace([0,0,0],[1,0,0],100),null,'The opening between bars admits a bullet');
assert(Math.abs(bullets.trace([0,2,0],[1,0,0],100).distance-9)<1e-6,'An actual bar blocks a bullet');
const door=new THREE.Mesh(new THREE.BoxGeometry(2,8,8),solid);door.position.x=5;const root=new THREE.Group();root.add(door);bullets.addRoot(root);
assert.equal(bullets.trace([0,0,0],[1,0,0],100).distance,4);
root.visible=false;assert.equal(bullets.trace([0,0,0],[1,0,0],100),null,'An opened/hidden object no longer blocks shots');
root.visible=true;root.position.y=20;assert.equal(bullets.trace([0,0,0],[1,0,0],100),null,'Moving doors/bridges update their bullet transform');
const boards=new BulletTrace();boards.addRoot(door,{penetrable:true});assert.equal(boards.trace([0,20,0],[1,0,0],100),null,'Window boards admit gunfire');
// A fence cutout hits its opaque texel, and admits the transparent texel.
const texture=new THREE.DataTexture(new Uint8Array([255,255,255,0,255,255,255,255]),2,1);texture.needsUpdate=true;
const panel=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({map:texture,alphaTest:.5}));panel.rotation.y=Math.PI/2;panel.position.x=10;
bullets=new BulletTrace();bullets.addRoot(panel);
assert.equal(bullets.trace([0,0,1],[1,0,0],100),null);assert(bullets.trace([0,0,-1],[1,0,0],100));
const dxt1=new THREE.CompressedTexture([{data:new Uint8Array([0,0,255,255,3,0,0,0]),width:4,height:4}],4,4,THREE.RGBA_S3TC_DXT1_Format);
assert.equal(textureAlpha(dxt1,new THREE.Vector2(.01,.01)),0);assert.equal(textureAlpha(dxt1,new THREE.Vector2(.3,.01)),1);
const dxt3=new THREE.CompressedTexture([{data:new Uint8Array([0xf0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]),width:4,height:4}],4,4,THREE.RGBA_S3TC_DXT3_Format);
assert.equal(textureAlpha(dxt3,new THREE.Vector2(.01,.01)),0);assert.equal(textureAlpha(dxt3,new THREE.Vector2(.3,.01)),1);
const dxt5=new THREE.CompressedTexture([{data:new Uint8Array([0,255,14,0,0,0,0,0,0,0,0,0,0,0,0,0]),width:4,height:4}],4,4,THREE.RGBA_S3TC_DXT5_Format);
assert.equal(textureAlpha(dxt5,new THREE.Vector2(.01,.01)),0);assert.equal(textureAlpha(dxt5,new THREE.Vector2(.3,.01)),1);

// Actual exported world triangles and intact original windows on both maps.
const report={};
for(const [id,zone,folder]of [['nacht','nazi_zombie_prototype','gameplay'],['der-riese','nazi_zombie_factory','gameplay/der-riese']]){
  const dir='local-data/'+id+'/web-world/',read=p=>JSON.parse(fs.readFileSync(p));
  const manifest=read('local-data/'+folder+'/manifest.json'),world=read(dir+zone+'.json');
  const collision=new CollisionWorld(read(dir+zone+'.collision.json'),manifest.entities),game=new SoloGame(manifest,collision,read(dir+zone+'.paths.json'));
  const vb=fs.readFileSync(dir+world.vertices),ib=fs.readFileSync(dir+world.indices),view=new DataView(vb.buffer,vb.byteOffset,vb.byteLength),indices=new Uint16Array(ib.buffer,ib.byteOffset,ib.byteLength/2),positions=new Float32Array(world.vertexCount*3),triangles=[];
  for(let i=0;i<world.vertexCount;i++)for(let k=0;k<3;k++)positions[i*3+k]=view.getFloat32(i*32+k*4,true);
  const submodels=new Set(world.brushModels.slice(1).flatMap(m=>Array.from({length:m.surfaceCount},(_,i)=>m.firstSurface+i)));
  world.surfaces.forEach((s,i)=>{if(submodels.has(i)||/^wc\/(shadowcaster|caulk|hdrportal|nodraw|clip|trigger|hint|skip|portal)/i.test(s.material))return;
    for(let k=0;k<s.triangleCount*3;k++)triangles.push(s.firstVertex+indices[s.baseIndex+k]);});
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(triangles);
  bullets=new BulletTrace();bullets.addGeometry(geometry,solid,new THREE.Matrix4());
  const window=game.availableWindows().find(w=>{
    const origin=[w.entry[0],w.entry[1],w.entry[2]+60],target=[w.outside[0],w.outside[1],w.outside[2]+62],d=new THREE.Vector3(...target).sub(new THREE.Vector3(...origin)),length=d.length();
    return collision.trace(origin,target,[0,0,0],1).fraction<1&&!bullets.trace(origin,d.normalize().toArray(),length);
  });
  assert(window,'An intact native barrier should be shootable on '+id);
  game.player.position=window.entry.slice();const enemy={id:1,health:500,stage:'approach',position:window.outside.slice(),dead:false};game.enemies=[enemy];
  const enemyTrace=(origin,dir,max)=>{
    const p=enemy.position,ray=new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(...dir)),box=new THREE.Box3(new THREE.Vector3(p[0]-8,p[1]-8,p[2]+58),new THREE.Vector3(p[0]+8,p[1]+8,p[2]+73)),point=ray.intersectBox(box,new THREE.Vector3());
    if(!point)return null;const distance=point.distanceTo(ray.origin);return distance<max?{enemy,head:true,distance}:null;
  };
  game.events.traceShot=(origin,dir,range)=>bullets.shot(origin,dir,range,enemyTrace);
  const d=enemy.position.map((v,k)=>v-game.player.position[k]+(k===2?2:0));game.aim(Math.atan2(d[1],d[0]),Math.atan2(d[2],Math.hypot(d[0],d[1])));
  game.start();game.ads=1;game.weapon.definition={...game.weapon.definition,adsSpread:0};assert(game.fire());assert(enemy.health<500,'A shot through the barrier must apply real damage');assert.equal(game.hits,1);assert.equal(collision.disabled.size,0);
  const origin=[...game.player.position];origin[2]+=60;const direction=new THREE.Vector3(...window.outside).add(new THREE.Vector3(0,0,62)).sub(new THREE.Vector3(...origin)).normalize();
  const cover=new THREE.Mesh(new THREE.BoxGeometry(16,100,100),solid);cover.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),direction);cover.position.fromArray(origin).addScaledVector(direction,30);bullets.addRoot(cover);
  const health=enemy.health;game.cooldown=0;assert(game.fire());assert.equal(enemy.health,health,'Solid cover still stops damage');
  report[id]={barrier:window.target,damage:500-health,solidCoverBlocks:true,movementCollisionRetained:true};
}
console.log('Bullet opening checks passed:',JSON.stringify(report));
