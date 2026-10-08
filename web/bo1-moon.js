// Moon's T5 rules, reconstructed from the locally owned Moon scripts.
import {BlackOpsEngine,KinoRules} from './bo1-engine.js';
import {PERKS} from './map-rules.js';
import {gaitSpeed} from './game.js';
import {nextHealth} from './rules.js';
const vec=e=>String(e?.origin||'0 0 0').split(/\s+/).map(Number),dist=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
export const inMoonHulls=(p,hulls)=>hulls.some(h=>h.mins.every((v,k)=>p[k]>=v-2)&&h.maxs.every((v,k)=>p[k]<=v+2)&&h.planes.every(q=>q.slice(0,3).reduce((v,n,k)=>v+n*p[k],0)<=q[3]+2));
const rnd=(a,b)=>a+Math.floor(Math.random()*(b-a)),choice=a=>a[rnd(0,a.length)];
const MOON_PERKS={...PERKS,specialty_additionalprimaryweapon:{name:'Mule Kick',cost:4000,sting:'mus_perks_additionalprimaryweapon_sting'}};

export class MoonRules extends KinoRules {
  constructor(g){super(g);const use=e=>({...e,position:e.position||vec(e)});
    g.spawnEntities.push(...(this.data.quadSpawners||[]));
    g.interactions.push(...this.data.equipment.map(use),...this.data.diggers.map(d=>use(g.entities.find(e=>e.targetname===d.trigger))),...g.entities.filter(e=>['zombie_airlock_buy','zombie_airlock_hackable'].includes(e.targetname)).map(use));
    this.earthInitial=g.entities.find(e=>e.targetname==='initial_spawn_points'&&e.script_int==='1');g.spawn=vec(this.earthInitial);
  }
  reset(){super.reset();this.earth=true;this.everMoon=false;this.earthStarted=0;this.earthFast=false;this.moonRound=null;this.oxygen=0;this.airDue=0;this.pes=false;this.equipment=null;
    this.earthPerk=Math.random()<.5?'specialty_armorvest':'specialty_fastreload';this.portal=null;this.portalReady=0;this.earthGateReady=20;this.moonGateReady=0;
    this.hackerTarget=choice(this.data.equipment.filter(e=>e.zombie_equipment_upgrade==='equip_hacker_zm'))?.target;this.hack=null;this.diggers={};this.diggerRound=0;this.firstDigger=false;this.diggerRolled=false;this.diggerCheckRound=0;
    this.airlocks={};this.pressureAt=0;this.flight=null;this.padReady=0;this.astroId=null;this.nextAstroRound=rnd(1,4);this.astroDue=0;this.spawnYaw=Number(this.earthInitial?.angles.split(' ')[1]||90)*Math.PI/180;
    this.papOn=true; // Area 51's Pack-a-Punch has independent power.
    const boxes=this.game.interactions.filter(e=>e.targetname==='treasure_chest_use'&&e.start_exclude!=='1');if(boxes.length)this.game.activeBox=choice(boxes).target;
  }
  zonesAt(p){return this.data.volumes.filter(v=>inMoonHulls([p[0],p[1],p[2]+25],v.hulls));}
  lowGravityAt(p){if(this.zonesAt(p).some(v=>v.name==='nml_zone'))return false;return !this.power||!this.zonesAt(p).some(v=>!v.lowGravity&&!this.breached(v.name));}
  breached(zone){return this.data.diggers.some(d=>this.diggers[d.name]?.breached&&d.zones.includes(zone));}
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  enabledSpawners(){if(this.earth){const age=this.game.time-this.earthStarted,groups=new Set(['nml_zone_spawners',...(age>=25?['nml_area'+(Math.floor((age-25)/35)%2+1)+'_spawners']:[])]);return this.game.spawnEntities.filter(e=>groups.has(e.targetname));}
    return super.enabledSpawners().filter(e=>!e.targetname.startsWith('nml_')&&e.targetname!=='astronaut_zombie');}
  windows(){return super.windows().filter(w=>this.earth===(this.data.goals[w.target]?.zone==='nml_zone'));}
  visible(e){
    if(['zombie_airlock_buy','zombie_airlock_hackable'].includes(e.targetname))return !this.doorUnlocked(e.script_flag);
    if(e.targetname==='zombie_equipment_upgrade')return !this.earth&&(e.zombie_equipment_upgrade!=='equip_hacker_zm'||e.target===this.hackerTarget);
    if(e.targetname.endsWith('_digger_switch'))return !this.earth;
    if(e.targetname==='zombie_vending'){if(e.position[0]>10000)return this.earth&&e.script_noteworthy===this.earthPerk;return !this.earth&&super.visible(e);}
    if(e.targetname==='zombie_vending_upgrade')return this.earth||!!this.pap;
    return super.visible(e);
  }
  prompt(e,key){
    if(e.targetname==='zombie_airlock_buy')return this.equipment==='hacker'?key+' · Hack airlock · 200 points · 32.7 seconds':key+' · Unlock airlock · '+(e.zombie_cost||1000)+' points';
    if(e.targetname==='zombie_airlock_hackable')return this.equipment==='hacker'?key+' · Hack airlock · 200 points · 32.7 seconds':'Hacker required';
    if(e.targetname==='zombie_equipment_upgrade')return key+' · Take '+(e.zombie_equipment_upgrade==='equip_hacker_zm'?'Hacker · replaces P.E.S.':'P.E.S.');
    if(e.targetname.endsWith('_digger_switch')){const d=this.data.diggers.find(d=>d.trigger===e.targetname),s=this.diggers[d.name];return !s||s.stopped?'Excavator offline':this.equipment!=='hacker'?'Hacker required':key+' · Hack excavator · 5 seconds';}
    if(e.targetname==='zombie_vending'){const p=MOON_PERKS[e.script_noteworthy];if(!p)return '';if(this.perks.has(e.script_noteworthy))return p.name+' purchased';if(this.perks.size>=4)return 'Four perks already purchased';if(!this.power&&!this.earth&&!(e.script_noteworthy==='specialty_quickrevive'&&!this.game.coop))return 'You must turn on the power first';return key+' · Buy '+p.name+' · '+(e.script_noteworthy==='specialty_quickrevive'&&!this.game.coop?500:p.cost)+' points';}
    return super.prompt(e,key);
  }
  use(e){const g=this.game;
    if(e.targetname==='zombie_airlock_buy'&&this.equipment!=='hacker'){if(!this.doorUnlocked(e.script_flag)&&g.spendPoints(Number(e.zombie_cost||1000)))this.unlockDoor(e);return true;}
    if(['zombie_airlock_buy','zombie_airlock_hackable'].includes(e.targetname)){if(this.equipment==='hacker'&&!g.gesture&&!this.doorUnlocked(e.script_flag)&&g.player.points>=200){this.hack={door:e.target,flag:e.script_flag,cost:200,at:g.time+32.7,position:e.position.slice()};g.startHoldGesture('hacker');}return true;}
    if(e.targetname==='zombie_equipment_upgrade'){this.equipment=e.zombie_equipment_upgrade==='equip_hacker_zm'?'hacker':'pes';this.pes=false;g.syncHands();g.emit('stopLoop',{id:'moon-pes'});g.emit('sound',{alias:'evt_gasmask_suit_on'});g.message(this.equipment==='pes'?'P.E.S. acquired · '+(g.events.bindingName?.('equipment')||'5')+' to equip':'Hacker acquired · P.E.S. removed');return true;}
    if(e.targetname.endsWith('_digger_switch')){const def=this.data.diggers.find(d=>d.trigger===e.targetname),s=this.diggers[def.name];if(this.equipment==='hacker'&&s&&!s.stopped&&!g.gesture){this.hack={name:def.name,at:g.time+5,position:e.position.slice()};g.startHoldGesture('hacker');}return true;}
    if(e.targetname==='zombie_vending'){const id=e.script_noteworthy,p=MOON_PERKS[id];if(!p||this.perks.has(id)||this.perks.size>=4||g.gesture||!this.power&&!this.earth&&!(id==='specialty_quickrevive'&&!g.coop))return true;
      if(g.spendPoints(id==='specialty_quickrevive'&&!g.coop?500:p.cost)){g.startGesture(id,()=>{this.perks.add(id);if(id==='specialty_armorvest')g.player.health=this.maxHealth;});g.emit('sound',{alias:p.sting});}return true;}
    if(e.targetname==='zombie_vending_upgrade'){const power=this.power;this.power=true;try{return super.use(e);}finally{this.power=power;}}
    const result=super.use(e);if(e.targetname==='use_power_switch'&&this.power)this.diggerRound=g.round;return result;
  }
  togglePes(){const g=this.game;if(this.equipment!=='pes'){g.message(this.equipment==='hacker'?'Use the Hacker near a hackable object':'Pick up a P.E.S. first');return false;}if(g.gesture||g.pendingGrenade||g.dive)return false;
    const on=!this.pes;g.startGesture(on?'pes_on':'pes_off',()=>{this.pes=on;this.oxygen=0;g.emit('sound',{alias:on?'evt_gasmask_on':'evt_gasmask_off'});if(on)g.emit('loop',{id:'moon-pes',alias:'evt_gasmask_loop'});else g.emit('stopLoop',{id:'moon-pes'});});return true;}
  doorUnlocked(flag){return !flag||flag.split(',').every(f=>this.flags.has(f.trim()));}
  unlockDoor(e){for(const flag of (e.script_flag||'').split(','))if(flag.trim())this.flags.add(flag.trim());this.game.invalidateNavigation(this.data.airlocks.filter(a=>this.doorUnlocked(a.flag)).flatMap(a=>a.targets));this.game.message('Airlock unlocked');}
  onOpen(e){for(const f of (e.script_flag||'').split(','))if(f.trim())this.flags.add(f.trim());}
  clearNormalEnemies(){const g=this.game;for(const e of g.enemies)if(e.kind!=='astronaut')g.emit('removeEnemy',e);g.enemies=g.enemies.filter(e=>e.kind==='astronaut');for(const w of g.windows){w.traverser=null;w.attackers=[];}}
  travel(toEarth){const g=this.game;this.clearNormalEnemies();this.portal=null;this.portalReady=g.time+5;this.oxygen=0;
    if(toEarth){this.moonRound={round:g.round,remaining:g.remaining,phase:g.phase,health:g.zombieHealth};this.earth=true;this.earthStarted=g.time;this.earthFast=false;this.earthPerk=this.earthPerk==='specialty_armorvest'?'specialty_fastreload':'specialty_armorvest';g.phase='round';g.remaining=1;g.spawnDue=g.time+1;this.earthGateReady=g.time+75;}
    else{this.earth=false;if(!this.everMoon){g.round=0;g.zombieHealth=g.vars.zombie_health_start;g.startRound();}else if(this.moonRound){Object.assign(g,{round:this.moonRound.round,zombieHealth:this.moonRound.health,phase:this.moonRound.phase,remaining:this.moonRound.remaining});if(g.phase==='between')g.roundDue=g.time+3;g.spawnDue=g.time+2.5;}
      this.everMoon=true;this.moonGateReady=g.time+120;}
    const destination=toEarth?this.data.earthSpawn:this.data.moonSpawn,feet=g.settleFeet(destination);
    Object.assign(g.player,{position:feet,previousPosition:feet.slice(),grounded:true,velocityZ:0});g.changeStance('stand');g.targetNode=-1;g.targetNodeDue=0;g.spawnDistanceCache=null;
    g.emit('moonTeleport',{earth:toEarth,yaw:toEarth?Math.PI/2:this.data.moonYaw*Math.PI/180});g.emit('sound',{alias:'evt_teleporter_beam_sfx'});g.message(toEarth?'No Man’s Land':'Moon · Pick up a P.E.S.');
  }
  portals(){const g=this.game;if(g.mirror||g.time<this.portalReady)return;
    const def=this.data.teleports.find(d=>(d.targetname==='nml_teleporter')===this.earth),points=g.coop?.playerPositions()||[g.player.position];
    const here=def&&points.every(p=>inMoonHulls([p[0],p[1],p[2]+25],def.hulls)),ready=this.earth?g.time>=this.earthGateReady:g.time>=this.moonGateReady;
    if(!here||!ready){this.portal=null;return;}if(!this.portal){this.portal={due:g.time+2.5,toEarth:!this.earth};g.emit('sound',{alias:'evt_teleporter_warmup'});g.message('Teleporting in 3 seconds · stay on the pad');}
    if(g.time>=this.portal.due)this.travel(this.portal.toEarth);
  }
  startDigger(name){const g=this.game,def=this.data.diggers.find(d=>d.name===name);if(!def)return;this.diggers[name]={started:g.time,breachAt:g.time+def.duration,breached:!!this.diggers[name]?.breached,arrived:false,stopped:false};this.firstDigger=true;this.diggerRound=g.round;g.message('Excavator '+({teleporter:'Pi',hangar:'Omicron',biodome:'Epsilon'}[name])+' approaching · Hacker required');g.emit('sound',{alias:'evt_dig_arm_start'});}
  tickDiggers(){const g=this.game;
    if(this.hack){const h=this.hack;if(this.equipment!=='hacker'||dist(g.player.position,h.position)>110){g.endHoldGesture();this.hack=null;}
      else if(g.time>=h.at){this.hack=null;g.endHoldGesture();if(h.door){if(g.spendPoints(h.cost??200))this.unlockDoor({script_flag:h.flag});}else{const s=this.diggers[h.name];s.stopped=true;s.stoppedAt=g.time;g.awardPoints(1000);const d=this.data.diggers.find(d=>d.name===h.name);if(d.blocker){g.collision.disabled.add(d.blocker);g.invalidateNavigation([d.blocker]);}g.message('Excavator disabled · +1000');}}}
    if(!this.power||this.earth)return;
    if(!g.mirror&&g.time-this.powerStartedAt>=20){
      const available=this.data.diggers.filter(d=>!this.diggers[d.name]||this.diggers[d.name].stopped),activate=()=>{if(available.length)this.startDigger(choice(available).name);};
      if(!this.diggerRolled){this.diggerRolled=true;this.diggerCheckRound=g.round;if(Math.random()>=.9)activate();}
      else if(g.round!==this.diggerCheckRound){this.diggerCheckRound=g.round;const elapsed=g.round-this.diggerRound,min=g.round<10?3:2;
        if(!Object.values(this.diggers).some(d=>!d.stopped&&!d.arrived)&&(!this.firstDigger?(elapsed>=2||Math.random()>=.9):(elapsed>=8||elapsed>=min&&Math.random()>=.8)))activate();
      }
    }
    for(const d of this.data.diggers){const s=this.diggers[d.name];if(!s||s.stopped||s.arrived||g.time<s.breachAt)continue;s.arrived=true;s.breached=true;if(d.blocker){g.collision.disabled.delete(d.blocker);g.invalidateNavigation([d.blocker]);}g.message((d.name==='biodome'?'Biodome':d.name==='hangar'?'Tunnel 11':'Tunnel 6')+' breached · P.E.S. required');g.emit('sound',{alias:'evt_dig_arm_stop'});}
  }
  jumpPads(){const g=this.game;if(this.flight){const f=this.flight,elapsed=Math.min(f.duration,g.time-f.started),blend=elapsed/f.duration;
      const p=f.from.map((v,k)=>v+(f.to[k]-v)*blend+(k===2?4*f.arc*blend*(1-blend):0));Object.assign(g.player,{position:p,previousPosition:p.slice(),grounded:false,velocityZ:0});
      if(elapsed>=f.duration){this.flight=null;this.padReady=g.time+1;try{g.player.position=g.settleFeet(f.to);g.player.previousPosition=g.player.position.slice();g.player.grounded=true;}catch{}g.emit('sound',{alias:'evt_jump_pad_land'});}return;}
    if(!this.power||this.earth||g.time<this.padReady||g.dive)return;const pad=this.data.jumpPads.find(p=>inMoonHulls([g.player.position[0],g.player.position[1],g.player.position[2]+5],p.hulls));if(!pad)return;
    const to=choice(pad.destinations),from=g.player.position.slice(),distance=dist(from,to);this.flight={from,to,started:g.time,duration:Math.max(1,Math.min(3,distance/500)),arc:pad.vertical?230:Math.max(80,(to[2]-from[2])*.5+100)};g.emit('sound',{alias:'evt_jump_pad_launch'});
  }
  tick(){const g=this.game;super.tick();if(['ready','dead'].includes(g.phase))return;this.portals();this.jumpPads();this.tickDiggers();
    if(this.earth){g.remaining=1;this.oxygen=0;const age=g.time-this.earthStarted;
      if(age>=25&&!this.earthFast){this.earthFast=true;for(const e of g.enemies)if(!e.dead&&e.kind!=='astronaut'){const gait=g.zombieGait();e.gait=gait.name;e.speed=gait.speed;}g.emit('sound',{alias:'evt_nomans_warning'});}
      const health=g.healthForRound(1+Math.floor(Math.max(0,age-25)/30));if(health!==g.zombieHealth){g.zombieHealth=health;g.emit('sound',{alias:'evt_nomans_warning'});}}
    else{const vacuum=this.lowGravityAt(g.player.position),dt=g.time-(this.pressureAt??g.time);this.pressureAt=g.time;
      if(!this.pes&&vacuum&&!g.mods.god&&!this.reviveDue){this.oxygen+=Math.min(.1,Math.max(0,dt));if(this.oxygen>8&&g.time>=this.airDue){this.airDue=g.time+1.5;g.emit('sound',{alias:'evt_suffocate_whump'});}if(this.oxygen>(this.perks.has('specialty_armorvest')?17:15))g.damagePlayer(g.player.health*10);}
      else this.oxygen=0;
      if(!g.mirror&&g.round>=this.nextAstroRound&&g.time>=this.astroDue&&!g.enemies.some(e=>e.kind==='astronaut'&&!e.dead))this.spawnAstro();}
    const changed=[];for(const lock of this.data.airlocks){const key=lock.targets[0],near=this.doorUnlocked(lock.flag)&&(dist(g.player.position,lock.position)<170||g.enemies.some(e=>!e.dead&&dist(e.position,lock.position)<180));
      if(this.airlocks[key]!==near){this.airlocks[key]=near;for(const target of lock.targets){if(near)g.collision.disabled.add(target);else g.collision.disabled.delete(target);changed.push(target);}g.emit('sound',{alias:near?'zmb_airlock_open':'zmb_airlock_close',position:lock.position});}}
    if(changed.length)g.invalidateNavigation(changed);
  }
  spawnAstro(){const g=this.game,at=g.settleActor(vec(this.data.astronaut));if(!at){this.astroDue=g.time+2;return;}
    const e={id:g.nextId++,kind:'astronaut',ignoreRound:true,ignoreNuke:true,ignoreInstaKill:true,position:at,previousPosition:at.slice(),health:g.zombieHealth*4*(g.coop?.playerCount()||1),dead:false,stage:'hunt',window:g.windows[0],path:[],age:0,spawnTime:g.time,attackDue:0,navDue:0,angle:0,gait:'ai_zombie_walk_v1',speed:gaitSpeed(g.presentation.animations.ai_zombie_astro_walk_moon_v1)};
    this.astroId=e.id;g.enemies.push(e);g.emit('spawn',e);g.emit('effect',{name:'maps/zombie/fx_zombie_boss_spawn',position:at,duration:1});}
  astroGrab(e){const g=this.game;if(g.time<e.attackDue||this.portal||g.gesture)return;e.attackDue=g.time+8;e.attack={name:'ai_zombie_attack_v1',started:g.time};const perks=[...this.perks];if(perks.length)this.perks.delete(choice(perks));g.damagePlayer(Math.max(0,g.player.health-1));
    const zones=this.activeZones(),spots=g.entities.filter(x=>x.targetname==='player_respawn_point'&&zones.has(x.script_noteworthy)).flatMap(x=>g.entities.filter(v=>v.targetname===x.target&&v.classname==='script_struct'));
    const at=spots.length?vec(choice(spots)):this.data.moonSpawn;try{const floor=g.settleFeet(at);Object.assign(g.player,{position:floor,previousPosition:floor.slice(),velocityZ:0,grounded:true});g.emit('moonTeleport',{earth:false,yaw:g.yaw});}catch{}g.message('Astronaut headbutt · perk stolen');}
  saveState(){return {...super.saveState(),moon:Object.fromEntries(['earth','everMoon','earthStarted','earthFast','moonRound','oxygen','airDue','pes','equipment','earthPerk','portal','portalReady','earthGateReady','moonGateReady','hackerTarget','hack','diggers','diggerRound','firstDigger','diggerRolled','diggerCheckRound','airlocks','flight','padReady','astroId','nextAstroRound','astroDue'].map(k=>[k,this[k]]))};}
  loadState(s){super.loadState(s);Object.assign(this,s.moon||{});this.pressureAt=this.game.time;if(this.pes)this.game.emit('loop',{id:'moon-pes',alias:'evt_gasmask_loop'});}
  coopState(){const now=this.game.time;return {earth:this.earth,earthPerk:this.earthPerk,airlocks:this.airlocks,diggers:Object.fromEntries(Object.entries(this.diggers).map(([k,d])=>[k,{...d,age:now-d.started,left:d.breachAt-now,stopAge:d.stoppedAt==null?null:now-d.stoppedAt}])),moonGateReady:this.moonGateReady-now,earthGateReady:this.earthGateReady-now};}
  applyCoopState(s){if(!s)return;const g=this.game;if(this.earth!==s.earth){const feet=g.settleFeet(s.earth?this.data.earthSpawn:this.data.moonSpawn);Object.assign(g.player,{position:feet,previousPosition:feet.slice(),grounded:true,velocityZ:0});this.oxygen=0;this.flight=null;g.emit('moonTeleport',{earth:s.earth,yaw:Math.PI/2});g.emit('sound',{alias:'evt_teleporter_beam_sfx'});}
    for(const k of ['earth','earthPerk','airlocks'])if(s[k]!=null)this[k]=s[k];this.diggers=Object.fromEntries(Object.entries(s.diggers||{}).map(([k,d])=>[k,{...d,started:g.time-d.age,breachAt:g.time+d.left,stoppedAt:d.stopAge==null?undefined:g.time-d.stopAge}]));this.moonGateReady=g.time+s.moonGateReady;this.earthGateReady=g.time+s.earthGateReady;}
}

