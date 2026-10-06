import { roundCount, nextHealth, spawnDelay } from './rules.js';
import { SCORE_POPUP_SECONDS } from './score-hud.js';
import {FactoryRules,POWER_TARGETS} from './map-rules.js';
export const PHYSICS_STEP=1/120;
// round_spawning() waits while get_enemy_count() > 31.
const MAX_ALIVE=32;
export const NAVIGATION_VERSION='native-triangles-physics-v3';
export const POWER_NAVIGATION_VERSION='factory-power-v1';
// Grenades hit physical surfaces, not the invisible player movement clips
// that close window openings and simplify traversal around rubble.
export const GRENADE_CONTENTS=1;
const vec=s=>s?.split(/\s+/).map(Number)||[0,0,0];
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
// _zombiemode.gsc run cycles; clips a map did not ship are skipped (Nacht has
// four walks and walk_fast "runs"; Der Riese adds walk_v6-v8 and run_v2/v4).
export const ZOMBIE_GAITS={
  walk:['ai_zombie_walk_v1','ai_zombie_walk_v2','ai_zombie_walk_v3','ai_zombie_walk_v4','ai_zombie_walk_v6','ai_zombie_walk_v7','ai_zombie_walk_v8'],
  run:['ai_zombie_walk_fast_v1','ai_zombie_walk_fast_v2','ai_zombie_walk_fast_v3','ai_zombie_run_v2','ai_zombie_run_v4'],
  sprint:['ai_zombie_sprint_v1','ai_zombie_sprint_v2']};
// Zombies move by the clip's own root motion, so feet match the ground.
export function gaitSpeed(clip){const motion=clip?.motion;return motion?.length>1&&clip.duration?Math.hypot(motion.at(-1)[1]-motion[0][1],motion.at(-1)[2]-motion[0][2])/clip.duration:37.64;}
// Distinct movement speeds of the gait clips a map ships, for route checks.
export function gaitSpeeds(animations){return [...new Set(Object.values(ZOMBIE_GAITS).flat().filter(name=>animations[name]).map(name=>gaitSpeed(animations[name])))].sort((a,b)=>a-b);}
function rayBox(origin,dir,lo,hi,max) {
  let near=0,far=max;
  for(let i=0;i<3;i++) {
    if(Math.abs(dir[i])<1e-8){if(origin[i]<lo[i]||origin[i]>hi[i])return null;continue;}
    const a=(lo[i]-origin[i])/dir[i],b=(hi[i]-origin[i])/dir[i];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far)return null;
  }
  return near;
}

