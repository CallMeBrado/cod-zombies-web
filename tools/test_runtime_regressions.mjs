import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
import {CombatEffects} from '../web/combat-effects.js';
import {PosedTrace} from '../web/posed-trace.js';
import {roundIndicatorState,ROUND_RED} from '../web/round-hud.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const manifest=read('gameplay/manifest.json'),data=read('nacht/web-world/nazi_zombie_prototype.collision.json'),paths=read('nacht/web-world/nazi_zombie_prototype.paths.json'),presentation=read('gameplay/presentation.json');
const create=events=>new SoloGame(manifest,new CollisionWorld(data,manifest.entities),paths,events,presentation);
const advance=(game,seconds,input={})=>{for(let i=0;i<Math.round(seconds*240);i++)game.update(1/240,input);};
const report={};
let game=create();game.start();game.roundDue=1e6;advance(game,.1,{forward:1,sprint:true});assert(game.sprinting);
const clip=game.weapon.clip,exit=game.weapon.definition.sprintOutTime;assert.equal(game.fire(),false);assert(game.pendingFire);assert.equal(game.weapon.clip,clip);
advance(game,exit-1/120,{forward:1,sprint:true});assert.equal(game.shots,0);assert(!game.sprinting);
advance(game,2/120,{forward:1,sprint:true});assert.equal(game.shots,1);assert.equal(game.weapon.clip,clip-1);
game.cooldown=0;game.sprinting=true;game.fire();game.giveWeapon('thompson');advance(game,.5);assert.equal(game.shots,1,'Switching weapons cancels a queued shot');
report.sprintFire={delay:exit,oneShot:true,switchCancels:true};

