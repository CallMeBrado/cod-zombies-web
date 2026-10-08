// Shi No Numa's T4 map rules, reconstructed from the owned map/patch scripts.
import {TestingGame} from './testing.js';
import {FactoryRules,PERKS} from './map-rules.js';
import {VerrucktRules} from './waw-verruckt.js';
import {gaitSpeed} from './game.js';

const vec=s=>String(s||'0 0 0').trim().split(/\s+/).map(Number);
const distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const inside=(p,hulls,padding=2)=>hulls.some(h=>h.mins.every((v,k)=>p[k]>=v-padding)&&h.maxs.every((v,k)=>p[k]<=v+padding)&&h.planes.every(q=>q.slice(0,3).reduce((v,n,k)=>v+n*p[k],0)<=q[3]+padding));
const integer=(a,b)=>a+Math.floor(Math.random()*(b-a));
const AREAS={northwest:'nw',northeast:'ne',southeast:'se',southwest:'sw'};
const dog=e=>e.kind?.startsWith('hellhound');
export function floggerRotation(time,live,direction=-1){
  const age=Math.max(0,Math.min(30,time-live));
  const turns=age<6?age*age/12:age>24?24-(30-age)*(30-age)/12:age-3;
  return direction*14040*Math.PI/180*turns/24;
}