export class MoonEngine extends BlackOpsEngine {
  constructor(m,c,paths,events={},p={}){super(m,c,paths,{...events,spawn:e=>{if(!e.kind&&e.position[0]<10000)e.kind='lunar';events.spawn?.(e);}},p,g=>new MoonRules(g));this.engine='black-ops-t5-moon';}
  prepareSpawnPaths(prepared){const old=this.collision.disabled;try{if(!prepared)this.collision.disabled=new Set([...old,...this.data.map.airlocks.flatMap(a=>a.targets)]);super.prepareSpawnPaths(prepared);}finally{this.collision.disabled=old;}}
  invalidateNavigation(targets){const old=this.collision.disabled;try{this.collision.disabled=new Set([...old,...this.data.map.airlocks.filter(a=>this.mapRules.doorUnlocked(a.flag)).flatMap(a=>a.targets)]);super.invalidateNavigation(targets);}finally{this.collision.disabled=old;}}
  newGame(){super.newGame();this.waveAmmo={};this.waveJobs=[];this.modeDefinition=null;this.quadGas=[];}
  makeWeapon(name){const w=super.makeWeapon(name);if(this.mapRules?.equipment==='pes')w.definition={...w.definition,handsModel:'viewmodel_zom_pressure_suit_arms',rigVariant:'pes'};return w;}
  syncHands(){for(const w of this.inventory)w.definition=this.mapRules.equipment==='pes'?{...this.data.weapons[w.name],handsModel:'viewmodel_zom_pressure_suit_arms',rigVariant:'pes'}:this.data.weapons[w.name];this.emit('weapon',this.weapon);}
  start(){if(this.phase==='ready'&&this.mapRules.earth){super.start();this.round=0;this.phase='round';this.remaining=1;this.spawnDue=this.time+1;this.mapRules.earthStarted=this.time;}else super.start();}
  gravityScale(){return this.mapRules.lowGravityAt(this.player.position)?136/800:1;}
  movePlayerOverride(p,input,dt){if(this.mapRules.flight)return true;return super.movePlayerOverride(p,input,dt);}
  placeEquipment(){return this.mapRules.togglePes();}
  healthForRound(round){let health=this.vars.zombie_health_start;for(let i=1;i<round;i++)health=nextHealth(health,i,this.vars);return health;}
  maxAlive(){return this.mapRules.earth?20:24;}
  enabledSpawners(){return this.mapRules.enabledSpawners().filter(e=>e.script_noteworthy!=='quad_zombie_spawner');}
  spawnEnemy(){const candidates=this.mapRules.enabledSpawners(),pick=choice(candidates),quads=this.enemies.filter(e=>e.kind==='quad'&&!e.dead);
    if(this.mapRules.earth){
      // No Man's Land has risers and chasers, but no windows. A marker with
      // unsupported ground or a blocked route must never enter the window
      // fallback: that throws and stops the render loop when faster spawners
      // become enabled after the first alarm.
      for(const spawner of candidates.slice().sort(()=>Math.random()-.5)){
        const riser=spawner.script_string==='riser',spots=riser?this.entities.filter(e=>e.targetname===spawner.targetname+'_rise'):[spawner];
        for(const spot of spots.slice().sort(()=>Math.random()-.5)){
          const at=this.settleActor(vec(spot));if(!at)continue;
          const direct=this.walkableLink(at,this.player.position),path=direct?[]:this.path(at,this.player.position,true);if(!direct&&!path.length)continue;
          const gait=this.zombieGait(),e={id:this.nextId++,position:at,previousPosition:at.slice(),health:this.zombieHealth,window:this.windows[0],stage:riser?'rise':'hunt',...(riser?this.riseClip(gait):{}),path,attackDue:0,navDue:this.time+1,
            angle:Number((spot.angles||'0 0 0').split(' ')[1])*Math.PI/180,dead:false,age:0,spawnTime:this.time,gait:gait.name,speed:gait.speed};
          this.enemies.push(e);this.remaining--;this.emit('spawn',e);return;
        }
      }
      return;
    }
    if(pick?.script_noteworthy==='quad_zombie_spawner'&&quads.length<5){const at=this.settleActor(vec(pick));if(at&&(this.walkableLink(at,this.player.position)||this.path(at,this.player.position,true).length)){
      const name=this.mapRules.lowGravityAt(at)?'ai_zombie_quad_supersprint_lowg':'ai_zombie_quad_supersprint',e={id:this.nextId++,kind:'quad',position:at,previousPosition:at.slice(),health:this.zombieHealth*.75,window:this.windows[0],stage:'hunt',path:[],attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:this.time,gait:name,speed:gaitSpeed(this.presentation.animations[name])};this.enemies.push(e);this.remaining--;this.emit('spawn',e);this.emit('sound',{alias:'zmb_quad_spawn',position:at});return;}}
    super.spawnEnemy();}
  zombieGait(){const gait=super.zombieGait();if(this.mapRules.earth){if(this.time-this.mapRules.earthStarted<25)return gait;const name=choice(['ai_zombie_fast_sprint_01','ai_zombie_fast_sprint_02']);return this.presentation.animations[name]?{name,speed:gaitSpeed(this.presentation.animations[name])}:gait;}
    if(!this.mapRules.lowGravityAt(this.player.position))return gait;const tier=/sprint/.test(gait.name)?'sprint':/run|fast/.test(gait.name)?'run':'walk',names=Object.keys(this.presentation.animations).filter(n=>new RegExp('^ai_zombie_'+tier+'_moon_v').test(n)),name=choice(names);return name?{name,speed:gaitSpeed(this.presentation.animations[name])}:gait;}
  settleActor(p){return this.collision.actor(()=>{const start=[p[0],p[1],p[2]+100],trace=this.collision.trace(start,[start[0],start[1],start[2]-240],[14,14,35]);return trace.fraction<1&&!trace.allSolid&&trace.normal[2]>.65?[trace.end[0],trace.end[1],trace.end[2]-35]:null;});}
  tickEnemy(e,dt){if(e.waveDue){e.age+=dt;return;}if(e.kind!=='astronaut')return super.tickEnemy(e,dt);
    e.age+=dt;if(e.attack&&this.time-e.attack.started>this.presentation.animations.ai_zombie_astro_headbutt.duration)e.attack=null;
    const p=this.player.position,d=dist(e.position,p);e.angle=Math.atan2(p[1]-e.position[1],p[0]-e.position[0]);if(d<64&&this.walkableLink(e.position,p)){this.mapRules.astroGrab(e);return;}
    if(this.time>=e.navDue){e.path=this.path(e.position,p,true);e.navDue=this.time+1;}this.advancePath(e,dt,p);}
  hitEnemy(e,damage,head=false,melee=false){if(this.firingWave&&!melee){if(e.kind==='astronaut'||!this.firingWave.startsWith('microwavegundw'))return;damage=e.health;head=false;}if(e.kind==='astronaut')head=false;
    const stage=e.stage;if(this.mapRules.earth||e.kind==='astronaut'||e.waveDue)e.stage='no-drop';super.hitEnemy(e,damage,head,melee);e.stage=stage;
    if(e.dead&&e.kind==='astronaut'&&!e.gibbed){e.gibbed=true;this.mapRules.nextAstroRound=this.round+rnd(1,3);this.mapRules.astroDue=this.time+10;this.emit('effect',{name:'maps/zombie/fx_zombie_boss_spawn',position:e.position,duration:1});}}
  alternateWeapon(){const w=this.weapon,name=w.definition.alternate;if(!name||this.gesture||this.switching||this.pendingGrenade||this.reloadEnd)return false;this.waveAmmo[w.name]={clip:w.clip,reserve:w.reserve};const next=this.makeWeapon(name),ammo=this.waveAmmo[name];if(ammo)Object.assign(next,ammo);this.inventory[this.slot]=next;
    next.raised=true;this.modeDefinition=next.definition;next.definition={...next.definition,raiseAnim:next.definition.altRaiseAnim||next.definition.raiseAnim,raiseTime:next.definition.altRaiseTime||next.definition.raiseTime};
    this.beginSwitch({...w,definition:{...w.definition,dropAnim:w.definition.altDropAnim||w.definition.dropAnim,dropTime:w.definition.altDropTime||w.definition.dropTime}});return true;}
  updateSwitch(){super.updateSwitch();if(!this.switching&&this.modeDefinition){this.weapon.definition=this.modeDefinition;this.modeDefinition=null;}}
  giveWeapon(name){if(this.mapRules.perks.has('specialty_additionalprimaryweapon')&&this.inventory.length<3&&!this.inventory.some(w=>w.name===name)){const previous=this.weapon;this.inventory.push(this.makeWeapon(name));this.slot=this.inventory.length-1;this.beginSwitch(previous);return;}super.giveWeapon(name);}
  fire(){const name=this.weapon.name;if(!name.startsWith('microwavegun'))return super.fire();
    this.firingWave=name;let fired;try{fired=super.fire();}finally{this.firingWave=null;}if(!fired)return false;
    if(!name.startsWith('microwavegundw')){const eye=[this.player.position[0],this.player.position[1],this.player.position[2]+this.viewHeight],dir=[Math.cos(this.yaw)*Math.cos(this.pitch),Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch)];
      for(const e of this.enemies){if(e.dead||e.kind==='astronaut'||e.waveDue)continue;const center=[e.position[0],e.position[1],e.position[2]+35],d=center.map((v,k)=>v-eye[k]),projection=d.reduce((n,v,k)=>n+v*dir[k],0);if(projection<0||dist(center,eye)>480||Math.hypot(...d.map((v,k)=>v-projection*dir[k]))>180||this.collision.trace(eye,center,[0,0,0],1).fraction<.98)continue;
        e.waveDue=this.time+2.5;e.attack=null;e.stage='wave';e.gait='ai_zombie_microwave_death_a';this.waveJobs.push(e.id);this.emit('effect',{name:'weapon/microwavegun/fx_sizzle_blood_eyes',position:center,duration:2.5});}}
    return true;
  }
  updateGrenades(dt){for(const g of this.grenades)if(!g.held&&!g.resting&&this.mapRules.lowGravityAt(g.position))g.velocity[2]+=(800-136)*dt;super.updateGrenades(dt);}
  tick(dt,input){super.tick(dt,input);for(const id of [...this.waveJobs]){const e=this.enemies.find(e=>e.id===id);if(!e||e.dead){this.waveJobs.splice(this.waveJobs.indexOf(id),1);continue;}if(this.time>=e.waveDue){this.hitEnemy(e,e.health);e.gibbed=true;this.emit('effect',{name:'weapon/microwavegun/fx_sizzle_mist',position:e.position,duration:1});this.waveJobs.splice(this.waveJobs.indexOf(id),1);}}}
  saveState(){return {...super.saveState(),moonWaveAmmo:this.waveAmmo,moonWaveJobs:this.waveJobs};}
  loadState(s){super.loadState(s);this.waveAmmo=structuredClone(s.moonWaveAmmo||{});this.waveJobs=[...(s.moonWaveJobs||[])];this.syncHands();}
}
