import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {MAPS,BO1_MAPS} from '../web/maps.js';
import {NetSession,Timeline} from '../web/net-session.js';
import {Coop,BLEEDOUT_SECONDS} from '../web/coop.js';
import {createLobbyApi} from './lobby-api.mjs';
import {StepSmoothing} from '../web/step-smoothing.js';

// Two real Kino games, a host and a guest, through the server's lobby relay.
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/bo1-kino/manifest.json'),collision=await read('bo1-kino/web-world/zombie_theater.collision.json'),paths=await read('bo1-kino/web-world/zombie_theater.paths.json'),presentation=await read('gameplay/bo1-kino/presentation.json'),navigation=await read('gameplay/bo1-kino/navigation.json');
const api=createLobbyApi({maps:[...MAPS,...BO1_MAPS]});
const server=http.createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const call=async(path,body={})=>(await fetch(`${base}/api/lobby/kino/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const hostJoin=await call('join',{character:0}),guestJoin=await call('join',{character:2}),match=(await call(hostJoin.you+'/start')).match;
await call(hostJoin.you,{loaded:match.id});await call(guestJoin.you,{loaded:match.id});
const make=(join,character)=>{
  const events=[],g=new BlackOpsEngine(manifest,new CollisionWorld(collision,manifest.entities),paths,{dialog:e=>events.push(['dialog',e]),death:e=>events.push(['death',e]),open:e=>events.push(['open',e.target])},presentation);
  g.character=character;g.prepareSpawnPaths(navigation);g.newGame();
  const host=join.you===match.host,me=join.players.find(p=>p.id===join.you);
  let coop;const session=new NetSession('kino',join.you,{base,state:()=>coop.state(),snapshot:host?()=>coop.snapshot():null,onEvent:(from,msg)=>coop.handle(from,msg),onSnapshot:(snap,now)=>coop.receive(snap,now),interval:15,snapshotInterval:30});
  coop=new Coop(g,session,{host,localId:join.you,slot:me.slot,character});session.start();
  const spawn=coop.spawnPoint();g.player.position=spawn.slice();g.player.previousPosition=spawn.slice();
  return {g,coop,session,events};
};
const host=make(hostJoin,0),guest=make(guestJoin,2);
host.g.start();guest.g.start();
const step=async(seconds,inputs={})=>{for(let t=0;t<seconds;t+=1/60){for(const side of [host,guest]){side.g.update(1/60,inputs[side===host?'host':'guest']||{});side.coop.update();}await wait(4);}};
await step(.5);
assert.equal(guest.g.mirror,true);assert.equal(host.g.mirror,false);
assert.equal(host.coop.playerCount(),2,'The host counts both players');
assert.deepEqual(host.session.players.get(guestJoin.you).state.p,guest.g.player.position.map(v=>Math.round(v*10)/10),'Each sees the other player');
assert.notDeepEqual(host.g.player.position,guest.g.player.position,'Players start on different spawn markers');
// Rounds and zombies are the host's; the guest mirrors them.
// Round 1's first spawn follows BO1's 8.25 s round-number intro.
host.g.roundDue=host.g.time;await step(9);
assert.equal(guest.g.round,host.g.round);assert.equal(guest.g.phase,'round');
const hostLive=host.g.enemies.filter(e=>!e.dead).map(e=>e.id).sort(),guestLive=guest.g.enemies.filter(e=>!e.dead).map(e=>e.id).sort();
assert(hostLive.length>0,'The host spawned zombies');assert.deepEqual(guestLive,hostLive,'The guest mirrors the host\'s zombies');
const mirrored=guest.g.enemies.find(e=>!e.dead),original=host.g.enemies.find(e=>e.id===mirrored.id);
assert(Math.hypot(...mirrored.position.map((v,i)=>v-original.position[i]))<80,'Mirrored zombies follow the host\'s positions');
// The guest's kill: the host applies it and pays the guest, not itself.
const hostPoints=host.g.player.points,guestPoints=guest.g.player.points;
guest.g.hitEnemy(mirrored,1e6,true,false);assert(!mirrored.dead,'Guests do not kill zombies by themselves');
await step(.4);
assert(original.dead,'The host applied the guest\'s hit');assert.equal(host.g.player.points,hostPoints,'The host is not paid for the guest\'s kill');
assert(guest.g.player.points>guestPoints,'The guest is paid');assert.equal(guest.g.player.kills,1);assert.equal(guest.g.player.headshots,1);assert(mirrored.dead,'The guest sees its kill');
// Zombies hunt the nearest player, each with its own route cache.
const hunter={id:999,position:guest.g.player.position.map((v,i)=>v+(i===0?30:0)),stage:'hunt',dead:false};
assert.equal(host.coop.targetFor(hunter).id,guestJoin.you,'A zombie next to the guest hunts the guest');
// A guest's door purchase: guest pays, host opens, everyone sees it.
const door=guest.g.interactions.find(e=>e.targetname==='zombie_door'&&!guest.g.opened.has(e.target));
guest.g.player.points=5000;guest.g.player.position=door.position.map((v,i)=>i===2?v-30:v);guest.g.nearInteraction=()=>door;guest.g.use();delete guest.g.nearInteraction;
await step(.4);
assert(host.g.opened.has(door.target),'The host opened the guest\'s door');assert(guest.g.opened.has(door.target),'The guest sees it open');assert.equal(guest.g.player.points,5000-Number(door.zombie_cost));
assert(guest.g.collision.disabled.has(door.target),'Its collision opens for the guest too');
// Power: the guest flips it on the host.
const power=guest.g.interactions.find(e=>e.targetname==='use_power_switch');guest.g.nearInteraction=()=>power;guest.g.use();delete guest.g.nearInteraction;await step(.4);
assert(host.g.mapRules.power&&guest.g.mapRules.power,'Power is shared');
// Last stand: lethal damage downs the guest; the host revives them.
host.g.player.position=guest.g.player.position.map((v,i)=>i===0?v+20:v);
host.coop.to(guestJoin.you,{type:'damage',amount:500});await step(.4);
assert(guest.coop.down,'The guest is downed, not dead');assert.equal(guest.g.weapon.name,'m1911_zm');assert.equal(guest.g.player.stance,'prone');
assert(host.coop.reviveTarget()?.id===guestJoin.you,'The host can reach the downed guest');
for(let t=0;t<3.1;t+=1/60)host.coop.updateRevive(true,1/60);await step(.4);
assert(!guest.coop.down,'Holding Use for 3 seconds revives');assert.equal(guest.g.player.health,100);
// Everyone down: game over for both.
host.coop.goDown();host.coop.to(guestJoin.you,{type:'damage',amount:500});await step(.6);
assert.equal(host.g.phase,'dead');assert.equal(guest.g.phase,'dead');for(let i=0;i<50&&!(host.events.some(e=>e[0]==='death')&&guest.events.some(e=>e[0]==='death'));i++)await step(.05);assert(host.events.some(e=>e[0]==='death')&&guest.events.some(e=>e[0]==='death'),'Both see the game over');
// Teammates are solid: the host is pushed out of the guest, and the guest's
// body stops the host's bullets (no damage) before a zombie behind them.
const solid=host.coop.remotes.get(guestJoin.you);solid.state={...solid.state,p:host.g.player.position.map((v,i)=>i===0?v+10:v),dead:false,down:false,stance:'stand'};solid.present=true;
host.coop.separate();assert(Math.hypot(host.g.player.position[0]-solid.state.p[0],host.g.player.position[1]-solid.state.p[1])>=29.9,'Players cannot overlap');
const eye=[host.g.player.position[0],host.g.player.position[1],host.g.player.position[2]+50],towards=[solid.state.p[0]-eye[0],solid.state.p[1]-eye[1],0],len=Math.hypot(...towards),dir=towards.map(v=>v/len);
const shotRay=host.coop.blockShot({hit:{distance:400},hits:[{distance:400}],end:eye.map((v,i)=>v+dir[i]*500),wall:true},eye,dir,()=>solid.state);
assert.equal(shotRay.hits.length,0,'A teammate stops the shot');assert(shotRay.teammate&&!shotRay.wall);assert(Math.hypot(...shotRay.end.map((v,i)=>v-eye[i]))<len,'The bullet ends at their body');
// Interpolation keeps another clock's samples in order.
const line=new Timeline();line.push(0,{p:[0,0,0],yaw:0},1000);line.push(100,{p:[10,0,0],yaw:1},1100);assert.deepEqual(line.sample(50,1100).p,[5,0,0]);
// Steps: the view glides up a 12-unit step over 0.2 s instead of popping.
const steps=new StepSmoothing(),feet={position:[0,0,0],grounded:true};steps.update(feet,1/60);feet.position=[0,0,12];
assert(Math.abs(steps.update(feet,0)+12)<1e-9,'The view starts at the old height');for(let i=0;i<6;i++)steps.update(feet,1/60);assert(steps.offset<-5&&steps.offset>-12);for(let i=0;i<7;i++)steps.update(feet,1/60);assert.equal(steps.offset,0,'and has caught up after 0.2 s');
feet.position=[0,0,200];steps.update(feet,1/60);assert.equal(steps.offset,0,'A fall or teleport is not smoothed');
// Stairs (8-unit steps every 1/16 s, up or down) track within half a step.
for(const rise of [8,-8]){const stairs=new StepSmoothing(),body={position:[0,0,0],grounded:true};stairs.update(body,1/120);let t=0,next=0,z=0,lag=0,n=0;
  for(let i=0;i<240;i++){t+=1/120;if(t>=next){z+=rise;next+=1/16;}body.position=[0,0,z];const o=stairs.update(body,1/120);if(i>60){lag+=Math.abs(o);n++;}}
  assert(lag/n<=4.5,'Stairs view lag '+(lag/n).toFixed(2));}
for(const side of [host,guest])side.session.stop();server.close();
console.log('Co-op passed:',JSON.stringify({players:2,zombies:hostLive.length,guestKillPaid:guest.g.player.kills,sharedDoor:door.target,sharedPower:true,revive:true,gameOver:true,bleedout:BLEEDOUT_SECONDS}));