export class ShiNoNumaRules extends FactoryRules {
  constructor(game){
    super(game);this.spawnNetFrame=0;this.routes=new Map();
    game.interactions.push(...game.entities.filter(e=>['elec_trap_trig','pendulum_buy_trigger','zipline_buy_trigger','zip_lever_trigger'].includes(e.targetname)).map(e=>({...e,position:vec(e.origin)})));
    const invalidate=game.invalidateNavigation.bind(game);game.invalidateNavigation=targets=>{this.routes.clear();return invalidate(targets);};
  }
  reset(){
    super.reset();this.power=true;this.dogRound=false;this.dogRounds=0;this.nextDogRound=integer(...this.data.dogFirstRound);this.dogReward=false;
    this.traps=new Map();this.flogger=null;this.zip={activated:false,lower:false,ride:null,ready:0};this.riding=false;
    const ids=Object.keys(PERKS).slice(0,4),slots=[0,1,2,3];
    for(let i=slots.length-1;i>0;i--){const j=integer(0,i+1);[slots[i],slots[j]]=[slots[j],slots[i]];}
    this.placements=Object.fromEntries(ids.map((id,i)=>[id,slots[i]]));this.reveals={};this.firstHut=true;this.lastDogSpawn=null;this.dogIntroDue=null;this.refreshPerkTriggers();
    this.spawnYaw=vec(this.game.entities.find(e=>e.targetname==='initial_spawn_points')?.angles)[1]*Math.PI/180;
    this.syncZipTrigger();
  }
  activeZones(){
    const unlocked=this.flags.has('unlock_hospital_downstairs'),zones=new Set(unlocked?['center_building_upstairs','center_building_combined','center_building_upstairs_buy']:['center_building_upstairs']);
    for(const [area,prefix]of Object.entries(AREAS)){if(this.flags.has(prefix+'_magic_box'))zones.add(area+'_outside');if(this.flags.has(area+'_building_unlocked'))zones.add(area+'_building');}
    return zones;
  }
  occupiedZones(){const points=this.game.coop?.playerPositions()||[this.game.player.position],active=this.activeZones();
    return new Set(this.data.volumes.filter(v=>active.has(v.name)&&points.some(p=>inside([p[0],p[1],p[2]+25],v.hulls))).map(v=>v.name));}
  windows(){const zones=this.activeZones();return this.game.windows.filter(w=>zones.has(this.data.goals[w.target]?.zone));}
  group(w){return this.data.goals[w.target]?.spawners;}
  enabledSpawners(){
    const occupied=this.occupiedZones(),active=this.activeZones(),groups=new Set();
    if(!occupied.size)occupied.add(this.flags.has('unlock_hospital_downstairs')?'center_building_combined':'center_building_upstairs');
    for(const v of this.data.volumes)if(occupied.has(v.name))groups.add(v.spawners);
    if(occupied.has('center_building_upstairs'))groups.add('zombie_spawner_init');
    if(occupied.has('center_building_combined')){
      groups.add('zombie_spawner_init');
      for(const [area,prefix]of Object.entries(AREAS))if(this.flags.has(prefix+'_magic_box'))groups.add(prefix==='nw'?'northwest_center_building_spawners':area+'_center_building_spawners');
    }
    for(const area of Object.keys(AREAS))if(occupied.has(area+'_outside')){
      groups.add(area+'_outside_spawners');if(active.has(area+'_building'))groups.add(area+'_building_spawners');
    }
    return this.game.spawnEntities.filter(e=>groups.has(e.targetname));
  }
  get soloAiFactor(){return 0;}
  roundCount(round,players){return this.dogRound?players*(this.dogRounds<3?6:8):null;}
  prepareRound(round){
    this.dogRound=round===this.nextDogRound;this.dogReward=false;
    if(this.dogRound){this.dogRounds++;this.nextDogRound=round+integer(...this.data.dogInterval);this.flags.add('dog_round');this.game.emit('sound',{alias:'dark_sting'});this.game.emit('sound',{alias:'dog_round_start'});this.dogIntroDue=this.game.time+5.5;}
    else this.flags.delete('dog_round');
  }
  spawnEnemy(){
    const g=this.game;if(this.dogRound)return this.spawnDog();
    const zones=this.occupiedZones(),outdoors=[...zones].some(z=>z.endsWith('_outside'));
    if(!outdoors)return false; // The shared prepared window routes handle buildings.
    const spawners=this.enabledSpawners().filter(e=>e.targetname.endsWith('_outside_spawners'));
    if(!spawners.length)return false;
    const spawner=spawners[integer(0,spawners.length)],at=g.settleActor(vec(spawner.origin));if(!at)return false;
    const gait=g.zombieGait(),clip=VerrucktRules.prototype.riseClip.call(this,gait);
    const enemy={id:g.nextId++,position:at,previousPosition:at.slice(),health:g.zombieHealth,window:null,stage:'rise',afterRise:'hunt',...clip,
      path:[],attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:g.time,gait:gait.name,speed:gait.speed};
    g.enemies.push(enemy);g.remaining--;g.emit('spawn',enemy);return true;
  }
  dogSpawners(){
    const groups=new Set(['zombie_spawner_dog_init']);if(this.flags.has('unlock_hospital_downstairs'))groups.add('center_stairs_blocker_dog_spawn');
    for(const [area,prefix]of Object.entries(AREAS)){if(this.flags.has(prefix+'_magic_box'))groups.add(prefix+'_magic_box_dog_spawners');if(this.flags.has(area+'_building_unlocked'))groups.add(prefix+'_perk_hut_dog_spawners');}
    return this.data.dogSpawners.filter(e=>groups.has(e.targetname));
  }
  spawnDog(){
    const g=this.game,choices=this.dogSpawners(),p=g.player.position;
    const preferred=choices.filter(e=>distance(e.position,p)>200&&distance(e.position,p)<700&&Math.abs(e.position[2]-p[2])<100&&e.position.join(',')!==this.lastDogSpawn);
    const sorted=(preferred.length?preferred:choices.slice().sort((a,b)=>distance(a.position,p)-distance(b.position,p)).slice(0,8));
    let at;for(const marker of [...sorted].sort(()=>Math.random()-.5)){at=g.settleActor(marker.position,[13,13,20]);if(at&&!g.collision.actor(()=>g.collision.trace([at[0],at[1],at[2]+20],[at[0],at[1],at[2]+20],[13,13,19.9])).allSolid)break;at=null;}
    if(!at)return true;
    this.lastDogSpawn=at.join(',');const kind=Math.random()<.5?'hellhound':'hellhound-black',anim=this.data.dogAnimations.ai_zombie_walk_v1;
    const enemy={id:g.nextId++,kind,position:at,previousPosition:at.slice(),health:this.data.dogHealth[Math.min(3,this.dogRounds-1)],window:null,
      stage:'dog-spawn',spawnReady:g.time+1.6,path:[],attackDue:0,navDue:0,angle:Math.atan2(p[1]-at[1],p[0]-at[0]),dead:false,age:0,spawnTime:g.time,
      gait:'ai_zombie_walk_v1',speed:gaitSpeed(anim),ignoreNuke:true,ignoreInstaKill:true};
    g.enemies.push(enemy);g.remaining--;g.emit('spawn',enemy);g.emit('effect',{name:'maps/zombie/fx_zombie_dog_lightning_buildup',position:at,duration:1.6});
    g.emit('sound',{alias:'pre_spawn',position:at});return true;
  }
  onOpen(e){
    super.onOpen(e);if(e.shiDoubleDoor)this.openTargets([e.target+'_door']);
    for(const slot of this.data.perkSlots)if(e.script_flag===slot.flag)this.reveal(slot.index);
  }
  reveal(index){
    if(this.reveals[index]!=null)return;
    if(this.firstHut&&!this.game.coop){const good=['specialty_armorvest','specialty_fastreload'],current=Object.keys(this.placements).find(p=>this.placements[p]===index);
      if(!good.includes(current)){const chosen=good[integer(0,good.length)];[this.placements[current],this.placements[chosen]]=[this.placements[chosen],this.placements[current]];}this.firstHut=false;}
    this.reveals[index]=this.game.time;this.refreshPerkTriggers();this.game.emit('sound',{alias:'rando_start',position:this.data.perkSlots[index].position});this.game.emit('sound',{alias:'perk_lottery'});
  }
  refreshPerkTriggers(){for(const e of this.game.interactions.filter(e=>e.targetname==='zombie_vending')){
    const slot=this.data.perkSlots[this.placements[e.script_noteworthy]];if(slot)e.position=[slot.position[0],slot.position[1],slot.position[2]+40];}}
  perkSlot(e){return this.data.perkSlots[this.placements[e.script_noteworthy]];}
  visible(e){
    if(e.targetname==='zombie_vending'){const slot=this.perkSlot(e);return slot&&this.flags.has(slot.flag)&&this.reveals[slot.index]!=null&&this.game.time>=this.reveals[slot.index]+4.8;}
    if(e.targetname==='elec_trap_trig')return true;
    if(e.targetname==='pendulum_buy_trigger')return true;
    if(e.targetname==='zip_lever_trigger')return !this.zip.activated;
    if(e.targetname==='zipline_buy_trigger')return this.zip.activated;
    return super.visible(e);
  }
  prompt(e,key){const g=this.game;
    if(e.targetname==='elec_trap_trig'){const def=this.data.electricTraps.find(t=>t.target===e.target),state=this.traps.get(e.target);if(!this.flags.has(def.flag))return 'Open the hut first';return state&&g.time<state.ready?'Electric trap cooling down':key+' · Electric trap · 1000 points';}
    if(e.targetname==='pendulum_buy_trigger')return !this.flags.has('nw_magic_box')?'Clear the path to the Flogger':this.flogger&&g.time<this.flogger.ready?'Flogger cooling down':key+' · Flogger · 750 points';
    if(e.targetname==='zip_lever_trigger')return !this.flags.has('ne_magic_box')?'Open the path to the Fishing Hut':key+' · Activate zipline';
    if(e.targetname==='zipline_buy_trigger'){if(this.zip.ride||g.time<this.zip.ready)return 'Zipline unavailable';const here=e.script_noteworthy==='static'?true:this.zip.lower;return here===this.zip.lower?key+' · Ride zipline · 1500 points':key+' · Recall zipline · 1500 points';}
    return super.prompt(e,key);
  }
  use(e){const g=this.game;
    if(e.targetname==='elec_trap_trig'){const def=this.data.electricTraps.find(t=>t.target===e.target),old=this.traps.get(e.target);
      if(!this.flags.has(def.flag)||old&&g.time<old.ready||!g.spendPoints(1000))return true;
      this.traps.set(e.target,{live:g.time+.5,until:g.time+25.5,ready:g.time+115.5,fxDue:0,playerDue:0});g.emit('sound',{alias:'elec_start',position:e.position});return true;}
    if(e.targetname==='pendulum_buy_trigger'){
      if(!this.flags.has('nw_magic_box')||this.flogger&&g.time<this.flogger.ready||!g.spendPoints(750))return true;
      this.flogger={live:g.time+1,until:g.time+31,ready:g.time+76,playerDue:0,direction:e.script_noteworthy==='2'?1:-1};g.collision.disabled.add(this.data.flogger.targets[0]);g.invalidateNavigation([this.data.flogger.targets[0]]);g.emit('sound',{alias:'motor_start_left',position:this.data.flogger.origin});g.emit('loop',{id:'shi-flogger',alias:'motor_loop_left',position:this.data.flogger.origin});return true;}
    if(e.targetname==='zip_lever_trigger'){if(!this.flags.has('ne_magic_box'))return true;this.zip.activated=true;this.startZip(true,false);return true;}
    if(e.targetname==='zipline_buy_trigger'){
      if(this.zip.ride||g.time<this.zip.ready||!g.spendPoints(1500))return true;const here=e.script_noteworthy==='static'?true:this.zip.lower;this.startZip(!this.zip.lower,here===this.zip.lower);return true;}
    if(e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_quickrevive'&&g.coop){
      if(!this.perks.has(e.script_noteworthy)&&!g.gesture&&g.spendPoints(1500))g.startGesture(e.script_noteworthy,()=>this.perks.add(e.script_noteworthy));return true;}
    return super.use(e);
  }
  startZip(lower,ride){const g=this.game,route=this.data.zipline.route,from=this.zip.lower?route.at(-1):route[0],to=lower?route.at(-1):route[0];
    this.zip.ride={lower,started:g.time,from:from.slice(),to:to.slice(),duration:route.length*.255,rider:ride};this.riding=ride;
    for(const target of ['zipline','zipline_blocker','zipline_ai_blocker','zip_temp_clip'])g.collision.disabled.add(target);
    g.emit('loop',{id:'shi-zipline',alias:'zip_loop',position:from});g.emit('sound',{alias:'switch',position:from});}
  zipPosition(){const ride=this.zip.ride,route=this.data.zipline.route;if(!ride)return (this.zip.lower?route.at(-1):route[0]).slice();
    const f=Math.min(1,Math.max(0,(this.game.time-ride.started)/ride.duration)),at=(ride.lower?f:1-f)*(route.length-1),i=Math.min(route.length-2,Math.floor(at)),blend=at-i;
    return route[i].map((v,k)=>v+(route[i+1][k]-v)*blend);}
  syncZipTrigger(){const trigger=this.game.interactions.find(e=>e.targetname==='zipline_buy_trigger'&&e.script_noteworthy==='nonstatic');if(trigger){const p=this.zipPosition(),rest=vec(trigger.origin);trigger.position=p.map((v,k)=>v+rest[k]-this.data.zipline.origin[k]);}}
  floggerTouches(position,height=60){
    const g=this.game,f=this.flogger,origin=this.data.flogger.origin;
    // The original hurt brush is linked to the logs. Trace a small body
    // against its current and intermediate poses, not its stationary rest box.
    for(const ago of [0,1/240,1/120]){const angle=floggerRotation(g.time-ago,f.live,f.direction),c=Math.cos(angle),s=Math.sin(angle);
      for(const z of [Math.min(16,height/2),height/2,height-4]){const x=position[0]-origin[0],v=position[2]+z-origin[2];
        if(inside([origin[0]+c*x-s*v,position[1],origin[2]+s*x+c*v],this.data.flogger.hulls,8))return true;}}
    return false;
  }
  tick(){const g=this.game;
    const z=this.zip.ride;if(z){if(this.riding){const p=this.zipPosition();g.player.position=[p[0],p[1],p[2]-96.5];g.player.previousPosition=g.player.position.slice();g.player.grounded=true;g.player.velocityZ=0;}
      if(g.time>=z.started+z.duration){this.zip.lower=z.lower;this.zip.ride=null;this.zip.ready=g.time+this.data.zipline.cooldown;
        if(this.riding){const floor=g.settleActor(z.lower?this.data.zipline.lowerExit:this.data.zipline.upperExit);if(floor)g.player.position=floor;g.player.previousPosition=g.player.position.slice();}this.riding=false;g.emit('stopLoop',{id:'shi-zipline'});g.emit('sound',{alias:'platform_bang',position:this.zipPosition()});}}
    this.syncZipTrigger();if(g.mirror)return;
    if(this.dogIntroDue!=null&&g.time>=this.dogIntroDue){this.dogIntroDue=null;g.emit('sound',{alias:'ann_vox_dog_start'});}
    for(const [target,state]of this.traps){const def=this.data.electricTraps.find(t=>t.target===target);if(g.time>=state.until){if(!state.stopped){state.stopped=true;g.emit('stopLoop',{id:'shi-trap-'+target});}continue;}if(g.time<state.live)continue;
      if(!state.started){state.started=true;g.emit('loop',{id:'shi-trap-'+target,alias:'elec_loop',position:def.points[0]});}
      if(g.time>=state.fxDue){state.fxDue=g.time+.5;for(const p of def.points)g.emit('effect',{name:'maps/zombie/fx_zombie_electric_trap',position:p,duration:.6});}
      for(const e of g.enemies)if(!e.dead&&e.stage!=='dog-spawn'&&inside([e.position[0],e.position[1],e.position[2]+25],def.hulls))g.trapKill(e);
      if(g.time>=state.playerDue&&inside([g.player.position[0],g.player.position[1],g.player.position[2]+25],def.hulls)){state.playerDue=g.time+.2;g.damagePlayer(this.perks.has('specialty_armorvest')?50:g.player.health+100);}}
    const f=this.flogger;if(f&&g.time>=f.live&&g.time<f.until){
      for(const e of g.enemies)if(!e.dead&&!dog(e)&&this.floggerTouches(e.position))g.trapKill(e);
      if(g.time>=f.playerDue&&this.floggerTouches(g.player.position,g.viewHeight)){f.playerDue=g.time+.5;g.damagePlayer(g.player.health+100);}}
    if(f&&g.time>=f.until&&!f.stopped){f.stopped=true;g.collision.disabled.delete(this.data.flogger.targets[0]);g.invalidateNavigation([this.data.flogger.targets[0]]);g.emit('stopLoop',{id:'shi-flogger'});g.emit('sound',{alias:'motor_stop_left',position:this.data.flogger.origin});}
    if(this.dogRound&&!this.dogReward&&g.phase==='round'&&g.remaining===0&&g.enemies.every(e=>e.dead||e.ignoreRound)){
      this.dogReward=true;const last=[...g.enemies].reverse().find(dog);if(last)g.addDrop('full_ammo',last.position);g.emit('sound',{alias:'bright_sting'});}
  }
  boxJoker(){return VerrucktRules.prototype.boxJoker.call(this);}
  get boxSequence(){return VerrucktRules.prototype.boxSequence;}
  nextBox(current){const options=Object.entries(this.data.chests).filter(([note,target])=>target!==current&&(this.game.boxMoves?true:note.endsWith('_chest')&&!['start_chest','attic_chest'].includes(note))).map(([,target])=>target);
    return options[integer(0,options.length)]||current;}
  saveState(){return {...super.saveState(),placements:this.placements,reveals:this.reveals,firstHut:this.firstHut,dogRound:this.dogRound,dogRounds:this.dogRounds,nextDogRound:this.nextDogRound,dogReward:this.dogReward,
    traps:[...this.traps],flogger:this.flogger,zip:this.zip,riding:this.riding,dogIntroDue:this.dogIntroDue};}
  loadState(s){if(!s)return;super.loadState(s);for(const name of ['placements','reveals','firstHut','dogRound','dogRounds','nextDogRound','dogReward','flogger','zip','riding','dogIntroDue'])if(s[name]!=null)this[name]=s[name];this.traps=new Map(s.traps||[]);this.refreshPerkTriggers();this.syncZipTrigger();}
  coopState(){const now=this.game.time;return {placements:this.placements,reveals:Object.fromEntries(Object.entries(this.reveals).map(([id,t])=>[id,now-t])),dogRound:this.dogRound,zip:{...this.zip,ride:this.zip.ride&&{...this.zip.ride,age:now-this.zip.ride.started},ready:Math.max(0,this.zip.ready-now)},flogger:this.flogger&&{...this.flogger,age:now-this.flogger.live}};}
  applyCoopState(s){if(!s)return;this.placements=s.placements;this.reveals=Object.fromEntries(Object.entries(s.reveals).map(([id,age])=>[id,this.game.time-age]));this.dogRound=s.dogRound;this.zip={...s.zip,ride:s.zip.ride&&{...s.zip.ride,started:this.game.time-s.zip.ride.age},ready:this.game.time+s.zip.ready};this.refreshPerkTriggers();}
}