// Every available original spawn/window route must reach its barrier on actual
// uneven terrain, without interpolating through objects or getting stuck.
game=create();game.prepareSpawnPaths();const routes=[];
const {sourceStamp,...shippedNavigation}=read('gameplay/navigation.json');assert.deepEqual(game.preparedNavigation(),shippedNavigation,'Shipped ready graph must match fresh native collision validation');
for(const window of game.windows){const prepared=game.spawnRoutes.get(window.target);
  assert(prepared.choices.length,'No connected spawner for '+window.target);
  for(const origin of prepared.choices){
    const enemy={id:1,position:origin.slice(),previousPosition:origin.slice(),path:prepared.routes.get(origin.join(',')).map(p=>p.slice()),speed:57,window,stage:'approach',age:0,spawnTime:0,health:150,dead:false};
    assert(enemy.path.length,'Original spawn route must remain connected: '+window.target+' '+origin);
    let seconds=0;
    for(let tick=0;tick<360*120&&enemy.stage==='approach';tick++){game.time+=1/120;game.tickEnemy(enemy,1/120);seconds+=1/120;assert(enemy.position[2]>-300,'Actor fell below the map: '+window.target+' '+origin+' at '+enemy.position+' next '+enemy.path[0]);}
    assert.equal(enemy.stage,'barrier','Actor stuck approaching '+window.target+' from '+origin+' at '+enemy.position+' next '+enemy.path[0]);
    routes.push({window:window.target,origin,seconds});
  }
}
report.outsideRoutes=routes;
const crate=game.collision.staticSurfaces.find(b=>b.model?.includes('crate')&&b.maxs[2]-b.mins[2]>35&&b.maxs[0]-b.mins[0]<100);
assert(crate,'Native crate collision must be exported');
const center=crate.mins.map((v,k)=>(v+crate.maxs[k])/2),from=[crate.mins[0]-60,center[1],center[2]],to=[crate.maxs[0]+60,center[1],center[2]];
assert(game.collision.trace(from,to,[14,14,35]).fraction<1,'Zombie body must collide with native crates');
const crateStep=game.collision.step([from[0],from[1],crate.mins[2]-1],[to[0]-from[0],0,0]);
assert(crateStep.position[0]<crate.maxs[0]+14,'Stepping must not bypass a crate');
const w=game.windows.find(w=>w.target==='pf587_auto1'),start=[w.outside[0],w.outside[1],w.outside[2]+35],end=[w.entry[0],w.entry[1],w.entry[2]+35];
assert(game.collision.trace(start,end,[14,14,35]).fraction<1,'Intact barrier must block a body sweep');
report.worldObjects={staticSurfaces:game.collision.staticModelCount,staticTriangles:game.collision.staticTriangleCount,terrainTriangles:game.collision.triangles.length-game.collision.staticTriangleCount,crate:crate.model,barrier:true};
const referenceWorld=new CollisionWorld(data,manifest.entities),brushIds=referenceWorld.brushes.map((_,i)=>i),triangleIds=referenceWorld.triangles.map((_,i)=>i);
referenceWorld.cells={get:()=>brushIds};referenceWorld.triangleCells={get:()=>triangleIds};
for(let i=0;i<32;i++){
  const angle=i*Math.PI*2/32,start=[(i%3-1)*380,424+(i%5-2)*200,70],end=[start[0]+Math.cos(angle)*16000,start[1]+Math.sin(angle)*16000,start[2]+(i%4-2)*300],half=i%2?[14,14,35]:[0,0,0];
  const fast=game.collision.trace(start,end,half),reference=referenceWorld.trace(start,end,half);assert(Math.abs(fast.fraction-reference.fraction)<1e-8,'Grid traversal must match an exhaustive collision search');
}
report.longSweeps={exhaustiveComparisons:32};
const preparedSize=game.linkCache.size,originalWalkable=game.walkableLink.bind(game);let updatedLinks=0;
game.walkableLink=(...args)=>{updatedLinks++;return originalWalkable(...args);};
game.collision.disabled.add(w.target);const began=performance.now();game.invalidateNavigation([w.target]);const openMs=performance.now()-began;
assert.equal(game.linkCache.size,preparedSize,'A changed barrier must preserve unrelated prepared links');assert(updatedLinks<preparedSize/4,'A barrier must only update nearby links');
const openUpdates=updatedLinks;w.boards=0;game.rebuild(w);assert.equal(game.linkCache.size,preparedSize);game.newGame();assert.deepEqual([...game.linkCache],[...game.preparedLinkCache],'Restart must restore the prepared closed-world graph');
updatedLinks=0;const door=game.interactions.find(e=>e.targetname==='zombie_door');game.collision.disabled.add(door.target);game.invalidateNavigation([door.target]);assert(updatedLinks>0&&updatedLinks<preparedSize/4,'A door must refresh affected links without clearing the graph');
report.navigation={preparedLinks:preparedSize,barrierUpdatedLinks:openUpdates,doorUpdatedLinks:updatedLinks,barrierOpenMs:openMs,restartPrepared:true};

// Long play must retain only active enemies and recently killed corpses.
game=create();game.prepareSpawnPaths(shippedNavigation);game.start();game.roundDue=1e9;let maximum=0;
for(let wave=0;wave<240;wave++){
  for(let n=0;n<8;n++){game.spawnEnemy();const enemy=game.enemies.at(-1);game.hitEnemy(enemy,enemy.health);}
  advance(game,5.1);maximum=Math.max(maximum,game.enemies.length);assert.equal(game.enemies.length,0);
}
assert.equal(game.player.kills,1920);report.longSession={seconds:game.time,kills:game.player.kills,retainedEnemies:maximum};

const scene=new THREE.Scene(),fx=new CombatEffects(scene),resources=scene.children.map(m=>[m.geometry,m.material]);
for(let cycle=0;cycle<1000;cycle++){for(let n=0;n<8;n++)fx.impact({hit:n%2,wall:true,end:[1,2,3]},cycle);const g={position:[1,2,3]};fx.grenade(g);g.exploded=true;fx.update(cycle+.3);if(cycle%20===0)fx.reset();}
assert(scene.children.every((m,i)=>m.geometry===resources[i][0]&&m.material===resources[i][1]));assert.equal(new Set(scene.children.map(m=>m.geometry)).size,1);assert.equal(fx.diagnostics().activeImpacts,0);report.gpuPool={cycles:1000,...fx.diagnostics()};