export class SoloGame {
  constructor(manifest,collision,paths,events={},presentation={}) {
    this.data=manifest;this.vars=manifest.variables;this.collision=collision;
    const floorDisabled=collision.disabled;
    if(manifest.map?.id==='der-riese'){
      // Board/door models may overlap the authored node centers. Probe the
      // permanent floor beneath them, rather than their movable clip volumes.
      const targets=manifest.entities.filter(e=>['exterior_goal','zombie_door','zombie_debris'].includes(e.targetname)).map(e=>e.target);
      collision.disabled=new Set([...floorDisabled,...targets]);
    }
    // T4 path-node origins sit 16 units above the actor's ground contact.
    // Factory tunnel nodes can sit just below the floor after subtracting the
    // native 16-unit offset. Start their floor probe above that surface so it
    // cannot skip it and snap the navigation graph into the room underneath.
    const nodeLift=manifest.map?.id==='der-riese'?16:0;
    const groundNode=p=>{const start=[p[0],p[1],p[2]+35+nodeLift],f=collision.trace(start,[start[0],start[1],start[2]-128],[14,14,35]);return f.fraction<1&&f.normal[2]>.65?[p[0],p[1],f.end[2]-35]:p;};
    this.nodes=paths.nodes.map(n=>({...n,origin:groundNode([n.origin[0],n.origin[1],n.origin[2]-16])}));
    this.nodeOrder=this.nodes.map((_,i)=>i);
    this.incoming=this.nodes.map(()=>[]);for(let i=0;i<this.nodes.length;i++)for(const link of this.nodes[i].links)if(link.node<this.nodes.length)this.incoming[link.node].push({node:i,distance:link.distance});
    this.events=events;this.presentation=presentation;this.enemies=[];this.effects=[];this.pathCache=new Map();this.linkCache=new Map();this.spawnRoutes=new Map();
    this.entities=manifest.entities;
    this.windows=this.entities.filter(e=>e.targetname==='exterior_goal').map(e=>{
      const begin=this.entities.filter(x=>x.targetname==='traverse').sort((a,b)=>distance(vec(a.origin),vec(e.origin))-distance(vec(b.origin),vec(e.origin)))[0];
      const end=this.entities.find(x=>x.targetname===begin?.target);
      const ground=p=>{const f=collision.trace([p[0],p[1],p[2]+35],[p[0],p[1],p[2]+35-128],[10,10,35]);return f.fraction<1&&f.normal[2]>.65?[p[0],p[1],f.end[2]-35]:p;};
      const landing=p=>{
        const entry=ground(p);if(manifest.map?.id!=='der-riese')return entry;
        const center=[entry[0],entry[1],entry[2]+35];if(!collision.trace(center,center,[14,14,34.9]).allSolid)return entry;
        // Some native traversal endpoints fit a narrow animation root but
        // intersect a frame with the runtime's walking hull. Settle that hull
        // on the nearest clear native surface instead of freezing inside it.
        for(const radius of [4,8,12,16])for(const [dx,dy] of [[radius,0],[-radius,0],[0,radius],[0,-radius]]){
          const start=[entry[0]+dx,entry[1]+dy,entry[2]+83],floor=collision.trace(start,[start[0],start[1],start[2]-160],[14,14,35]);
          if(floor.fraction===1||floor.normal[2]<.65||collision.trace(floor.end,floor.end,[14,14,34.9]).allSolid)continue;
          return [floor.end[0],floor.end[1],floor.end[2]-35];
        }return entry;
      };
      return {outside:ground(vec(e.origin)),begin:ground(vec(begin.origin)),entry:landing(end?vec(end.origin):lerp(vec(e.origin),vec(begin.origin),3)),
        angle:vec(begin.angles)[1]*Math.PI/180,target:e.target,boards:6,boardEntities:this.entities.filter(b=>b.targetname===e.target&&b.script_noteworthy!=='clip').slice(0,6)};
    });
    collision.disabled=floorDisabled;
    this.interactions=this.entities.filter(e=>['weapon_upgrade','zombie_door','zombie_debris','treasure_chest_use','weapon_cabinet_use','use_power_switch','zombie_vending','zombie_vending_upgrade','trigger_teleport_core'].includes(e.targetname)||/^trigger_teleport_pad_\d$/.test(e.targetname)).map(e=>({...e,position:vec(e.origin)}));
    this.spawnEntities=this.entities.filter(e=>/^zombie_spawner_(init|door|upstairs)$/.test(e.targetname)||manifest.map&&e.script_noteworthy==='zombie_spawner');
    this.spawnPoints=this.spawnEntities.map(e=>vec(e.origin));
    this.spawn=vec(this.entities.find(e=>e.targetname==='initial_spawn_points').origin);
    this.mapRules=manifest.map?.id==='der-riese'?new FactoryRules(this):null;
    this.newGame();
  }
  emit(type,value){this.events[type]?.(value);}
  newGame() {
    for(const enemy of this.enemies)this.emit('removeEnemy',enemy);
    this.enemies=[];this.effects=[];this.collision.disabled.clear();this.opened=new Set();
    const floor=this.collision.move(this.spawn,[0,0,-64]);
    if(!floor.grounded)throw new Error('The original player spawn has no walkable collision floor.');
    this.player={position:floor.position,health:100,points:this.vars.zombie_score_start,kills:0,headshots:0,velocityZ:0,grounded:true,grenades:4};
    this.scorePopups=[];
    this.accumulator=0;this.physicsTicks=0;this.jumpQueued=false;this.player.previousPosition=this.player.position.slice();this.pathCache.clear();this.linkCache=new Map(this.preparedLinkCache||[]);
    this.inventory=[this.makeWeapon('zombie_colt')];this.slot=0;this.inventory[0].raised=true;this.switching=null;
    this.time=0;this.round=0;this.zombieHealth=this.vars.zombie_health_start;this.phase='ready';this.roundDue=0;this.spawnDue=0;this.remaining=0;
    this.cooldown=0;this.meleeDue=0;this.pendingMelee=null;this.pendingFire=false;this.sprintExitUntil=0;this.reloadEnd=0;this.lastDamage=-100;this.rebuildDue=0;this.barrierReward=0;this.powerup={};this.drops=[];this.grenades=[];this.ambientDue=5;this.sprinting=false;
    this.resumed=false;this.roundStartedAt=0;this.roundEndedAt=0;this.targetNodeDue=0;this.targetNode=-1;this.spawnDistanceCache=null;this.pendingGrenade=null;this.gesture=null;this.powerupOrder=[];this.powerupIndex=0;this.carpenter=null;this.nextDropId=1;
    this.boxes=new Map(this.interactions.filter(e=>e.targetname==='treasure_chest_use').map(e=>[e.target,{entity:e,phase:'closed',weapon:null}]));
    this.mapRules?.reset();
    this.yaw=Math.PI;this.pitch=0;this.ads=0;this.spreadBloom=0;this.moving=false;this.shots=0;this.hits=0;this.nextId=1;this.elapsed=0;
    this.windows.forEach(w=>{w.boards=6;w.traverser=null;w.attackers=[];this.emit('barrier',w);});
    this.emit('reset');this.emit('weapon',this.weapon);
  }
  get weapon(){return this.inventory[this.slot];}
  makeWeapon(name) {const d=this.data.weapons[name];return {name,clip:d.clipSize,reserve:Math.max(0,d.startAmmo-d.clipSize),definition:d};}
  start(){if(this.phase==='ready'){this.phase='between';this.roundDue=this.time+2;this.emit('sessionStart');}else if(this.resumed){this.resumed=false;this.emit('sessionStart');}}
  message(text){this.emit('message',text);}
  changePoints(amount) {
    if(!amount)return;
    this.player.points+=amount;this.expireScorePopups();
    const popup={amount,started:this.time,moveX:-20-Math.floor(Math.random()*40),moveY:15-Math.floor(Math.random()*30)};
    this.scorePopups.push(popup);if(this.scorePopups.length>64)this.scorePopups.shift();
    this.emit('score',popup);
  }
  expireScorePopups() {
    let count=0;while(count<this.scorePopups.length&&this.time-this.scorePopups[count].started>=SCORE_POPUP_SECONDS)count++;
    if(count)this.scorePopups.splice(0,count);
  }
  spendPoints(cost) {
    if(this.player.points<cost){this.message('Need '+cost+' points');this.emit('sound',{alias:'no_cha_ching'});return false;}
    this.changePoints(-cost);this.emit('sound',{alias:'cha_ching'});return true;
  }
  startRound() {
    this.round++;this.roundStartedAt=this.time;this.roundBaseHealth=this.zombieHealth;this.zombieHealth=nextHealth(this.zombieHealth,this.round,this.vars);this.remaining=roundCount(this.round,this.vars.zombie_max_ai,this.vars.zombie_ai_per_player,this.mapRules?.soloAiFactor??0);
    this.spawnDue=this.time;this.phase='round';this.barrierReward=0;this.player.grenades=Math.min(4,this.player.grenades+2);
    this.emit('round',this.round);this.emit('sound',{alias:'chalk'});
  }
  nearest(position,visible=false,regular=false) {
    const scores=new Float64Array(this.nodes.length);let index=-1,best=Infinity;
    for(let i=0;i<this.nodes.length;i++){const p=this.nodes[i].origin,score=regular&&(this.nodes[i].type===16||this.nodes[i].type===17)?Infinity:(p[0]-position[0])**2+(p[1]-position[1])**2+(p[2]-position[2])**2;scores[i]=score;if(score<best){best=score;index=i;}}
    if(!visible)return index;
    // Test the nearest candidates first. Testing each successive record during
    // source-order scanning used to perform many expensive, distant sweeps.
    for(const i of this.nodeOrder.slice().sort((a,b)=>scores[a]-scores[b]))if(Number.isFinite(scores[i])&&this.walkableLink(position,this.nodes[i].origin,true))return i;
    return -1;
  }
  walkableLink(p,q,navigation=false){
    const start=[p[0],p[1],p[2]+35.1],end=[q[0],q[1],q[2]+35.1],half=[14,14,34.9];
    const clear=this.collision.trace(start,end,half,1|0x10000,navigation).fraction>=.98;
    if(clear&&!navigation)return true;
    if(navigation){
      // Test using actor-sized physics steps: a long diagonal sweep or coarse
      // step can skip a rubble edge which an actual walking actor cannot pass.
      // Direction matters: a usable descent may be too high to climb back up.
      const length=Math.hypot(q[0]-p[0],q[1]-p[1]);if(length>1024||Math.abs(q[2]-p[2])>256)return false;
      let position=p.slice(),velocityZ=0;
      for(let i=0;i<Math.ceil(length/.475)+120;i++){
        const dx=q[0]-position[0],dy=q[1]-position[1],remaining=Math.hypot(dx,dy);
        if(remaining<1&&Math.abs(position[2]-q[2])<8)return true;
        const amount=Math.min(.475,remaining);velocityZ-=800/120;
        const result=this.collision.step(position,[remaining?dx/remaining*amount:0,remaining?dy/remaining*amount:0,velocityZ/120]);
        position=result.position;if(result.grounded)velocityZ=0;
        if(position[2]<Math.min(p[2],q[2])-72)return false;
      }
      return false;
    }
    if(Math.abs(p[2]-q[2])>18)return false;
    return this.collision.trace(start,start.map((v,i)=>v+(i===2?18:0)),half,1|0x10000,navigation).fraction>=.98&&this.collision.trace(start.map((v,i)=>v+(i===2?18:0)),end.map((v,i)=>v+(i===2?18:0)),half,1|0x10000,navigation).fraction>=.98;
  }
  path(start,end,inside=false) {
    const a=this.nearest(start,true);
    if(inside&&(this.time>=this.targetNodeDue||this.targetNode<0)){this.targetNode=this.nearest(end,true,true);this.targetNodeDue=this.time+.15;}
    const b=inside?this.targetNode:this.nearest(end,true);if(a<0||b<0)return [];
    const key=[a,b,inside,[...this.opened].sort().join(',')].join('|'),cached=this.pathCache.get(key);
    if(cached)return [...cached.map(p=>p.slice()),end.slice()];
    const costs=new Float64Array(this.nodes.length).fill(Infinity),prev=new Int32Array(this.nodes.length).fill(-1),done=new Uint8Array(this.nodes.length);costs[a]=0;
    const heap=[[0,a]],push=(entry)=>{heap.push(entry);let i=heap.length-1;while(i>0){const parent=(i-1)>>1;if(heap[parent][0]<=entry[0])break;heap[i]=heap[parent];i=parent;}heap[i]=entry;};
    const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1][0]<heap[child][0])child++;if(heap[child][0]>=last[0])break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
    while(heap.length) {
      const [best,at]=pop();if(done[at]||best>costs[at])continue;
      if(at===b)break;done[at]=1;
      for(const link of this.nodes[at].links) {
        const n=link.node;if(n>=costs.length||done[n])continue;
        if(this.nodes[at].type===16||this.nodes[n].type===17)continue;
        {
          const p=this.nodes[at].origin,q=this.nodes[n].origin;
          const key=at+','+n;let clear=this.linkCache.get(key);
          if(clear===undefined){clear=this.walkableLink(p,q,true);this.linkCache.set(key,clear);}
          if(!clear)continue;
        }
        const cost=best+link.distance;if(cost<costs[n]){costs[n]=cost;prev[n]=at;push([cost,n]);}
      }
    }
    if(!Number.isFinite(costs[b]))return [];
    const path=[];for(let i=b;i>=0;i=prev[i]){path.unshift(this.nodes[i].origin.slice());if(i===a)break;}
    this.pathCache.set(key,path);if(this.pathCache.size>256)this.pathCache.delete(this.pathCache.keys().next().value);return [...path.map(p=>p.slice()),end.slice()];
  }
  availableWindows() {
    if(this.mapRules)return this.mapRules.windows();
    return this.windows.filter(w=>w.entry[2]<100&&(w.entry[0]<270&&w.entry[1]<620||this.opened.has('auto34'))||w.entry[2]>=100&&this.opened.has('upstairs_blocker'));
  }
  spawnCandidates(){
    // Prefer reachable entries near the player. Path length, rather than a
    // straight line through a ceiling/locked passage, distinguishes floors.
    if(this.time>=this.targetNodeDue||this.targetNode<0){this.targetNode=this.nearest(this.player.position,true,true);this.targetNodeDue=this.time+.15;}
    if(!this.spawnDistanceCache||this.spawnDistanceCache.node!==this.targetNode)this.spawnDistanceCache={node:this.targetNode,costs:this.spawnDistances(this.targetNode)};
    const candidates=[],costs=this.spawnDistanceCache.costs;
    for(const window of this.availableWindows()){
      window.insideNode??=this.nearest(window.entry,true);const node=window.insideNode;
      if(node<0||this.targetNode<0||!Number.isFinite(costs[node]))continue;
      const length=costs[node]+distance(window.entry,this.nodes[node].origin)+distance(this.player.position,this.nodes[this.targetNode].origin);
      candidates.push({window,distance:length,weight:1/(1+(length/400)**4)/(1+this.queuedAt(window))});
    }
    if(!candidates.length)return this.availableWindows().map(window=>({window,distance:distance(window.entry,this.player.position),weight:1/(1+(distance(window.entry,this.player.position)/400)**4)}));
    return candidates;
  }
  // Zombies still outside a window (walking up or tearing). Spawns favour
  // nearby windows but spread out instead of all queueing at the closest one.
  queuedAt(window){return this.enemies.filter(e=>!e.dead&&e.window===window&&(e.stage==='approach'||e.stage==='barrier')).length;}
  spawnDistances(target){
    const costs=new Float64Array(this.nodes.length).fill(Infinity);if(target<0)return costs;
    const heap=[[0,target]];costs[target]=0;
    const push=entry=>{heap.push(entry);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p][0]<=entry[0])break;heap[i]=heap[p];i=p;}heap[i]=entry;};
    const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
    while(heap.length){const [cost,at]=pop();if(cost>costs[at])continue;
      for(const link of this.incoming[at]){const n=link.node;if(this.nodes[n].type===16||this.nodes[at].type===17)continue;
        const key=n+','+at;let clear=this.linkCache.get(key);
        if(clear===undefined){clear=this.walkableLink(this.nodes[n].origin,this.nodes[at].origin,true);this.linkCache.set(key,clear);}
        if(!clear)continue;const value=cost+link.distance;if(value<costs[n]){costs[n]=value;push([value,n]);}
      }
    }
    return costs;
  }
  prepareSpawnPaths(prepared){
    if(prepared?.version===NAVIGATION_VERSION){
      this.linkCache=new Map(prepared.links);this.preparedLinkCache=new Map(this.linkCache);
      this.spawnRoutes=new Map(prepared.routes.map(([target,value])=>[target,{choices:value.choices,routes:new Map(value.routes)}]));
      this.windows.forEach((window,i)=>window.insideNode=prepared.insideNodes[i]);return;
    }
    // Prepare the whole walkable graph, including the interior, before Play.
    // Outside spawn routes alone left the first hunting zombies doing this work.
    for(let at=0;at<this.nodes.length;at++)for(const link of this.nodes[at].links){
      const n=link.node;if(n>=this.nodes.length||this.nodes[at].type===16||this.nodes[n].type===17)continue;
      const key=at+','+n;if(!this.linkCache.has(key))this.linkCache.set(key,this.walkableLink(this.nodes[at].origin,this.nodes[n].origin,true));
    }
    this.preparedLinkCache=new Map(this.linkCache);
    for(const window of this.windows){
      window.insideNode=this.nearest(window.entry,true);
      const group=this.mapRules?.group(window)||(window.outside[2]>100?'zombie_spawner_upstairs':window.outside[1]>700?'zombie_spawner_door':'zombie_spawner_init');
      const candidates=this.spawnEntities.filter(e=>e.targetname===group).map(e=>vec(e.origin)).sort((a,b)=>distance(a,window.outside)-distance(b,window.outside)),choices=[],routes=new Map();
      for(const origin of candidates){const route=this.path(origin,window.outside);if(!route.length)continue;choices.push(origin);routes.set(origin.join(','),route);if(choices.length===3)break;}
      this.spawnRoutes.set(window.target,{choices,routes});
    }
    // zombie_think: a zombie heads for one of the exterior goals nearest its
    // spawner, so prepare those spawner -> window routes as well.
    for(const spawner of this.spawnEntities){
      const origin=vec(spawner.origin),key=origin.join(',');
      for(const window of this.spawnerWindows(origin)){
        const prepared=this.spawnRoutes.get(window.target);if(!prepared||prepared.routes.has(key))continue;
        const route=this.path(origin,window.outside);if(route.length){prepared.choices.push(origin);prepared.routes.set(key,route);}
      }
    }
  }
  preparedNavigation(){return {version:NAVIGATION_VERSION,links:[...this.preparedLinkCache],insideNodes:this.windows.map(w=>w.insideNode),routes:[...this.spawnRoutes].map(([target,value])=>[target,{choices:value.choices,routes:[...value.routes]}])};}
  preparePowerNavigation(prepared){
    if(!this.mapRules)return;
    if(prepared?.version===POWER_NAVIGATION_VERSION&&prepared.navigationVersion===NAVIGATION_VERSION){
      this.powerNavigation={targets:prepared.targets,links:new Map(prepared.links)};return;
    }
    // Validate powered routes during preparation, including every state of
    // overlapping doors/barriers, so using the switch needs no physics sweeps.
    const power=new Set(POWER_TARGETS),changed=this.collision.brushes.filter(b=>power.has(b.target)),links=new Map(),disabled=this.collision.disabled;
    try{
      for(const key of this.linkCache.keys()){
        const [a,b]=key.split(',').map(Number),p=this.nodes[a].origin,q=this.nodes[b].origin;
        const low=[Math.min(p[0],q[0])-18,Math.min(p[1],q[1])-18,Math.min(p[2],q[2])-18],high=[Math.max(p[0],q[0])+18,Math.max(p[1],q[1])+18,Math.max(p[2],q[2])+88];
        const overlaps=brush=>brush.mins.every((v,k)=>v<=high[k])&&brush.maxs.every((v,k)=>v>=low[k]);
        if(!changed.some(overlaps))continue;
        const targets=[...new Set(this.collision.brushes.filter(b=>b.target&&!power.has(b.target)&&overlaps(b)).map(b=>b.target))].sort(),values=[];
        for(let mask=0;mask<2**targets.length;mask++){
          this.collision.disabled=new Set([...disabled,...POWER_TARGETS]);
          targets.forEach((target,i)=>{if(mask&(1<<i))this.collision.disabled.add(target);else this.collision.disabled.delete(target);});
          values.push(this.walkableLink(p,q,true));
        }
        links.set(key,{targets,values});
      }
    }finally{this.collision.disabled=disabled;}
    this.powerNavigation={targets:POWER_TARGETS,links};
  }
  preparedPowerNavigation(){return {version:POWER_NAVIGATION_VERSION,navigationVersion:NAVIGATION_VERSION,targets:this.powerNavigation.targets,links:[...this.powerNavigation.links]};}
  invalidateNavigation(targets){
    this.pathCache.clear();this.targetNodeDue=0;this.spawnDistanceCache=null;
    const changed=this.collision.brushes.filter(b=>targets.includes(b.target));
    const powered=this.powerNavigation?.targets.every(target=>this.collision.disabled.has(target));
    // Retain static-world links. Re-test only edges whose swept body/step bounds
    // overlap the changed clip brush; re-test now rather than on an AI tick.
    for(const key of this.linkCache.keys()){
      const [a,b]=key.split(',').map(Number),p=this.nodes[a].origin,q=this.nodes[b].origin;
      const low=[Math.min(p[0],q[0])-18,Math.min(p[1],q[1])-18,Math.min(p[2],q[2])-18],high=[Math.max(p[0],q[0])+18,Math.max(p[1],q[1])+18,Math.max(p[2],q[2])+88];
      if(changed.some(brush=>brush.mins.every((v,k)=>v<=high[k])&&brush.maxs.every((v,k)=>v>=low[k]))){
        const cached=powered&&this.powerNavigation.links.get(key);
        if(cached){const mask=cached.targets.reduce((bits,target,i)=>bits|(this.collision.disabled.has(target)?1<<i:0),0);this.linkCache.set(key,cached.values[mask]);}
        else this.linkCache.set(key,this.walkableLink(p,q,true));
      }
    }
  }
  // zombie_think: the three exterior goals nearest the spawner, stopping where
  // the next one is more than 500 units farther than the previous.
  spawnerWindows(origin){
    const nodes=this.windows.slice().sort((a,b)=>distance(a.outside,origin)-distance(b.outside,origin)).slice(0,3),out=[nodes[0]];
    for(let i=1;i<nodes.length;i++){if(distance(nodes[i].outside,origin)-distance(nodes[i-1].outside,origin)>500)break;out.push(nodes[i]);}
    return out.filter(Boolean);
  }
  // level.enemy_spawns. Nacht: the initial spawners, plus the help room and
  // upstairs sets once those open (add_new_zombie_spawners). Der Riese: the
  // zone manager's occupied and adjacent zones.
  enabledSpawners(){
    if(this.mapRules)return this.mapRules.enabledSpawners();
    const groups=new Set(['zombie_spawner_init']);
    if(this.opened.has('auto34'))groups.add('zombie_spawner_door');
    if(this.opened.has('upstairs_blocker'))groups.add('zombie_spawner_upstairs');
    return this.spawnEntities.filter(e=>groups.has(e.targetname));
  }
  holdsSpot(enemy){return !!enemy&&!enemy.dead&&enemy.stage==='barrier'&&enemy.window?.attackers?.[enemy.spot]===enemy;}
  spawnEnemy() {
    // round_spawning picks a random enabled spawner (not by player distance);
    // the zombie then takes one of the windows nearest that spawner.
    const available=new Set(this.availableWindows()),options=[];
    for(const spawner of this.enabledSpawners()){
      const origin=vec(spawner.origin),key=origin.join(','),windows=this.spawnerWindows(origin).filter(w=>available.has(w)&&this.spawnRoutes.get(w.target)?.routes.has(key));
      if(windows.length)options.push({origin,key,windows});
    }
    if(options.length){
      const pick=options[Math.floor(Math.random()*options.length)],window=pick.windows[Math.floor(Math.random()*pick.windows.length)],route=this.spawnRoutes.get(window.target).routes.get(pick.key),gait=this.zombieGait();
      const enemy={id:this.nextId++,position:pick.origin.slice(),previousPosition:pick.origin.slice(),health:this.zombieHealth,window,stage:'approach',path:route.map(p=>p.slice()),entryDistance:distance(pick.origin,window.outside),attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:this.time,gait:gait.name,speed:gait.speed};
      this.enemies.push(enemy);this.remaining--;this.emit('spawn',enemy);return;
    }
    // Fallback when no enabled spawner has a prepared route (should not happen).
    const candidates=this.spawnCandidates();if(!candidates.length)throw new Error('No accessible original window entry points');
    let pick=Math.random()*candidates.reduce((sum,c)=>sum+c.weight,0),selected=candidates.at(-1);
    for(const candidate of candidates){pick-=candidate.weight;if(pick<0){selected=candidate;break;}}
    const window=selected.window;
    const prepared=this.spawnRoutes.get(window.target),spawns=prepared?.choices?.length?prepared.choices:this.spawnPoints.slice().sort((a,b)=>distance(a,window.outside)-distance(b,window.outside));
    const origin=spawns[Math.floor(Math.random()*Math.min(3,spawns.length))].slice();
    const route=prepared?.routes.get(origin.join(','));
    const gait=this.zombieGait();
    const enemy={id:this.nextId++,position:origin,previousPosition:origin.slice(),health:this.zombieHealth,window,stage:'approach',path:route?route.map(p=>p.slice()):this.path(origin,window.outside),entryDistance:selected.distance,attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:this.time,gait:gait.name,speed:gait.speed};
    this.enemies.push(enemy);this.remaining--;this.emit('spawn',enemy);
  }
  zombieGait(){
    // set_run_speed(): level.zombie_move_speed is 1 in round 1, then the
    // previous round number * 8; a roll of <=35 walks, <=70 runs, else sprints.
    const base=this.round<=1?1:(this.round-1)*8,roll=base+Math.floor(Math.random()*35);
    const kind=roll<=35?'walk':roll<=70?'run':'sprint',animations=this.presentation.animations||{};
    const names=ZOMBIE_GAITS[kind].filter(name=>animations[name]),name=names[Math.floor(Math.random()*names.length)]||'ai_zombie_walk_v1';
    return {name,speed:gaitSpeed(animations[name])};
  }
  advancePath(enemy,dt,target) {
    let destination=enemy.path[0]||target,dx=destination[0]-enemy.position[0],dy=destination[1]-enemy.position[1],length=Math.hypot(dx,dy);
    while(length<1&&Math.abs(destination[2]-enemy.position[2])<18&&enemy.path.length){enemy.path.shift();destination=enemy.path[0]||target;dx=destination[0]-enemy.position[0];dy=destination[1]-enemy.position[1];length=Math.hypot(dx,dy);}
    if(length<1&&Math.abs(destination[2]-enemy.position[2])<18)return true;
    enemy.angle=Math.atan2(dy,dx);const step=Math.min(enemy.speed*dt,length);
    enemy.velocityZ=(enemy.velocityZ||0)-800*dt;
    // Some slope seams trap an actor in a tiny slide-and-drop loop at certain
    // step lengths. With no progress toward the waypoint for half a second,
    // angle 60 degrees off to one side briefly, alternating sides.
    enemy.moveClock=(enemy.moveClock||0)+dt;
    if(enemy.moveClock>=(enemy.progressDue||0)){
      const same=enemy.progressPoint&&Math.hypot(enemy.progressPoint[0]-destination[0],enemy.progressPoint[1]-destination[1])<1;
      if(same&&enemy.progressDistance-length<enemy.speed*.5*.25){enemy.detourUntil=enemy.moveClock+.35;enemy.detourSide=enemy.detourSide>0?-1:1;}
      enemy.progressPoint=destination.slice(0,2);enemy.progressDistance=length;enemy.progressDue=enemy.moveClock+.5;
    }
    if(enemy.moveClock<(enemy.detourUntil||0)&&length>step){
      const turn=enemy.detourSide*Math.PI/3,c=Math.cos(turn),s=Math.sin(turn);[dx,dy]=[dx*c-dy*s,dx*s+dy*c];
    }
    const previous=enemy.position;let result=this.collision.step(previous,[length?dx/length*step:0,length?dy/length*step:0,enemy.velocityZ*dt],[14,14,35]);
    // Slow walk clips move ~0.2 units per tick, below the step-up tolerances;
    // when that is blocked, retry with a run-sized step that clears the ledge.
    const moved=r=>Math.hypot(r.position[0]-previous[0],r.position[1]-previous[1]);
    if(step<.5&&length>step&&moved(result)<step*.5){
      const amount=Math.min(1.2,length),attempt=this.collision.step(previous,[dx/length*amount,dy/length*amount,enemy.velocityZ*dt],[14,14,35]);
      if(moved(attempt)>amount*.5)result=attempt;
    }
    enemy.position=result.position;if(result.grounded)enemy.velocityZ=0;
    return Math.hypot(enemy.position[0]-target[0],enemy.position[1]-target[1])<1&&Math.abs(enemy.position[2]-target[2])<18;
  }
  tickEnemy(enemy,dt) {
    if(enemy.dead)return;enemy.age+=dt;enemy.attacking=false;
    if(enemy.stage==='approach') {
      if(this.advancePath(enemy,dt,enemy.window.outside)){enemy.stage='barrier';enemy.angle=enemy.window.angle;enemy.tear=null;}
    } else if(enemy.stage==='barrier') {
      const w=enemy.window;enemy.angle=w.angle;
      // tear_into_building: a window has three attack spots (in front of the
      // boards and 28 units either side). Only a zombie holding a spot tears;
      // the rest wait and retry every 0.5 s.
      if(w.boards>0&&!this.holdsSpot(enemy)){
        if(this.time>=(enemy.spotRetry||0)){
          const free=[0,1,2].filter(i=>!this.holdsSpot(w.attackers?.[i]));
          if(free.length){enemy.spot=free[Math.floor(Math.random()*free.length)];(w.attackers??=[])[enemy.spot]=enemy;enemy.spotDue=this.time+1.5;enemy.atSpot=false;}
          else enemy.spotRetry=this.time+.5;
        }
        if(!this.holdsSpot(enemy))return;
      }
      if(w.boards>0&&!enemy.atSpot){
        // Walk to the spot first (SetGoalPos + orientdone in the original).
        const right=[Math.sin(w.angle),-Math.cos(w.angle)],offset=[0,28,-28][enemy.spot],target=[w.outside[0]+right[0]*offset,w.outside[1]+right[1]*offset,w.outside[2]];
        enemy.path=[];enemy.atSpot=this.advancePath(enemy,dt,target)||this.time>=enemy.spotDue;enemy.angle=w.angle;if(!enemy.atSpot)return;
      }
      if(enemy.tear){
        const elapsed=this.time-enemy.tear.started;
        if(!enemy.tear.removed&&elapsed>=enemy.tear.hit){enemy.tear.removed=true;if(enemy.window.boards>0){enemy.window.boards--;this.emit('barrier',enemy.window);this.emit('sound',{alias:'remove_boards',volume:.3});}}
        if(elapsed>=enemy.tear.duration)enemy.tear=null;
      }
      if(!enemy.tear&&enemy.window.boards>0){
        const board=enemy.window.boardEntities[enemy.window.boards-1],height=vec(board?.origin)[2]-enemy.position[2];
        const name=height>70?'ai_zombie_door_tear_high':height<40?'ai_zombie_door_tear_low':enemy.id%2?'ai_zombie_door_tear_left':'ai_zombie_door_tear_right';
        const data=this.presentation.animations?.[name],duration=data?.duration||2.4,hit=(data?.notifies.find(n=>n.name==='board')?.time??.5)*duration;
        enemy.tear={name,started:this.time,duration,hit,removed:false};
      }
      if(!enemy.tear&&enemy.window.boards===0&&(!enemy.window.traverser||enemy.window.traverser.dead)){
        enemy.window.traverser=enemy;enemy.stage='enter';enemy.path=[];
        if(!this.collision.disabled.has(enemy.window.target)){this.collision.disabled.add(enemy.window.target);this.invalidateNavigation([enemy.window.target]);}
      }
    } else if(enemy.stage==='enter') {
      const previous=enemy.position.slice(),arrived=this.advancePath(enemy,dt,enemy.window.begin),begin=enemy.window.begin;
      // The factory's animation start markers can sit on the window sill.
      // Walking hulls stop just before that sill; begin the native climb there
      // once movement is blocked, instead of requiring a walk onto the frame.
      const atSill=this.mapRules&&distance(previous,enemy.position)<.01&&
        Math.hypot(enemy.position[0]-begin[0],enemy.position[1]-begin[1])<24&&Math.abs(enemy.position[2]-begin[2])<72;
      if(arrived||atSill){
        enemy.stage='traverse';enemy.traverseFrom=enemy.position.slice();enemy.traverseTime=0;enemy.angle=enemy.window.angle;
        enemy.traverseAnim=enemy.id%2?'ai_zombie_traverse_v1':'ai_zombie_traverse_v2';
        enemy.traverseDuration=this.presentation.animations?.[enemy.traverseAnim]?.duration||1.5;
      }
    } else if(enemy.stage==='traverse') {
      enemy.traverseTime=Math.min(enemy.traverseDuration,enemy.traverseTime+dt);
      const motion=this.presentation.animations?.[enemy.traverseAnim]?.motion,first=motion?.[0],last=motion?.at(-1);
      let fraction=enemy.traverseTime/enemy.traverseDuration,height=0;
      if(motion?.length>1){
        let at=1;while(at<motion.length-1&&motion[at][0]<enemy.traverseTime)at++;
        const a=motion[at-1],b=motion[at],t=Math.min(1,Math.max(0,(enemy.traverseTime-a[0])/(b[0]-a[0]||1)));
        const x=a[1]+(b[1]-a[1])*t,z=a[3]+(b[3]-a[3])*t;
        fraction=Math.min(1,Math.max(0,(x-first[1])/(last[1]-first[1]||1)));height=z-first[3]-(last[3]-first[3])*fraction;
      }
      enemy.position=lerp(enemy.traverseFrom,enemy.window.entry,fraction);enemy.position[2]+=height;
      if(enemy.traverseTime>=enemy.traverseDuration){enemy.position=enemy.window.entry.slice();enemy.stage='hunt';enemy.navDue=0;enemy.window.traverser=null;}
    } else if(enemy.stage==='hunt') {
      const player=this.player.position;
      if(this.time>=(enemy.sightDue||0)){
        // A single blocked check (a prop corner or step edge) must not flip a
        // chasing zombie onto a graph route and back; require two in a row.
        const sight=this.walkableLink(enemy.position,player);enemy.blocked=sight?0:(enemy.blocked||0)+1;
        const clear=sight||!!enemy.clear&&enemy.blocked<2;
        if(enemy.clear&&!clear)enemy.navDue=0;
        enemy.clear=clear;
        // Keep ten checks per second per actor, distributed across physics
        // ticks instead of making a whole wave perform them in one frame.
        const phase=(enemy.id%12)*PHYSICS_STEP;enemy.sightDue=(Math.floor((this.time-phase)/.1)+1)*.1+phase;
      }
      const clear=enemy.clear;
      if(clear&&distance(enemy.position,player)<58) {
        enemy.attacking=true;
        enemy.angle=Math.atan2(player[1]-enemy.position[1],player[0]-enemy.position[0]);
        if(this.time>=enemy.attackDue){this.damagePlayer(50);enemy.attackDue=this.time+1.1;}
      } else if(clear){enemy.path=[];this.advancePath(enemy,dt,player);}
      else {
        // Route on losing sight, and again shortly after finishing a route,
        // instead of standing until the next 1.25 s refresh.
        if(this.time>=enemy.navDue||!enemy.path.length&&this.time>=(enemy.retryDue||0)){
          enemy.path=this.path(enemy.position,player,true);enemy.navDue=this.time+1.25+enemy.id%5*.03;enemy.retryDue=this.time+.25;
          // Routes begin at the nearest reachable node, often behind a zombie
          // already moving toward the player; skip nodes it can walk past.
          for(let i=0;i<3&&enemy.path.length>1&&this.walkableLink(enemy.position,enemy.path[1]);i++)enemy.path.shift();
        }
        if(enemy.path.length)this.advancePath(enemy,dt,enemy.path[enemy.path.length-1]);
      }
    }
  }
  separateZombies(dt){
    // Hunting zombies keep body room (two 14-unit hull radii) instead of
    // stacking into one model when trained. Window queues stay as they were:
    // approach/barrier/traverse stages rely on reaching exact marks.
    const hunters=this.enemies.filter(e=>!e.dead&&e.stage==='hunt');if(hunters.length<2)return;
    const push=new Map(),radius=28,rate=Math.min(1,dt*12);
    for(let i=0;i<hunters.length;i++)for(let j=i+1;j<hunters.length;j++){
      const a=hunters[i],b=hunters[j];if(Math.abs(a.position[2]-b.position[2])>48)continue;
      let dx=b.position[0]-a.position[0],dy=b.position[1]-a.position[1],d=Math.hypot(dx,dy);if(d>=radius)continue;
      if(d<.01){const angle=(a.id*7+b.id*13)%360*Math.PI/180;dx=Math.cos(angle);dy=Math.sin(angle);d=1;}else{dx/=d;dy/=d;}
      const amount=(radius-Math.max(d,.01))*.5*rate;
      for(const [e,sign] of [[a,-1],[b,1]]){const p=push.get(e)||[0,0];p[0]+=dx*amount*sign;p[1]+=dy*amount*sign;push.set(e,p);}
    }
    for(const [e,p] of push){
      const length=Math.hypot(p[0],p[1]);if(length<.02)continue;const scale=Math.min(1,2/length);
      // Through the collision world, so a shove never puts a zombie in a wall.
      e.position=this.collision.step(e.position,[p[0]*scale,p[1]*scale,0],[14,14,35]).position;
    }
  }
  // A save is a snapshot of the whole session at the game clock: live zombies
  // (stage, route, health, gait, barrier spot), round progress and timers,
  // drops, active powerups, the mystery box, live grenades and map state.
  // Viewmodel-only actions (perk drink, Pack-a-Punch, grenade in hand) must end first.
  canSave(){return ['round','between'].includes(this.phase)&&!this.gesture&&!this.mapRules?.pap&&!this.pendingGrenade;}
  saveState(){
    const plain=v=>v==null?v:JSON.parse(JSON.stringify(v));
    return {version:2,time:this.time,elapsed:this.elapsed,phase:this.phase,round:this.round,zombieHealth:this.zombieHealth,roundBaseHealth:this.roundBaseHealth,
      remaining:this.remaining,spawnDue:this.spawnDue,roundDue:this.roundDue,roundStartedAt:this.roundStartedAt,roundEndedAt:this.roundEndedAt,barrierReward:this.barrierReward,
      ambientDue:this.ambientDue,lastDamage:this.lastDamage,cooldown:this.cooldown,meleeDue:this.meleeDue,rebuildDue:this.rebuildDue,nextId:this.nextId,nextDropId:this.nextDropId,shots:this.shots,hits:this.hits,powerupOrder:this.powerupOrder.slice(),powerupIndex:this.powerupIndex,
      player:{position:this.player.position.slice(),health:this.player.health,points:this.player.points,kills:this.player.kills,headshots:this.player.headshots,grenades:this.player.grenades,velocityZ:this.player.velocityZ},
      yaw:this.yaw,pitch:this.pitch,inventory:this.inventory.map(w=>({name:w.name,clip:w.clip,reserve:w.reserve})),slot:this.slot,
      opened:[...this.opened],disabled:[...this.collision.disabled],
      windows:this.windows.map(w=>({target:w.target,boards:w.boards,attackers:[0,1,2].map(i=>this.holdsSpot(w.attackers?.[i])?w.attackers[i].id:null),traverser:w.traverser&&!w.traverser.dead?w.traverser.id:null})),
      enemies:this.enemies.filter(e=>!e.dead).map(({window,previousPosition,...rest})=>({...plain(rest),window:window?.target})),
      powerup:{...this.powerup},carpenter:plain(this.carpenter),
      drops:this.drops.filter(d=>!d.used).map(d=>({id:d.id,type:d.type,position:d.position.slice(),expires:d.expires,spawned:d.spawned})),
      grenades:this.grenades.filter(g=>!g.held&&!g.exploded).map(g=>({position:g.position.slice(),velocity:g.velocity.slice(),due:g.due,spawned:g.spawned,resting:g.resting,bounceAt:g.bounceAt})),
      boxes:[...this.boxes].map(([target,{entity,...box}])=>[target,plain(box)]),
      rules:this.mapRules?.saveState()};
  }
  loadState(s){
    if(s.version!==2)return this.loadLegacyState(s);
    this.newGame();
    for(const key of ['time','elapsed','round','zombieHealth','roundBaseHealth','remaining','spawnDue','roundDue','roundStartedAt','roundEndedAt','barrierReward','ambientDue','lastDamage','cooldown','meleeDue','rebuildDue','nextId','nextDropId','shots','hits','powerupOrder','powerupIndex','yaw','pitch'])if(s[key]!==undefined)this[key]=s[key];
    this.powerup={...s.powerup};
    for(const target of s.opened)this.opened.add(target);for(const target of s.disabled)this.collision.disabled.add(target);
    if(s.disabled.length)this.invalidateNavigation(s.disabled);
    this.mapRules?.loadState(s.rules);
    const weapons=s.inventory.filter(w=>this.data.weapons[w.name]).map(w=>({...this.makeWeapon(w.name),clip:w.clip,reserve:w.reserve,raised:true}));
    this.inventory=weapons.length?weapons:[this.makeWeapon('zombie_colt')];this.slot=Math.min(s.slot,this.inventory.length-1);this.inventory[this.slot].raised=true;
    Object.assign(this.player,s.player,{position:s.player.position.slice(),previousPosition:s.player.position.slice(),velocityZ:s.player.velocityZ||0});
    const windows=new Map(this.windows.map(w=>[w.target,w])),enemies=new Map();
    for(const saved of s.enemies){
      const window=windows.get(saved.window);if(!window)continue;
      const enemy={...saved,window,previousPosition:saved.position.slice(),path:saved.path||[]};
      this.enemies.push(enemy);enemies.set(enemy.id,enemy);this.emit('spawn',enemy);
    }
    for(const saved of s.windows){
      const w=windows.get(saved.target);if(!w)continue;
      w.boards=saved.boards;w.attackers=saved.attackers.map(id=>enemies.get(id)||null);w.traverser=enemies.get(saved.traverser)||null;
    }
    for(const saved of s.drops){const drop={...saved,position:saved.position.slice(),restored:true};this.drops.push(drop);this.emit('drop',drop);this.dropLoop(drop);}
    this.carpenter=s.carpenter||null;if(this.carpenter)this.emit('loop',{id:'carpenter',alias:'carp_loop',position:this.carpenter.origin.slice(),near:150,far:1400});
    for(const saved of s.grenades){const g={...saved,position:saved.position.slice(),previousPosition:saved.position.slice(),held:false};this.grenades.push(g);this.emit('grenade',g);}
    for(const [target,box]of s.boxes){const current=this.boxes.get(target);if(current)Object.assign(current,box);}
    this.phase=s.phase;this.resumed=true;
    for(const target of this.opened)this.emit('open',{target});for(const w of this.windows)this.emit('barrier',w);
    if(this.mapRules)this.emit('power');this.emit('weapon',this.weapon);
  }
  // Version 1 saves (before full snapshots) restart the saved round with
  // everything the player earned but no live zombies.
  loadLegacyState(s){
    this.newGame();
    this.round=s.round;this.zombieHealth=s.zombieHealth;this.yaw=s.yaw;this.pitch=s.pitch;
    for(const target of s.opened)this.opened.add(target);for(const target of s.disabled)this.collision.disabled.add(target);
    if(s.disabled.length)this.invalidateNavigation(s.disabled);
    const boards=new Map(s.boards);for(const w of this.windows)if(boards.has(w.target))w.boards=boards.get(w.target);
    this.mapRules?.loadState(s.rules);
    const weapons=s.inventory.filter(w=>this.data.weapons[w.name]).map(w=>({...this.makeWeapon(w.name),clip:w.clip,reserve:w.reserve}));
    this.inventory=weapons.length?weapons:[this.makeWeapon('zombie_colt')];this.slot=Math.min(s.slot,this.inventory.length-1);for(const w of this.inventory)w.raised=true;
    const floor=this.collision.move(s.player.position,[0,0,-64]);
    Object.assign(this.player,s.player,{position:floor.position,previousPosition:floor.position.slice(),velocityZ:0,grounded:floor.grounded});
    for(const target of this.opened)this.emit('open',{target});for(const w of this.windows)this.emit('barrier',w);
    if(this.mapRules)this.emit('power');this.emit('weapon',this.weapon);
  }
  startGesture(key,onRaised){
    // perk_give_bottle_begin / upgrade_knuckle_crack_begin: the gun is put
    // away, a viewmodel-only clip plays, then the gun is raised again. Firing,
    // aiming, sprinting, melee, reloads, grenades and switching are disabled.
    const d=this.data.gestures?.[key];if(!d){onRaised?.();return false;}
    this.reloadEnd=0;this.pendingFire=false;this.sprinting=false;this.pendingMelee=null;this.switching=null;
    this.gesture={key,definition:d,phase:'raise',due:this.time+d.firstRaiseTime,onRaised};
    this.emit('gesture',{phase:'raise',key,definition:d,duration:d.firstRaiseTime});return true;
  }
  updateGesture(){
    const g=this.gesture;if(!g||this.time<g.due)return;
    if(g.phase==='raise'){g.onRaised?.();g.phase='drop';g.due=this.time+g.definition.dropTime;this.emit('gesture',{phase:'drop',key:g.key,definition:g.definition,duration:g.definition.dropTime});}
    else if(g.phase==='drop'){g.phase='return';g.due=this.time+.5;this.emit('gesture',{phase:'return',key:g.key,duration:.5});}
    else this.gesture=null;
  }
  damagePlayer(amount) {
    if(this.phase==='dead')return;
    this.player.health=Math.max(0,this.player.health-amount);this.lastDamage=this.time;this.emit('damage',amount);
    if(this.player.health===0){this.phase='dead';this.emit('death',{round:this.round,kills:this.player.kills,points:this.player.points});}
  }
  update(dt,input={}) {
    if(['ready','dead'].includes(this.phase))return;
    this.jumpQueued||=!!input.jump;
    if(!Number.isFinite(dt)||dt<=0)return;
    // Rendering can run at 240 FPS (including Firefox's rounded/duplicate frame
    // timestamps); movement and collision always advance at the same 120 Hz.
    this.accumulator+=Math.min(dt,.1);
    while(this.accumulator+1e-9>=PHYSICS_STEP&&this.phase!=='dead') {
      this.accumulator=Math.max(0,this.accumulator-PHYSICS_STEP);
      this.tick(PHYSICS_STEP,{...input,jump:input.jump||this.jumpQueued});this.jumpQueued=false;this.physicsTicks++;
    }
  }
  tick(dt,input) {
    if(['ready','dead'].includes(this.phase))return;
    this.enemies=this.enemies.filter(enemy=>{if(enemy.dead&&this.time-enemy.deathTime>5){this.emit('removeEnemy',enemy);return false;}return true;});
    dt=Math.min(dt,.05);this.player.previousPosition.splice(0,3,...this.player.position);
    for(const enemy of this.enemies){enemy.previousPosition??=enemy.position.slice();enemy.previousPosition.splice(0,3,...enemy.position);}
    this.time+=dt;this.elapsed+=dt;this.expireScorePopups();this.updateBoxes();this.mapRules?.tick();
    if(this.pendingMelee&&this.time>=this.pendingMelee.due){this.resolveMelee();this.pendingMelee=null;}
    this.updateGesture();this.updateSwitch();
    if(this.phase==='between'&&this.time>=this.roundDue)this.startRound();
    if(this.phase==='round'&&this.remaining>0&&this.time>=this.spawnDue&&this.enemies.filter(x=>!x.dead).length<MAX_ALIVE){this.spawnEnemy();this.spawnDue=this.time+spawnDelay(this.round,this.vars.zombie_spawn_delay);}
    if(this.phase==='round'&&this.remaining===0&&this.enemies.every(x=>x.dead)) {
      this.phase='between';this.roundEndedAt=this.time;this.roundDue=this.time+this.vars.zombie_between_round_time;
      this.emit('sound',{alias:'round_over'});
    }
    if(this.time>=this.ambientDue){this.emit('sound',{alias:'amb_spooky_2d'});this.ambientDue=this.time+5+Math.random()*3;}
    if(this.time>=this.reloadEnd&&this.reloadEnd>0) {
      const w=this.weapon,amount=Math.min(w.definition.clipSize-w.clip,w.reserve);w.clip+=amount;w.reserve-=amount;this.reloadEnd=0;this.emit('reloaded');
    }
    const p=this.player,forward=[Math.cos(this.yaw),Math.sin(this.yaw)],right=[Math.sin(this.yaw),-Math.cos(this.yaw)];
    if(this.sprinting&&input.fire)this.fire();
    let dx=forward[0]*(input.forward||0)+right[0]*(input.side||0),dy=forward[1]*(input.forward||0)+right[1]*(input.side||0);
    const len=Math.hypot(dx,dy);this.sprinting=!!input.sprint&&(input.forward||0)>0&&len>0&&this.ads<.1&&!this.reloadEnd&&!this.pendingGrenade&&this.time>=this.meleeDue&&!input.fire&&!this.pendingFire&&this.time>=this.sprintExitUntil&&this.time>=this.cooldown&&p.grounded&&!this.gesture&&!this.switching;
    const speed=(this.sprinting?285:190)*this.weapon.definition.moveSpeedScale;
    this.moving=len>0;this.spreadBloom=Math.max(0,this.spreadBloom-dt*(this.weapon.definition.hipSpreadDecayRate||4));
    if(len){dx=dx/len*speed*dt;dy=dy/len*speed*dt;}
    if(input.jump&&p.grounded){p.velocityZ=270;p.grounded=false;}
    p.velocityZ-=800*dt;
    const result=this.collision.step(p.position,[dx,dy,p.velocityZ*dt]);p.position=result.position;p.grounded=result.grounded;
    if(p.grounded)p.velocityZ=0;
    if(p.position[2]<-600)this.damagePlayer(100);
    if(this.time-this.lastDamage>3)p.health=Math.min(this.mapRules?.maxHealth||100,p.health+30*dt);
    for(const enemy of this.enemies)this.tickEnemy(enemy,dt);
    this.separateZombies(dt);
    this.updateGrenades(dt);
    if(this.pendingFire&&this.time+1e-9>=this.sprintExitUntil){this.pendingFire=false;this.fire();}
    if(input.fire&&this.weapon.definition.fireType==='Full Auto')this.fire();
    // blocker_trigger_think: 0.4 s after use goes down, then one board per second while held.
    if(input.use&&!this.useHeld)this.rebuildDue=Math.max(this.rebuildDue,this.time+.4);this.useHeld=!!input.use;
    if(input.use&&!this.pendingGrenade&&!this.gesture&&!this.nearGrenade()&&this.time>=this.rebuildDue){const w=this.nearWindow();if(w)this.rebuild(w);}
    for(const drop of this.drops)if(!drop.used&&distance([drop.position[0],drop.position[1],drop.position[2]+40],p.position)<64)this.pickup(drop);
    for(const d of this.drops)if(!d.used&&this.time>=d.expires)this.emit('stopLoop',{id:'drop'+d.id});
    this.drops=this.drops.filter(d=>!d.used&&this.time<d.expires);this.updateCarpenter();
    for(const key of Object.keys(this.powerup))if(this.powerup[key]<=this.time)delete this.powerup[key];
  }
  aim(yaw,pitch){this.yaw=yaw;this.pitch=pitch;}
  rayHit(range=16000,yaw=this.yaw,pitch=this.pitch) {
    const origin=[this.player.position[0],this.player.position[1],this.player.position[2]+60];
    const dir=[Math.cos(yaw)*Math.cos(pitch),Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch)];
    // Browser gunfire follows visible surfaces, including gaps in props. The
    // walking hulls and invisible clips continue to govern actor movement.
    if(this.events.traceShot)return this.events.traceShot(origin,dir,range);
    const wall=this.collision.trace(origin,origin.map((v,i)=>v+dir[i]*range),[0,0,0],1);
    let nearest=range*wall.fraction,result=null;
    if(this.events.traceEnemy) {
      result=this.events.traceEnemy(origin,dir,nearest);if(result)nearest=result.distance;
      return {hit:result,origin,dir,end:origin.map((v,i)=>v+dir[i]*nearest),wall:!result&&wall.fraction<1,normal:wall.normal};
    }
    for(const enemy of this.enemies) {
      if(enemy.dead)continue;const p=enemy.position;
      const head=rayBox(origin,dir,[p[0]-8,p[1]-8,p[2]+58],[p[0]+8,p[1]+8,p[2]+73],nearest);
      const body=rayBox(origin,dir,[p[0]-15,p[1]-15,p[2]+4],[p[0]+15,p[1]+15,p[2]+58],nearest);
      const hit=head!==null?head:body;
      if(hit!==null&&hit<nearest){nearest=hit;result={enemy,head:head!==null,distance:hit};}
    }
    return {hit:result,origin,dir,end:origin.map((v,i)=>v+dir[i]*nearest),wall:!result&&wall.fraction<1,normal:wall.normal};
  }
  fire() {
    if(['dead','ready'].includes(this.phase)||this.gesture||this.switching||this.pendingGrenade||this.time<this.cooldown||this.time<this.meleeDue||this.reloadEnd)return false;
    if(this.sprinting){this.sprinting=false;this.pendingFire=true;this.sprintExitUntil=this.time+(this.weapon.definition.sprintOutTime||.3);return false;}
    if(this.pendingFire||this.time+1e-9<this.sprintExitUntil)return false;
    const w=this.weapon;if(w.clip<=0){this.reload();return false;}
    const d=w.definition;
    w.clip--;this.cooldown=this.time+Math.max(.075,(d.fireTime+(d.rechamberAnim&&w.clip>0?d.rechamberTime:0))*(this.mapRules?.fireScale||1));this.shots++;
    const hip=Math.min(d.hipSpreadMax||6,(d.hipSpreadStandMin||0)+this.spreadBloom+(this.moving?d.hipSpreadMoveAdd||0:0));
    const spread=(hip*(1-this.ads)+(d.adsSpread||0)*this.ads)*Math.PI/180;
    const rays=[];
    for(let pellet=0;pellet<Math.max(1,d.shotCount||1);pellet++) {
    const radius=Math.sqrt(Math.random())*spread,angle=Math.random()*Math.PI*2;
    const ray=this.rayHit(16000,this.yaw+Math.cos(angle)*radius/Math.max(.2,Math.cos(this.pitch)),this.pitch+Math.sin(angle)*radius);rays.push(ray);if(ray.hit) {
      this.hits++;const d=w.definition,maxRange=d.maxDamageRange||1000,minRange=Math.max(maxRange+1,d.minDamageRange||4000);
      const falloff=Math.min(1,Math.max(0,(ray.hit.distance-maxRange)/(minRange-maxRange)));
      const base=d.damage+(d.minDamage-d.damage)*falloff;
      this.hitEnemy(ray.hit.enemy,base*(ray.hit.head?d.locHead:d.locTorsoUpper),ray.hit.head,false);this.emit('hit',ray.hit.head);
    }
    }
    this.spreadBloom+=d.hipSpreadFireAdd||0;
    this.emit('shot',{...rays[0],rays});this.emit('sound',{alias:d.fireSoundPlayer||d.fireSound});return true;
  }
  hitEnemy(enemy,damage,head=false,melee=false) {
    if(enemy.dead)return;
    if(this.powerup.insta_kill)damage=enemy.health;
    enemy.health-=damage;
    const scalar=this.powerup.double_points?2:1;
    if(enemy.health>0){this.changePoints(Math.ceil(this.vars.zombie_score_damage/10)*10*scalar);return;}
    enemy.dead=true;enemy.deathTime=this.time;this.player.kills++;if(head)this.player.headshots++;
    const bonus=melee?this.vars.zombie_score_bonus_melee:head?this.vars.zombie_score_bonus_head:this.vars.zombie_score_bonus_torso;
    this.changePoints(Math.ceil((this.vars.zombie_score_kill+bonus)/10)*10*scalar);this.emit('kill',enemy);
    // Hunt starts only after the barrier traversal has finished inside the map.
    // Outside and mid-vault kills still award points, but cannot drop powerups.
    if(enemy.stage==='hunt'&&(this.player.kills%6===0||Math.random()<.08)) {
      this.addDrop(this.nextPowerup(),enemy.position);
    }
  }
  melee() {
    if(['dead','ready'].includes(this.phase)||this.gesture||this.switching||this.pendingGrenade||this.time<this.meleeDue)return;
    const d=this.weapon.definition;this.meleeDue=this.time+(d.meleeTime||.5);this.reloadEnd=0;this.pendingFire=false;
    this.pendingMelee={due:this.time+(d.meleeDelay||.05),damage:d.meleeDamage||150};
    this.emit('melee',{duration:d.meleeTime||.5});this.emit('sound',{alias:d.meleeSwipeSoundPlayer});
  }
  resolveMelee() {
    const origin=this.player.position;
    const targets=this.enemies.filter(e=>!e.dead&&distance(e.position,origin)<95&&Math.cos(Math.atan2(e.position[1]-origin[1],e.position[0]-origin[0])-this.yaw)>.55);
    const enemy=targets.sort((a,b)=>distance(a.position,origin)-distance(b.position,origin))[0];
    if(enemy&&this.collision.trace([origin[0],origin[1],origin[2]+40],[enemy.position[0],enemy.position[1],enemy.position[2]+40],[0,0,0],1).fraction>.95){this.hitEnemy(enemy,this.pendingMelee.damage,false,true);this.emit('hit',false);this.emit('sound',{alias:'melee_hit'});}
  }
  reload() {
    const w=this.weapon;if(this.gesture||this.switching||this.pendingGrenade||this.reloadEnd||this.phase==='dead'||w.clip===w.definition.clipSize||!w.reserve)return;
    const duration=(w.clip===0?w.definition.reloadEmptyTime:w.definition.reloadTime)*(this.mapRules?.reloadScale||1);
    this.pendingFire=false;this.reloadEnd=this.time+duration;this.emit('reload',{empty:w.clip===0,duration});
  }
  switchWeapon(){if(this.gesture||this.pendingGrenade||this.switching||this.inventory.length<2)return;const previous=this.weapon;this.slot=(this.slot+1)%this.inventory.length;this.beginSwitch(previous);}
  giveWeapon(name) {
    const previous=this.weapon,owned=this.inventory.findIndex(w=>w.name===name);
    if(owned>=0){this.inventory[owned]=this.makeWeapon(name);this.slot=owned;}
    else {if(this.inventory.length<2)this.inventory.push(this.makeWeapon(name));else this.inventory[this.slot]=this.makeWeapon(name);this.slot=this.inventory.findIndex(w=>w.name===name);}
    this.beginSwitch(previous);
  }
  // SwitchToWeapon: the current gun plays its putaway (empty variant at 0 ammo)
  // for dropTime, then the new gun its pullout for raiseTime. A weapon's first
  // draw uses firstRaiseAnim/firstRaiseTime. Firing, aiming, reloading, melee,
  // grenades and sprint wait for the raise to finish.
  beginSwitch(previous){
    this.reloadEnd=0;this.pendingFire=false;this.sprinting=false;
    const d=previous?.definition,empty=previous?.clip===0,anim=d&&((empty&&d.emptyDropAnim)||d.dropAnim),duration=d?((empty&&d.emptyDropTime)||d.dropTime||0):0;
    this.switching={phase:'drop',due:this.time+(anim?duration:0)};
    if(anim&&duration>0){this.emit('weaponSwitch',{phase:'drop',anim,duration});if(d.putawaySoundPlayer)this.emit('sound',{alias:d.putawaySoundPlayer});}
  }
  updateSwitch(){
    const s=this.switching;if(!s||this.time<s.due)return;
    if(s.phase==='drop'){
      const w=this.weapon,d=w.definition,first=!w.raised,empty=w.clip===0;
      const anim=first?(d.firstRaiseAnim||d.raiseAnim):((empty&&d.emptyRaiseAnim)||d.raiseAnim),duration=first?(d.firstRaiseTime||d.raiseTime||.4):((empty&&d.emptyRaiseTime)||d.raiseTime||.4);
      w.raised=true;s.phase='raise';s.due=this.time+duration;
      this.emit('weaponSwitch',{phase:'raise',weapon:w,anim,duration});
      const sound=first?(d.firstRaiseSoundPlayer||d.raiseSoundPlayer):d.raiseSoundPlayer;if(sound)this.emit('sound',{alias:sound});
    }else this.switching=null;
  }
  nearWindow(){return this.windows.filter(w=>w.boards<6&&distance(w.entry,this.player.position)<115).sort((a,b)=>distance(a.entry,this.player.position)-distance(b.entry,this.player.position))[0];}
  nearInteraction(){return this.interactions.filter(e=>!this.opened.has(e.target)&&(!this.mapRules||this.mapRules.visible(e))&&distance(e.position,[...this.player.position.slice(0,2),this.player.position[2]+35])<100).sort((a,b)=>distance(a.position,this.player.position)-distance(b.position,this.player.position))[0];}
  prompt() {
    const useKey=this.events.bindingName?.('use')||'E';
    const grenade=this.nearGrenade();if(grenade)return useKey+' · Pick up & throw back grenade · '+Math.max(0,grenade.due-this.time).toFixed(1)+'s';
    const e=this.nearInteraction();if(e){
      const prompt=this.mapRules?.prompt(e,useKey);if(prompt!=null)return prompt;
      if(e.targetname==='treasure_chest_use'){const box=this.boxes.get(e.target);if(box.phase==='cycling')return 'Mystery box · choosing weapon…';if(box.phase==='offered')return useKey+' · Take '+this.weaponName(box.weapon);if(box.phase!=='closed')return '';}
      const owned=this.inventory.some(w=>w.name===e.zombie_weapon_upgrade);return useKey+' · '+(e.targetname.includes('weapon')?(owned?'Ammo':'Buy '+this.weaponName(e.zombie_weapon_upgrade)):e.targetname==='treasure_chest_use'?'Mystery box':'Open passage')+' · '+(owned?Number(e.script_ammo_clip||Number(e.zombie_cost)*.5):e.zombie_cost)+' points';}
    if(this.nearWindow())return 'Hold '+useKey+' · Rebuild barrier';return '';
  }
  weaponName(name){return this.data.weaponNames?.[name]||{'zombie_colt':'Colt M1911','kar98k':'Kar98k','m1carbine':'M1A1 Carbine','thompson':'Thompson','bar':'BAR','doublebarrel':'Double barrel','shotgun':'Trench gun','mp40':'MP40','sw_357':'.357 Magnum','stg44':'STG-44','mg42_bipod':'MG42'}[name]||name;}
  use() {
    if(this.pendingGrenade||this.gesture)return false;
    const grenade=this.nearGrenade();if(grenade)return this.rethrowGrenade(grenade);
    const e=this.nearInteraction();if(!e)return;
    if(this.mapRules?.use(e))return true;
    let cost=Number(e.zombie_cost);
    if(e.targetname.includes('weapon')) {
      const name=e.zombie_weapon_upgrade,owned=this.inventory.find(w=>w.name===name);
      if(!this.data.weapons[name]){this.message('This weapon is not supported in this build yet.');return;}
      if(owned)cost=Number(e.script_ammo_clip||cost*.5);
      if(!this.spendPoints(cost))return;
      if(owned){owned.reserve=owned.definition.maxAmmo;this.message('Ammo replenished');}else{this.giveWeapon(name);this.message(this.weaponName(name)+' purchased');}
    } else if(e.targetname==='treasure_chest_use') {
      const box=this.boxes.get(e.target),settings=this.presentation.box||{offerTime:12,closeTime:.5,cooldown:3};
      if(box.phase==='offered'){this.giveWeapon(box.weapon);box.phase='closing';box.closedAt=this.time;box.due=this.time+settings.cooldown;box.timedOut=false;this.emit('sound',{alias:'lid_close'});return;}
      if(box.phase!=='closed')return;
      if(!this.spendPoints(cost))return;
      box.names=(this.data.map?.boxWeapons||Object.keys(this.data.weapons)).filter(x=>!this.inventory.some(w=>w.name===x));box.phase='cycling';box.started=this.time;box.index=0;box.nextAt=this.time;box.weapon=null;
      this.emit('sound',{alias:'lid_open'});this.emit('sound',{alias:'music_box'});this.updateBoxes();
    } else {
      if(!this.spendPoints(cost))return;
      this.opened.add(e.target);this.collision.disabled.add(e.target);
      this.mapRules?.onOpen(e);
      if(e.target.includes('upstairs')){this.opened.add('upstairs_blocker');this.opened.add('upstairs_blocker2');this.collision.disabled.add('upstairs_blocker');this.collision.disabled.add('upstairs_blocker2');}
      this.invalidateNavigation(e.target.includes('upstairs')?[e.target,'upstairs_blocker','upstairs_blocker2']:[e.target]);
      this.emit('open',e);this.message('Passage opened');
    }
  }
  rebuild(w) {
    if(w.boards>=6||this.time<this.rebuildDue||w.traverser&&!w.traverser.dead)return;
    const wasOpen=w.boards===0;w.boards++;this.rebuildDue=this.time+1;this.collision.disabled.delete(w.target);
    if(wasOpen)this.invalidateNavigation([w.target]);
    this.emit('sound',{alias:'repair_boards'});
    if(this.barrierReward<Math.min(500,50*this.round)){this.changePoints(10*(this.powerup.double_points?2:1));this.barrierReward+=10;}
    this.emit('barrier',w);
  }
  updateBoxes() {
    const settings=this.presentation.box||{cycleDelays:[.05,...Array(39).fill(.1)],offerTime:12,cooldown:3};
    for(const box of this.boxes.values()){
      if(box.phase==='cycling')while(this.time+1e-9>=box.nextAt&&box.index<settings.cycleDelays.length){
        box.weapon=box.names[Math.floor(Math.random()*box.names.length)];box.nextAt+=settings.cycleDelays[box.index++];
        if(box.index===settings.cycleDelays.length){box.phase='offered';box.offeredAt=box.nextAt;box.due=box.offeredAt+settings.offerTime;break;}
      }
      if(box.phase==='offered'&&this.time>=box.due){box.phase='closing';box.closedAt=this.time;box.timedOut=true;box.due=this.time+settings.cooldown;this.emit('sound',{alias:'lid_close'});}
      if(box.phase==='closing'&&this.time>=box.due){box.phase='closed';box.weapon=null;}
    }
  }
  renderPosition(actor){const a=Math.min(1,this.accumulator/PHYSICS_STEP),previous=actor.previousPosition||actor.position;return lerp(previous,actor.position,a);}
  throwGrenade(cook=false) {
    if(!this.player.grenades||['ready','dead'].includes(this.phase)||this.gesture||this.switching||this.pendingGrenade||this.time<this.meleeDue)return false;
    const d=this.data.grenade,started=this.time,pullAt=started+d.dropTime,throwAt=pullAt+d.holdFireTime;
    this.player.grenades--;this.reloadEnd=0;this.pendingFire=false;this.sprinting=false;
    this.pendingGrenade={started,pullAt,holdEnd:throwAt,throwAt:cook?Infinity:throwAt,releaseAt:cook?Infinity:throwAt+d.fireDelay,end:cook?Infinity:throwAt+d.fireTime+d.raiseTime,due:throwAt+d.fuseTime,cookable:cook,cooking:cook};
    this.emit('grenadePrepare',this.pendingGrenade);return true;
  }
  releaseGrenade(){
    const s=this.pendingGrenade;if(!s?.cooking||['ready','dead'].includes(this.phase)||this.time+1e-9>=s.due)return false;
    const d=this.data.grenade;s.cooking=false;s.throwAt=Math.max(this.time,s.holdEnd);s.releaseAt=s.throwAt+d.fireDelay;s.end=s.throwAt+d.fireTime+d.raiseTime;return true;
  }
  nearGrenade(){
    if(this.pendingGrenade||['ready','dead'].includes(this.phase))return null;
    const p=this.player.position,reach=[p[0],p[1],p[2]+12];let nearest=null,best=64;
    for(const g of this.grenades){
      if(g.held||g.exploded||g.due<=this.time)continue;
      const range=distance(g.position,reach);if(range>=best)continue;
      const target=[g.position[0],g.position[1],g.position[2]+3];
      if(this.collision.trace(reach,target,[0,0,0],GRENADE_CONTENTS).fraction<.98)continue;
      nearest=g;best=range;
    }
    return nearest;
  }
  rethrowGrenade(grenade){
    if(this.time<this.meleeDue||grenade!==this.nearGrenade())return false;
    const d=this.data.grenade,started=this.time,pullAt=started+(d.altDropTime||.05),throwAt=pullAt+(d.altRaiseTime||1);
    // Keep the same live projectile and deadline. Picking it up neither gives
    // inventory ammunition nor restarts its fuse, even if it expires in hand.
    grenade.held=true;grenade.resting=false;grenade.velocity=[0,0,0];
    this.reloadEnd=0;this.pendingFire=false;this.sprinting=false;
    this.pendingGrenade={started,pullAt,throwAt,releaseAt:throwAt+d.fireDelay,end:throwAt+d.fireTime+d.raiseTime,due:grenade.due,rethrow:true,projectile:grenade};
    this.emit('grenadePrepare',this.pendingGrenade);return true;
  }
  updateGrenades(dt) {
    const d=this.data.grenade,pending=this.pendingGrenade;
    if(pending){
      if(!pending.pulled&&this.time+1e-9>=pending.pullAt){pending.pulled=true;if(!pending.rethrow)this.emit('sound',{alias:d.pullbackSoundPlayer});}
      if(pending.cookable&&!pending.projectile&&this.time+1e-9>=pending.holdEnd){
        const p=this.player.position,position=[p[0],p[1],p[2]+40];
        pending.projectile={position,previousPosition:position.slice(),velocity:[0,0,0],due:pending.due,spawned:this.time,resting:false,bounceAt:0,held:true};
        this.grenades.push(pending.projectile);
      }
      if(!pending.released&&this.time+1e-9>=pending.releaseAt&&this.time+1e-9<pending.due){
        pending.released=true;const origin=this.player.position,dir=[Math.cos(this.yaw)*Math.cos(this.pitch),Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch)],eye=[origin[0],origin[1],origin[2]+60];
        const position=this.collision.trace(eye,eye.map((v,i)=>v+dir[i]*16),[3,3,3],GRENADE_CONTENTS).end;
        const g=pending.projectile||{};Object.assign(g,{position,previousPosition:position.slice(),velocity:dir.map((v,i)=>v*d.projectileSpeed+(i===2?d.projectileSpeedUp:0)),due:pending.due,spawned:this.time,resting:false,bounceAt:0,held:false});
        if(!this.grenades.includes(g))this.grenades.push(g);this.emit('grenade',g);this.emit('sound',{alias:d.fireSoundPlayer});
      }
      if(this.time+1e-9>=pending.end)this.pendingGrenade=null;
    }
    for(const g of this.grenades) {
      g.previousPosition.splice(0,3,...g.position);
      if(g.held){g.position=[this.player.position[0],this.player.position[1],this.player.position[2]+40];}
      else if(!g.resting){
        g.velocity[2]-=800*dt;const result=this.collision.trace(g.position,g.position.map((v,i)=>v+g.velocity[i]*dt),[3,3,3],GRENADE_CONTENTS);g.position=result.end;
        if(result.fraction<1){
          const dot=g.velocity.reduce((s,v,i)=>s+v*result.normal[i],0),speed=Math.hypot(...g.velocity);
          g.position=g.position.map((v,i)=>v+result.normal[i]*.05);
          g.velocity=g.velocity.map((v,i)=>(v-dot*result.normal[i])*d.parallelDefaultBounce-result.normal[i]*Math.min(0,dot)*d.perpendicularDefaultBounce);
          if(speed>60&&this.time>=g.bounceAt){g.bounceAt=this.time+.1;this.emit('sound',{alias:'grenade_bounce_concrete',volume:Math.min(1,speed/400)});}
          if(result.normal[2]>.65&&Math.hypot(g.velocity[0],g.velocity[1])<20&&Math.abs(g.velocity[2])<30){g.resting=true;g.velocity=[0,0,0];}
        }
      }
      if(this.time+1e-9>=g.due&&!g.exploded){
        if(this.pendingGrenade?.projectile===g)this.pendingGrenade=null;
        g.exploded=true;this.emit('explosion',g);this.emit('sound',{alias:'grenade_explode'});this.emit('sound',{alias:'grenade_explode_bass',volume:.6});
        const damage=p=>{const center=[p[0],p[1],p[2]+35],range=distance(center,g.position);if(range>=d.explosionRadius)return 0;const start=[g.position[0],g.position[1],g.position[2]+4];if(this.collision.trace(start,center,[0,0,0],1).fraction<.98)return 0;return d.explosionOuterDamage+(d.explosionInnerDamage-d.explosionOuterDamage)*(1-range/d.explosionRadius);};
        for(const e of this.enemies)if(!e.dead){const amount=damage(e.position);if(amount)this.hitEnemy(e,amount);}
        const amount=damage(this.player.position);if(amount)this.damagePlayer(Math.round(amount));
      }
    }
    this.grenades=this.grenades.filter(g=>!g.exploded);
  }
  // get_next_powerup(): a shuffled cycle of the map's powerups; the carpenter is
  // skipped while fewer than five windows have every board torn off.
  nextPowerup(){
    const types=Object.keys(this.presentation.powerups||{full_ammo:1,insta_kill:1,double_points:1,nuke:1});
    for(let tries=0;tries<=types.length;tries++){
      if(this.powerupIndex>=this.powerupOrder.length){this.powerupOrder=types.slice();for(let i=this.powerupOrder.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[this.powerupOrder[i],this.powerupOrder[j]]=[this.powerupOrder[j],this.powerupOrder[i]];}this.powerupIndex=0;}
      const type=this.powerupOrder[this.powerupIndex++];
      if(type!=='carpenter'||this.windows.filter(w=>w.boards===0).length>=5)return type;
    }
    return types.find(t=>t!=='carpenter');
  }
  // powerup_setup: spawn sound, then a looping hum until grabbed or expired.
  addDrop(type,position){
    const drop={id:this.nextDropId++,type,position:position.slice(),expires:this.time+30,spawned:this.time};this.drops.push(drop);this.emit('drop',drop);
    const at=[position[0],position[1],position[2]+40];this.emit('sound',{alias:'spawn_powerup',position:at,near:100,far:1200});
    this.dropLoop(drop);return drop;
  }
  dropLoop(drop){const p=drop.position;this.emit('loop',{id:'drop'+drop.id,alias:'spawn_powerup_loop',position:[p[0],p[1],p[2]+40],near:60,far:700});}
  // start_carpenter: rebuild boards nearest-window first, one every 0.05 s,
  // then carp_end and 200 points.
  updateCarpenter(){
    const c=this.carpenter;if(!c||this.time<c.next)return;c.next=this.time+.05;
    const window=this.windows.filter(w=>w.boards<6).sort((a,b)=>distance(a.entry,c.origin)-distance(b.entry,c.origin))[0];
    if(window){window.boards++;this.emit('barrier',window);return;}
    this.carpenter=null;this.emit('stopLoop',{id:'carpenter'});this.emit('sound',{alias:'carp_end',position:c.origin,near:150,far:1400});this.changePoints(200);
  }
  pickup(drop) {
    drop.used=true;
    this.emit('pickup',drop);this.emit('stopLoop',{id:'drop'+drop.id});this.emit('sound',{alias:'powerup_grabbed'});
    // Der Riese's play_devil_dialog announcer; Nacht's script has no announcer.
    const announcer=this.mapRules?.announcer?.[drop.type]??{full_ammo:'full_ammo',insta_kill:'insta_kill'}[drop.type];if(announcer)this.emit('sound',{alias:announcer,exclusive:'announcer'});
    if(drop.type==='full_ammo'){for(const w of this.inventory){w.clip=w.definition.clipSize;w.reserve=w.definition.maxAmmo;}this.player.grenades=4;}
    else if(drop.type==='nuke'){for(const e of this.enemies)if(!e.dead)this.hitEnemy(e,e.health);this.changePoints(400);}
    else if(drop.type==='carpenter'){this.carpenter={origin:drop.position.slice(),next:this.time};this.emit('loop',{id:'carpenter',alias:'carp_loop',position:drop.position.slice(),near:150,far:1400});}
    else this.powerup[drop.type]=this.time+30;
    this.message({'full_ammo':'Max ammo','insta_kill':'Insta-kill · 30 seconds','double_points':'Double points · 30 seconds','nuke':'Nuke','carpenter':'Carpenter'}[drop.type]);
  }
  snapshot(){return {phase:this.phase,time:this.time,round:this.round,health:this.player.health,points:this.player.points,kills:this.player.kills,position:this.player.position,physicsHz:1/PHYSICS_STEP,physicsTicks:this.physicsTicks,grounded:this.player.grounded,ammo:[this.weapon.clip,this.weapon.reserve],weapon:this.weapon.name,remaining:this.remaining,shots:this.shots,hits:this.hits,windows:this.windows.map(w=>({entry:w.entry,boards:w.boards})),enemies:this.enemies.filter(e=>!e.dead).map(e=>({id:e.id,position:e.position,health:e.health,stage:e.stage}))};}
}