export class ShiNoNumaGame extends TestingGame {
  constructor(manifest,collision,paths,events={},presentation={}){super(manifest,collision,paths,events,presentation,g=>new ShiNoNumaRules(g));}
  newGame(){super.newGame();this.projectiles=[];this.arcJobs=[];this.nextProjectile=1;}
  startRound(){this.mapRules.prepareRound(this.round+1);super.startRound();if(this.mapRules.dogRound)this.spawnDue=this.time+7;}
  maxAlive(){return this.mapRules.dogRound?2*(this.coop?.playerCount()||1):24;}
  spawnEnemy(){if(this.mapRules.dogRound){this.mapRules.spawnDog();return;}super.spawnEnemy();}
  settleActor(at,half=[14,14,35]){const start=[at[0],at[1],at[2]+half[2]+50],to=[start[0],start[1],start[2]-220],floor=this.collision.actor(()=>this.collision.trace(start,to,half));return floor.fraction<1&&!floor.allSolid&&floor.normal[2]>.65?[floor.end[0],floor.end[1],floor.end[2]-half[2]]:null;}
  movePlayerOverride(p,input,dt){if(this.mapRules.riding)return true;return super.movePlayerOverride(p,input,dt);}
  tickEnemy(e,dt){
    if(e.dead)return;if(e.electrifiedUntil>this.time)return;
    if(!dog(e))return super.tickEnemy(e,dt);
    e.age+=dt;if(e.stage==='dog-spawn'){if(this.time<e.spawnReady)return;e.stage='hunt';this.emit('sound',{alias:'bolt',position:e.position});this.emit('sound',{alias:'spawn',position:e.position});this.emit('effect',{name:'maps/zombie/fx_zombie_dog_lightning_spawn',position:e.position,duration:1});}
    const p=this.player.position,dx=p[0]-e.position[0],dy=p[1]-e.position[1],length=Math.hypot(dx,dy);e.angle=Math.atan2(dy,dx);e.attacking=false;
    const blocked=this.collision.actor(()=>this.collision.trace([e.position[0],e.position[1],e.position[2]+25],[p[0],p[1],p[2]+25],[8,8,16])).fraction<.98;
    if(blocked&&this.time>=e.navDue){e.path=this.path(e.position,p);e.navDue=this.time+.75;}
    const target=blocked&&e.path.length?e.path[0]:p;if(e.path.length&&distance(e.position,target)<18)e.path.shift();
    const d=[target[0]-e.position[0],target[1]-e.position[1]],n=Math.hypot(...d)||1,step=Math.min(n,e.speed*dt),move=this.collision.actor(()=>this.collision.step(e.position,[d[0]/n*step,d[1]/n*step,-800*dt*dt],[13,13,20]));e.position=move.position;
    if(length<65&&Math.abs(p[2]-e.position[2])<60&&!blocked){e.attacking=true;if(this.time>=e.attackDue){e.attackDue=this.time+1.2;e.attack={name:'ai_zombie_attack_v1',started:this.time};this.damagePlayer(this.data.map.dogDamage,{from:e.position});}}
    if(this.time>=(e.soundDue||0)){e.soundDue=this.time+3+Math.random()*2;this.emit('sound',{alias:'zdog_close',position:e.position});}
  }
  hitEnemy(e,damage,head=false,melee=false){if(e.stage==='dog-spawn')return;const stage=e.stage,suppress=dog(e)||this.trapScoring||e.electrifiedUntil;
    if(suppress)e.stage='no-drop';super.hitEnemy(e,damage,dog(e)?false:head,melee);e.stage=stage;
    if(e.dead&&dog(e)&&!e.gibbed){e.gibbed=true;this.emit('effect',{name:'maps/zombie/fx_zombie_dog_explosion',position:e.position,duration:1.4});this.emit('sound',{alias:'zombie_dog_death',position:e.position});}}
  awardPoints(amount){if(!this.trapScoring)super.awardPoints(amount);}
  trapKill(e){this.trapScoring=true;try{this.hitEnemy(e,e.health);}finally{this.trapScoring=false;}}
  fire(){
    if(!['ray_gun','tesla_gun'].includes(this.weapon.name))return super.fire();
    if(this.movementBlocked||this.player.stance==='prone'&&this.moving||['dead','ready'].includes(this.phase)||this.gesture||this.switching||this.pendingGrenade||this.time<this.cooldown||this.time<this.meleeDue||this.reloadEnd)return false;
    if(this.sprinting){this.sprinting=false;this.pendingFire=true;this.sprintExitUntil=this.time+(this.weapon.definition.sprintOutTime||.3);return false;}
    if(this.pendingFire||this.time<this.sprintExitUntil)return false;if(!this.weapon.clip){this.reload();return false;}
    const d=this.weapon.definition,origin=[this.player.position[0],this.player.position[1],this.player.position[2]+this.viewHeight],dir=[Math.cos(this.yaw)*Math.cos(this.pitch),Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch)];
    this.weapon.clip--;this.shots++;this.cooldown=this.time+d.fireTime*(this.mapRules.fireScale||1);
    const p={id:this.nextProjectile++,weapon:this.weapon.name,position:origin.slice(),dir,speed:d.projectileSpeed,due:this.time+(d.projectileLifetime||10)};this.projectiles.push(p);this.emit('shiProjectile',p);
    this.emit('shot',{origin,dir,end:origin.map((v,k)=>v+dir[k]*500),wall:false,hit:null,hits:[]});this.emit('sound',{alias:d.fireSoundPlayer||d.fireSound});return true;
  }
  explode(p,ray){const d=this.data.weapons[p.weapon],at=ray.end;
    this.emit('shiImpact',{position:at,tesla:p.weapon==='tesla_gun'});
    if(p.weapon==='tesla_gun'){
      const seed=ray.hit?.enemy;if(seed&&!seed.dead){const chosen=new Set([seed.id]),queue=[{enemy:seed,depth:0}];this.arcJobs.push({enemy:seed.id,at:this.time,position:seed.position.slice()});
        while(queue.length&&chosen.size<20){const item=queue.shift();if(item.depth>=3)continue;const radius=300-20*(item.depth+1);
          for(const e of this.enemies.filter(e=>!e.dead&&!chosen.has(e.id)&&e.stage!=='dog-spawn'&&distance(e.position,item.enemy.position)<radius)){
            if(chosen.size>=20)break;const from=[...item.enemy.position],to=[...e.position];from[2]+=35;to[2]+=35;if(this.collision.trace(from,to,[0,0,0],1).fraction<.98)continue;
            chosen.add(e.id);e.electrifiedUntil=this.time+.5*(item.depth+1);this.arcJobs.push({enemy:e.id,at:e.electrifiedUntil,position:e.position.slice()});queue.push({enemy:e,depth:item.depth+1});}}
      }this.emit('effect',{name:'weapon/tesla/fx_tesla_hit',position:at,duration:.5});
    }else{
      if(ray.hit?.enemy)this.hitEnemy(ray.hit.enemy,1000);
      for(const e of this.enemies){if(e.dead)continue;const center=[e.position[0],e.position[1],e.position[2]+25],range=distance(center,at);if(range>d.explosionRadius)continue;
        if(this.collision.trace(at,center,[0,0,0],1).fraction<.98)continue;this.hitEnemy(e,d.explosionInnerDamage+(d.explosionOuterDamage-d.explosionInnerDamage)*range/d.explosionRadius);}
      const chest=[this.player.position[0],this.player.position[1],this.player.position[2]+25],range=distance(chest,at);
      if(range<d.explosionRadius&&this.collision.trace(at,chest,[0,0,0],1).fraction>=.98)this.damagePlayer(d.explosionOuterDamage+(d.explosionInnerDamage-d.explosionOuterDamage)*(1-range/d.explosionRadius));
      this.emit('effect',{name:d.projExplosionEffect,position:at,duration:1});this.emit('sound',{alias:'weap_rgun_explode',position:at});
    }
    p.dead=true;this.emit('shiProjectileRemove',p.id);
  }
  tick(dt,input){super.tick(dt,input);
    for(const p of this.projectiles){if(p.dead)continue;const length=p.speed*dt;
      let ray;if(this.events.traceShot)ray=this.events.traceShot(p.position,p.dir,length);
      else{const collision=this.collision.trace(p.position,p.position.map((v,k)=>v+p.dir[k]*length),[0,0,0],1);ray={wall:collision.fraction<1,end:collision.end,hit:null};
        const hit=this.events.traceEnemy?.(p.position,p.dir,length*collision.fraction);if(hit){ray.hit=hit;ray.end=p.position.map((v,k)=>v+p.dir[k]*hit.distance);}}
      if(ray.hit||ray.wall)this.explode(p,ray);else p.position=p.position.map((v,k)=>v+p.dir[k]*length);
      if(this.time>=p.due&&!p.dead){p.dead=true;this.emit('shiProjectileRemove',p.id);}}
    this.projectiles=this.projectiles.filter(p=>!p.dead);
    for(const job of this.arcJobs.filter(j=>j.at<=this.time)){const e=this.enemies.find(e=>e.id===job.enemy);if(e&&!e.dead){this.hitEnemy(e,e.health);this.emit('effect',{name:'weapon/tesla/fx_tesla_hit',position:job.position,duration:.6});this.emit('sound',{alias:'wpn_tesla_sizzle',position:job.position});}this.arcJobs.splice(this.arcJobs.indexOf(job),1);}
  }
  saveState(){return {...super.saveState(),shiProjectiles:this.projectiles,shiArcJobs:this.arcJobs};}
  loadState(s){super.loadState(s);this.projectiles=structuredClone(s.shiProjectiles||[]);this.arcJobs=structuredClone(s.shiArcJobs||[]);this.nextProjectile=Math.max(0,...this.projectiles.map(p=>p.id))+1;for(const p of this.projectiles)this.emit('shiProjectile',p);}
}