// Compare accelerated hits to Three's reference posed-triangle raycast across
// multiple deforming poses, head/body materials, misses and both face sides.
const geo=new THREE.BoxGeometry(20,20,60,3,3,8),positions=geo.attributes.position;
const indices=new Uint16Array(positions.count*4),weights=new Float32Array(positions.count*4);
for(let i=0;i<positions.count;i++){indices[i*4]=0;indices[i*4+1]=1;const weight=(positions.getZ(i)+30)/60;weights[i*4]=1-weight;weights[i*4+1]=weight;}
geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
const mesh=new THREE.SkinnedMesh(geo,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})),root=new THREE.Group(),bone=new THREE.Bone(),upper=new THREE.Bone();bone.add(upper);mesh.add(bone);mesh.bind(new THREE.Skeleton([bone,upper]));root.add(mesh);root.position.set(31,-17,8);root.rotation.z=.6;
const trace=new PosedTrace(root),raycaster=new THREE.Raycaster();let compared=0;
for(let pose=0;pose<8;pose++){upper.rotation.y=pose*.12;upper.position.x=pose;root.updateMatrixWorld(true);mesh.computeBoundingBox();mesh.computeBoundingSphere();
  for(let z=-45;z<=45;z+=3)for(let x=-30;x<=30;x+=3){raycaster.set(new THREE.Vector3(x+31,-117,z+8),new THREE.Vector3(0,1,0));raycaster.far=200;const reference=raycaster.intersectObject(root,true)[0],hit=trace.trace(raycaster.ray,200,pose);
    assert.equal(!!hit,!!reference,'Accelerated trace must preserve posed mesh hit/miss');if(hit)assert(Math.abs(hit.distance-reference.distance)<1e-4);compared++;
  }
}
report.posedRaycast={compared,exactTriangles:true};
const hudGame={round:2,phase:'between',roundEndedAt:10,roundStartedAt:0,time:10,vars:{zombie_between_round_time:10}};
assert.equal(roundIndicatorState(hudGame).color,ROUND_RED);
hudGame.time=11.25;assert.equal(roundIndicatorState(hudGame).color,'#b68080');assert.equal(roundIndicatorState(hudGame).alpha,1);
for(const [time,alpha]of [[12.5,1],[12.75,.5],[13,0],[13.25,.5],[13.5,1]]){hudGame.time=time;assert.equal(roundIndicatorState(hudGame).alpha,alpha);assert.equal(roundIndicatorState(hudGame).color,'#ffffff');}
Object.assign(hudGame,{round:3,phase:'round',roundStartedAt:20,time:20.25});assert.deepEqual(roundIndicatorState(hudGame),{round:2,alpha:.5,color:'#ffffff'});
hudGame.time=20.75;assert.equal(roundIndicatorState(hudGame).round,3);assert.equal(roundIndicatorState(hudGame).alpha,.5);
hudGame.time=22.5;assert.equal(roundIndicatorState(hudGame).color,'#ffffff');assert.equal(roundIndicatorState(hudGame).alpha,1);
hudGame.time=23.75;const pausedState=roundIndicatorState(hudGame);assert.equal(pausedState.color,'#b68080');assert.equal(pausedState.alpha,1);assert.deepEqual(roundIndicatorState(hudGame),pausedState);
hudGame.time=25;assert.equal(roundIndicatorState(hudGame).color,ROUND_RED);assert.equal(roundIndicatorState(hudGame).alpha,1);
for(const round of [1,6,10,11,25]){Object.assign(hudGame,{round,time:100,roundStartedAt:90,phase:'round'});assert.equal(roundIndicatorState(hudGame).color,ROUND_RED);assert.equal(roundIndicatorState(hudGame).round,round);}
report.roundHud={activeColor:ROUND_RED,whitePulse:true,pulseFadeSeconds:.5,colorFadeSeconds:2.5,continuesAcrossRoundStart:true,pausedWithSimulation:true};
fs.writeFileSync(new URL('../local-data/runtime-regressions.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

