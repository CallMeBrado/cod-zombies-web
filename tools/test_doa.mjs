import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {CollisionWorld} from '../web/collision.js';
import {DeadOpsEngine} from '../web/doa-engine.js';
import {pageRoute} from '../web/routes.js';
import {BO1_MAPS} from '../web/maps.js';
import {GamepadSettings,GamepadControls} from '../web/gamepad.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/bo1-doa/manifest.json'),navigation=await read('gameplay/bo1-doa/navigation.json'),native=await read('bo1-doa/web-world/zombietron.collision.json');
const make=()=>new DeadOpsEngine(manifest,new CollisionWorld(native,manifest.entities),navigation);
assert.equal(BO1_MAPS.find(m=>m.id==='dead-ops').asset,'zombietron');
assert.equal(pageRoute(new URL('http://localhost/black-ops/?map=dead-ops')).template,'doa.html');
assert.equal(pageRoute(new URL('http://localhost/black-ops/?map=kino')).template,'bo1.html');
assert.equal(manifest.arenas.length,10);assert.equal(Object.keys(manifest.weapons).length,7);assert(manifest.sounds.mus_zmbtron_island);
const arenaChecks=[];
for(let arena=0;arena<10;arena++){
  const g=make();g.enterArena(arena);g.buildFlow();assert(g.grid.nodes.length>=30);assert.equal([...g.flow].filter(n=>n>=0).length,g.grid.nodes.length,'Arena navigation is one reachable component');
  const before=g.player.position.slice();g.round=arena*4+1;g.startRound();g.spawnQueue=[];g.mods.god=true;
  for(let i=0;i<240;i++)g.update(1/240,{});
  assert(g.player.position.every(Number.isFinite));assert(Math.abs(g.player.position[2]-before[2])<30,'Standing player stays on floor in '+g.arena.id);
  arenaChecks.push({arena:g.arena.id,nodes:g.grid.nodes.length,spawn:g.player.position});
  assert(g.grid.exitSides.length,'Each arena has a physically validated exit');
  const exit=g.arena.exits.find(e=>e.side===g.grid.exitSides[0]),nearest=g.grid.nodes.toSorted((a,b)=>Math.hypot(a.p[0]-exit.position[0],a.p[1]-exit.position[1])-Math.hypot(b.p[0]-exit.position[0],b.p[1]-exit.position[1]))[0];g.player.position=nearest.p.slice();g.openExits();g.exitReadyAt=0;const round=g.round;
  for(let i=0;i<120*8&&g.phase==='exit';i++){const dx=exit.position[0]-g.player.position[0],dy=exit.position[1]-g.player.position[1],d=Math.hypot(dx,dy);g.update(1/120,{x:dx/d,y:dy/d});}
  assert.equal(g.round,round+1,'Walking to the native exit advances '+manifest.arenas[arena].id);
}
const floor={models:[{brushes:[]}],brushes:[{mins:[-10000,-10000,-100],maxs:[10000,10000,0],contents:1,planes:[[0,0,1,0],[0,0,-1,100],[1,0,0,10000],[-1,0,0,10000],[0,1,0,10000],[0,-1,0,10000]]}]};
function flat(){const g=make();g.collision=new CollisionWorld(floor,[]);g.player.position=[0,0,0];g.player.previousPosition=[0,0,0];g.player.angle=0;g.phase='round';g.round=1;g.spawnQueue=[{due:1000,kind:'zombie',side:'top'}];g.mods.god=true;return g;}
const moves=[];for(const hz of [30,60,120,240]){const g=flat();for(let i=0;i<hz;i++)g.update(1/hz,{x:1,y:0});assert(Math.abs(g.player.position[0]-190)<2);assert(Math.abs(g.player.position[2])<.1);moves.push(g.player.position[0]);}
for(const id of ['Xbox Wireless Controller','DualSense Wireless Controller','Backbone One']){
  const pad={id,index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))},controls=new GamepadControls(new GamepadSettings({getItem:()=>null,setItem:()=>{}}),{getGamepads:()=>[pad],supported:true,mode:()=> 'playing'});let sticks;
  controls.onSticks=(left,right)=>sticks={left,right};controls.poll(1/60);pad.axes[0]=.7;pad.axes[2]=.8;controls.poll(1/60);assert(controls.active);assert(sticks.left.x>.6&&sticks.right.x>.7,'Arcade receives independent move/aim sticks for '+id);assert(controls.label('grenade'));pad.buttons[0]={pressed:true,value:1};controls.poll(1/60);assert(controls.input().jump,'Controller boost is an edge-triggered jump action');
}
{
  const g=make();g.start();g.mods.god=true;for(let i=0;i<120*60;i++)g.update(1/120,{});
  assert(g.enemies.filter(e=>!e.dead).length<=32);assert(g.enemies.some(e=>Math.hypot(e.position[0]-g.player.position[0],e.position[1]-g.player.position[1])<30),'Native island zombies reach the player instead of drifting at a ledge');
}
const zombie=(id,x,y=0)=>({id,kind:'zombie',position:[x,y,0],previousPosition:[x,y,0],angle:Math.PI,health:1000,maxHealth:1000,speed:0,dead:false,stalled:0});
{
  const g=flat();g.enemies=[zombie(100,120)];for(let i=0;i<120;i++)g.update(1/120,{angle:0,fire:true});assert(g.player.kills>=1,'Starting M60 kills a zombie');
  const b=flat();b.weapon='ray_gun_zt';b.enemies=[zombie(100,110),zombie(101,150)];b.fire();for(let i=0;i<120;i++)b.update(1/120,{});assert(b.enemies.every(e=>e.health<1000||e.dead),'Ray Gun pierces aligned zombies');
}
{
  const g=flat();g.enemies=[zombie(101,100),zombie(102,200)];assert(g.nuke());assert.equal(g.player.bombs,0);assert(g.enemies.every(e=>e.dead));assert.equal(g.nuke(),false);
  g.player.boosters=2;assert(g.boost());for(let i=0;i<30;i++)g.update(1/120,{});assert(g.player.position[0]>300,'Speed boost travels quickly');assert.equal(g.player.boosters,1);
  g.mods.god=false;g.invulnerableUntil=0;g.loseLife();assert.equal(g.player.lives,2);g.loseLife();assert.equal(g.player.lives,2,'Respawn invulnerability prevents stacked deaths');
  g.time=g.invulnerableUntil+1;g.loseLife();g.time=g.invulnerableUntil+1;g.loseLife();assert.equal(g.phase,'dead');assert.equal(g.player.lives,0);
}
{
  const g=flat();g.pickup({kind:'spas_zt'});assert.equal(g.weapon,'spas_zt');for(let i=0;i<120*11;i++)g.update(1/120,{fire:true,angle:0});assert.equal(g.weapon,'m60_zt');
  for(let i=0;i<5;i++)g.pickup({kind:'gold'});assert.equal(g.multiplier,2);g.addPoints(200000);assert(g.player.lives>3);
  const saved=g.saveState(),restored=make();restored.loadState(saved);assert.deepEqual(restored.player,{...g.player,previousPosition:g.player.position});assert.deepEqual(restored.spawnQueue,g.spawnQueue);assert.equal(restored.seed,g.seed);assert.equal(restored.time,g.time);
  assert.throws(()=>restored.loadState({...saved,engine:'waw'}),/Dead Ops/);
}
{
  const g=make();g.round=4;g.phase='exit';g.exitReadyAt=0;assert(g.takeExit());assert.equal(g.round,5);assert.equal(g.arena.id,'town');
  g.round=12;g.phase='exit';g.exitReadyAt=0;g.takeExit();assert.equal(g.phase,'fate');assert(g.chooseFate('friendship'));assert.equal(g.phase,'round');assert.equal(g.fate,'friendship');
  g.round=40;g.startRound();assert(g.spawnQueue.some(s=>s.kind==='ape'),'Round 40 has the Cosmic Silverback');
}
const report={nativeArenas:arenaChecks,nativeWeapons:7,nativeSounds:Object.keys(manifest.sounds).length,movementFps:moves,combat:true,boostAndNuke:true,oneHitDeaths:true,pickups:true,serverCompatibleSave:true,arenaProgression:true,fates:true,boss:true};
await writeFile(new URL('../local-data/doa-logic-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log('Dead Ops checks passed:',JSON.stringify(report));
