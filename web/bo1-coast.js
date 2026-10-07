// Call of the Dead's coast, director and lighthouse scripts on the T5 runtime.
import {BlackOpsEngine,KinoRules} from './bo1-engine.js';
import {PERKS} from './map-rules.js';
import {gaitSpeed} from './game.js';
const pos=e=>e.origin.split(/\s+/).map(Number),distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const inside=(p,volumes)=>volumes.some(v=>v.hulls.some(h=>h.mins.every((x,k)=>p[k]>=x-2)&&h.maxs.every((x,k)=>p[k]<=x+2)&&h.planes.every(n=>n[0]*p[0]+n[1]*p[1]+n[2]*p[2]<=n[3]+2)));
const random=(a,b)=>a+Math.floor(Math.random()*(b-a));

export class CoastRules extends KinoRules {
  constructor(g){
    super(g);const trigger=g.interactions.find(e=>e.targetname==='zombie_vending_upgrade'),clip=g.entities.find(e=>e.targetname==='zombie_vending_upgrade_clip');
    this.papBase=pos(g.entities.find(e=>e.targetname===trigger.target)||clip||trigger);this.papTarget=trigger.target;
    this.papPieces=new Set([trigger.target,...g.entities.filter(e=>e.targetname===trigger.target).map(e=>e.target).filter(Boolean)]);
    this.papEntities=g.entities.filter(e=>this.papPieces.has(e.targetname));
    this.originalPap=new Map(this.papEntities.map(e=>[e,{position:pos(e),angles:(e.angles||'0 0 0').split(' ').map(Number)}]));
    this.papTriggerOffset=pos(trigger).map((v,k)=>v-this.papBase[k]);
    const sickle=g.entities.find(e=>e.targetname==='sickle_upgrade');if(sickle)g.interactions.push({...sickle,targetname:'weapon_upgrade',zombie_weapon_upgrade:'sickle_knife_zm',position:pos(sickle)});
  }
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  reset(){
    super.reset();this.started=false;this.directorId=null;this.directorDeaths=0;this.directorReturnRound=0;this.directorDue=6;
    this.cold=0;this.frozen=false;this.inWater=false;this.waterDue=0;this.sickle=false;this.transport=null;this.transportCooldown=0;this.riding=false;
    this.deathMachine=null;this.deathMachineUntil=0;
    this.papLocation=null;this.papStage='hidden';this.papDue=Infinity;this.papStarted=0;this.papAvailable=false;
    const boxes=this.game.interactions.filter(e=>e.targetname==='treasure_chest_use'&&e.start_exclude!=='1');this.game.activeBox=boxes[random(0,boxes.length)].target;
  }
  onOpen(e){super.onOpen(e);let changed=true;while(changed){changed=false;for(const [flag,extra]of this.data.zoneFlags)if(this.flags.has(flag)&&!this.flags.has(extra)){this.flags.add(extra);changed=true;}}}
  visible(e){return e.targetname==='zombie_vending_upgrade'?this.papAvailable||!!this.pap:super.visible(e);}
  prompt(e,key){
    if(e.zombie_weapon_upgrade==='sickle_knife_zm')return this.sickle?'Sickle purchased':key+' · Buy Sickle · 3000 points';
    if(e.targetname==='zombie_vending'){
      const perk=PERKS[e.script_noteworthy];if(this.perks.has(e.script_noteworthy))return perk.name+' purchased';
      if(this.perks.size>=5)return 'Five perks already purchased';
      if(e.script_noteworthy==='specialty_deadshot')return !this.power?'You must turn on the power first':key+' · Buy Deadshot Daiquiri · '+(this.game.coop?1500:1000)+' points';
    }
    if(e.targetname==='zombie_vending_upgrade'&&!this.papAvailable&&!this.pap)return 'Follow the lighthouse to Pack-a-Punch';
    return super.prompt(e,key);
  }
  use(e){
    const g=this.game;
    if(e.zombie_weapon_upgrade==='sickle_knife_zm'){if(!this.sickle&&g.spendPoints(3000)){this.sickle=true;g.message('Sickle purchased');}return true;}
    if(e.targetname==='zombie_vending'){
      if(this.perks.size>=5&&!this.perks.has(e.script_noteworthy))return true;
      if(e.script_noteworthy==='specialty_deadshot'){
        if(this.perks.has('specialty_deadshot')||!this.power||g.gesture)return true;
        if(g.spendPoints(g.coop?1500:1000)){g.startGesture('specialty_deadshot',()=>this.perks.add('specialty_deadshot'));g.emit('sound',{alias:'mus_perks_deadshot_sting'});}return true;
      }
    }
    if(e.targetname==='zombie_vending_upgrade'&&!this.papAvailable&&!this.pap)return true;
    const used=super.use(e);
    if(e.targetname==='use_power_switch'&&this.power&&this.papDue===Infinity)this.papDue=g.time+random(100,120);
    return used;
  }
  papPosition(){
    if(this.papLocation==null)return this.papBase;const at=pos(this.data.papLocations[this.papLocation]);
    if(this.papStage==='rising')at[2]-=350*(1-Math.min(1,(this.game.time-this.papStarted)/5));
    else if(this.papStage==='lowering')at[2]-=350*Math.min(1,(this.game.time-this.papStarted)/5);
    return at;
  }
  updatePapPlacement(){
    const g=this.game,at=this.papPosition(),spot=this.data.papLocations[this.papLocation];if(!spot)return;
    const yaw=Number(spot.angles.split(' ')[1]),baseYaw=this.originalPap.values().next().value?.angles[1]||0,delta=(yaw-baseYaw)*Math.PI/180;
    const rotate=v=>[v[0]*Math.cos(delta)-v[1]*Math.sin(delta),v[0]*Math.sin(delta)+v[1]*Math.cos(delta),v[2]];
    for(const [e,rest]of this.originalPap){const offset=rotate(rest.position.map((v,k)=>v-this.papBase[k]));e.origin=at.map((v,k)=>v+offset[k]).join(' ');e.angles=[rest.angles[0],rest.angles[1]+yaw-baseYaw,rest.angles[2]].join(' ');}
    const trigger=g.interactions.find(e=>e.targetname==='zombie_vending_upgrade'),offset=rotate(this.papTriggerOffset);
    trigger.position=at.map((v,k)=>v+offset[k]);trigger.origin=trigger.position.join(' ');
  }
  tickPap(){
    const g=this.game;if(!this.power||g.time<this.papDue)return;
    if(this.papStage==='hidden'){this.papStage='searching';this.papDue=g.time+15;g.emit('sound',{alias:'zmb_pap_lightning_1'});}
    else if(this.papStage==='searching'){
      const choices=this.data.papLocations.map((_,i)=>i).filter(i=>i!==this.papLocation);this.papLocation=choices[random(0,choices.length)];
      this.papStage='rising';this.papStarted=g.time;this.papDue=g.time+5.5;g.emit('sound',{alias:'zmb_pap_lightning_2'});g.emit('sound',{alias:'zmb_pap_rise',position:pos(this.data.papLocations[this.papLocation])});
    }else if(this.papStage==='rising'){this.papStage='active';this.papAvailable=true;this.papDue=g.time+114.5;g.message('Pack-a-Punch is available');g.emit('loop',{id:'kino_pap_rollers',alias:'packa_rollers_loop',position:this.papPosition(),near:40,far:400});}
    else if(this.papStage==='active'&&!this.pap){this.papAvailable=false;this.papStage='lowering';this.papStarted=g.time;this.papDue=g.time+5;g.emit('stopLoop',{id:'kino_pap_rollers'});g.emit('sound',{alias:'zmb_pap_lower',position:this.papPosition()});}
    else if(this.papStage==='lowering'){this.papStage='hidden';this.papDue=g.time+random(100,120);}
  }
  waterAt(point){return inside([point[0],point[1],point[2]+15],this.data.waterVolumes);}
  tickWater(){
    const g=this.game;if(g.time<this.waterDue)return;const dt=.1;this.waterDue=g.time+dt;
    this.inWater=this.waterAt(g.player.position);this.cold=Math.max(0,Math.min(30,this.cold+(this.inWater?dt:-dt)));
    if(this.cold>=30&&!this.frozen){this.frozen=true;g.message('Frozen · a teammate can shoot the ice to free you');g.emit('sound',{alias:'zmb_ice_effect_loop'});}
    if(this.frozen)g.invulnerableUntil=g.time+.2;
  }
  thaw(){if(!this.frozen)return;this.frozen=false;this.cold=0;this.waterDue=this.game.time+.1;this.game.emit('sound',{alias:'zmb_ice_shatter'});this.game.message('Ice broken');}
  spawnDirector(){
    const g=this.game,e=this.data.directorSpawn,p=pos(e);let at;
    try{at=g.collision.actor(()=>g.settleFeet([p[0],p[1],p[2]+100]));}catch{at=p;}
    const name='ai_zombie_boss_walk_slow_coast',z={id:g.nextId++,kind:'george',ignoreRound:true,health:Math.max(7500,250000*(g.coop?.playerCount()||1)*.7**this.directorDeaths),position:at,previousPosition:at.slice(),window:g.windows[0],stage:'rise',riseAnim:'ai_zombie_boss_emerge_from_water',riseUntil:g.time+(g.presentation.animations.ai_zombie_boss_emerge_from_water?.duration||5),path:[],attackDue:0,navDue:0,angle:Number(e.angles.split(' ')[1])*Math.PI/180,dead:false,age:0,spawnTime:g.time,gait:name,speed:gaitSpeed(g.presentation.animations[name]),angry:false};
    this.directorId=z.id;g.enemies.push(z);g.emit('spawn',z);g.emit('sound',{alias:'vox_romero_start_0',position:at});
  }
  defeatDirector(z){
    const g=this.game;z.dead=true;z.deathTime=g.time;g.emit('kill',z);this.directorDeaths++;this.directorReturnRound=g.round+2;this.directorDue=g.time+30;
    g.addDrop('free_perk',[z.position[0]+25,z.position[1],z.position[2]]);g.addDrop('minigun',z.position);g.message('George defeated');g.emit('sound',{alias:'vox_romero_weaken_0',position:z.position});
  }
  grantPerk(){const g=this.game,choices=Object.keys(PERKS).filter(id=>g.interactions.some(e=>e.script_noteworthy===id)&&!this.perks.has(id));if(!choices.length)return;
    const id=choices[random(0,choices.length)];this.perks.add(id);if(id==='specialty_armorvest')g.player.health=this.maxHealth;g.emit('sound',{alias:PERKS[id].sting});g.message('Free '+PERKS[id].name);}
  tick(){
    this.papOn=true;super.tick();const g=this.game;if(g.phase==='ready'||g.phase==='dead')return;
    this.tickWater();if(!g.mirror){this.tickPap();const george=g.enemies.find(e=>e.id===this.directorId);
      if((!george||george.dead)&&g.time>=this.directorDue&&g.round>=this.directorReturnRound)this.spawnDirector();}
    this.updatePapPlacement();this.tickTransport();
    if(this.deathMachine){g.weapon.clip=g.weapon.definition.clipSize;if(g.time>=this.deathMachineUntil){g.inventory=this.deathMachine.inventory;g.slot=this.deathMachine.slot;this.deathMachine=null;g.reloadEnd=0;g.emit('weapon',g.weapon);}}
  }
  tickTransport(){
    const g=this.game,t=this.transport;
    if(t){const f=Math.min(1,(g.time-t.started)/t.duration),p=t.from.map((v,k)=>v+(t.to[k]-v)*f+(k===2?t.arc*Math.sin(Math.PI*f):0));
      Object.assign(g.player,{position:p,previousPosition:p.slice(),velocityZ:0,grounded:false});g.invulnerableUntil=g.time+.2;this.riding=true;
      if(f>=1){this.transport=null;this.riding=false;g.player.grounded=false;this.transportCooldown=g.time+3;}return;}
    this.riding=this.frozen;if(!this.power||g.time<this.transportCooldown||this.frozen)return;
    const p=[...g.player.position];p[2]+=25;
    const trigger=this.data.transportTriggers.find(t=>inside(p,[t]));if(!trigger)return;
    const nodes=g.entities.filter(e=>e.targetname===trigger.target&&e.classname==='script_struct');
    if(trigger.kind==='player_zipline'){
      const end=nodes.find(e=>e.script_noteworthy==='zipline_land_spot');if(!end)return;
      this.transport={from:g.player.position.slice(),to:pos(end),started:g.time,duration:distance(g.player.position,pos(end))/500,arc:0};g.emit('sound',{alias:'evt_zipline_slide'});
    }else if(this.flags.has('residence_beach_group')){const end=g.entities.find(e=>e.targetname==='player_launch_spot');this.transport={from:g.player.position.slice(),to:pos(end),started:g.time,duration:2.5,arc:250};g.emit('sound',{alias:'zmb_flinger_activate'});}
  }
  saveState(){return {...super.saveState(),directorId:this.directorId,directorDeaths:this.directorDeaths,directorReturnRound:this.directorReturnRound,directorDue:this.directorDue,cold:this.cold,frozen:this.frozen,sickle:this.sickle,papLocation:this.papLocation,papStage:this.papStage,papDue:this.papDue,papStarted:this.papStarted,papAvailable:this.papAvailable,transport:this.transport,transportCooldown:this.transportCooldown};}
  loadState(s){super.loadState(s);for(const k of ['directorId','directorDeaths','directorReturnRound','directorDue','cold','frozen','sickle','papLocation','papStage','papDue','papStarted','papAvailable','transport','transportCooldown'])if(s[k]!==undefined)this[k]=s[k];if(this.papDue==null)this.papDue=Infinity;this.updatePapPlacement();}
  coopState(){return {papLocation:this.papLocation,papStage:this.papStage,papLeft:Number.isFinite(this.papDue)?this.papDue-this.game.time:null,papAge:this.game.time-this.papStarted,papAvailable:this.papAvailable};}
  applyCoopState(s){if(s){Object.assign(this,s,{papDue:s.papLeft==null?Infinity:this.game.time+s.papLeft,papStarted:this.game.time-s.papAge});this.updatePapPlacement();}}
}

export class CallOfDeadEngine extends BlackOpsEngine {
  constructor(...args){super(...args,g=>new CoastRules(g));this.engine='black-ops-t5-coast';}
  newGame(){super.newGame();this.projectiles=[];this.nextProjectileId=1;}
  get movementBlocked(){return super.movementBlocked||!!this.mapRules.frozen||!!this.mapRules.transport;}
  hipSpread(){return super.hipSpread()*(this.mapRules.perks.has('specialty_deadshot')?.65:1);}
  melee(){const w=this.weapon,d=w.definition;if(this.mapRules.sickle){const upgrade=this.data.map.meleeUpgrade;w.definition={...d,...Object.fromEntries(Object.entries(upgrade).filter(([k])=>k.startsWith('melee')))};}try{return super.melee();}finally{w.definition=d;}}
  meleeAnims(e){return e.kind==='george'?['ai_zombie_boss_attack_swing_overhead_coast','ai_zombie_boss_attack_swing_swipe_coast']:super.meleeAnims(e);}
  meleeDamage(){return this.attackingEnemy?.kind==='george'?50:super.meleeDamage();}
  tickEnemy(e,dt){
    if(e.kind==='human'&&!e.dead){e.age+=dt;e.speed=150;this.advancePath(e,dt,e.humanDestination);if(this.time>=e.humanUntil){e.dead=true;e.deathTime=this.time;this.emit('kill',e);}return;}
    const speed=e.speed;
    if(e.kind==='george'&&!e.dead){
      const wet=this.mapRules.waterAt(e.position);if(wet){if(!e.calmDue)e.calmDue=this.time+2;if(this.time>=e.calmDue)e.angry=false;}else e.calmDue=0;
      e.gait=e.angry?'ai_zombie_boss_sprint_a_coast':'ai_zombie_boss_walk_slow_coast';e.speed=gaitSpeed(this.presentation.animations[e.gait]);
    }else if(!e.dead&&this.mapRules.waterAt(e.position))e.speed*=.5;
    try{super.tickEnemy(e,dt);}finally{if(e.kind!=='george')e.speed=speed;}
  }
  hitEnemy(e,damage,head=false,melee=false){
    if(this.firingNative&&this.weapon.definition.weaponType==='projectile'&&!melee)return;
    if(e.kind==='george'){
      if(e.dead||this.coop?.forwardHit(e,damage,head,melee))return;
      if(this.killMod==='nuke')return;
      e.angry=true;e.calmDue=this.mapRules.waterAt(e.position)?this.time+2:0;e.health-=damage;
      if(e.health<=0)this.mapRules.defeatDirector(e);else if(this.time>=(e.voiceDue||0)){e.voiceDue=this.time+4;this.emit('sound',{alias:'vox_romero_angry_'+random(0,3),position:e.position.slice()});}return;
    }
    return super.hitEnemy(e,damage,head,melee);
  }
  humanize(e,upgraded=this.weapon.name.includes('upgraded')){
    if(this.coop?.guest){this.coop.toHost({type:'coastHumanize',enemy:e.id,upgraded});return;}
    if(e.kind==='george'){e.angry=false;if(upgraded&&this.mapRules.waterAt(e.position)){e.dead=true;e.deathTime=this.time;this.emit('kill',e);this.mapRules.directorReturnRound=this.round+1;this.mapRules.directorDue=this.time+30;}return;}
    // The same zombie becomes the original CIA agent and runs to a water exit.
    const destinations=this.entities.filter(e=>e.targetname==='struct_humangun_dest').map(pos).sort((a,b)=>distance(a,e.position)-distance(b,e.position));
    const target=destinations[0]||e.position;this.emit('removeEnemy',e);e.kind='human';e.health=100;e.gait='ai_zombie_humangun_run_a';e.humanDestination=target;e.humanUntil=this.time+10;e.path=this.path(e.position,target);e.stage='hunt';this.emit('spawn',e);
  }
  emit(type,value){
    if(type==='melee'&&this.mapRules.sickle)value={...value,upgrade:this.data.map.meleeUpgrade};
    if(type==='shot'&&this.firingNative&&this.weapon.definition.weaponType==='projectile'){
      const d=this.weapon.definition,p={id:this.nextProjectileId++,weapon:this.weapon.name,position:value.origin.slice(),previousPosition:value.origin.slice(),velocity:value.dir.map(v=>v*(d.projectileSpeed||6000)),direction:value.dir.slice(),due:this.time+(d.projectileLifetime||10),stuck:false};
      this.projectiles.push(p);super.emit('coastProjectile',p);value={...value,rays:[]};
    }
    return super.emit(type,value);
  }
  explodeProjectile(p,d){
    for(const e of this.enemies)if(!e.dead){const target=[e.position[0],e.position[1],e.position[2]+35],range=distance(target,p.position);if(range>=d.explosionRadius||this.collision.trace(p.position,target,[0,0,0],1).fraction<.98)continue;
      this.hitEnemy(e,d.explosionOuterDamage+(d.explosionInnerDamage-d.explosionOuterDamage)*(1-range/d.explosionRadius));}
    const target=[...this.player.position];target[2]+=35;const range=distance(target,p.position);
    if(!this.mapRules.perks.has('specialty_flakjacket')&&range<d.explosionRadius&&this.collision.trace(p.position,target,[0,0,0],1).fraction>.98)this.damagePlayer(Math.min(100,d.explosionInnerDamage));
    const effect=this.presentation.effects[d.projExplosionEffect]?d.projExplosionEffect:'explosions/grenadeexp_concrete';
    this.emit('effect',{name:effect,position:p.position.slice(),duration:3});this.emit('sound',{alias:d.projExplosionSound||'grenade_explode',position:p.position.slice()});
  }
  updateProjectiles(dt){
    for(const p of this.projectiles){if(p.done)continue;const d=this.data.weapons[p.weapon];
      if(p.stuck){const e=p.stuckEnemy&&this.enemies.find(e=>e.id===p.stuckEnemy&&!e.dead);if(e)p.position=e.position.map((v,k)=>v+(p.offset?.[k]||0));if(this.time>=p.due){this.explodeProjectile(p,this.data.map.projectileWeapons[p.weapon.includes('upgraded')?'sniper_explosive_bolt_upgraded_zm':'sniper_explosive_bolt_zm']);p.done=true;}}
      else{
        if(d.projTrajectory==='gravity')p.velocity[2]-=800*dt;
        const old=p.position,move=p.velocity.map(v=>v*dt),length=Math.hypot(...move),dir=move.map(v=>v/length),ray=this.events.traceShot?.(old,dir,length);
        p.previousPosition=old.slice();p.position=ray?.hit||ray?.wall?ray.end.slice():old.map((v,k)=>v+move[k]);
        if(ray?.hit||ray?.wall){
          if(p.weapon.startsWith('sniper_explosive')){p.stuck=true;p.due=this.time+(this.data.map.projectileWeapons[p.weapon.includes('upgraded')?'sniper_explosive_bolt_upgraded_zm':'sniper_explosive_bolt_zm'].fuseTime||3);
            if(ray.hit){p.stuckEnemy=ray.hit.enemy.id;p.offset=p.position.map((v,k)=>v-ray.hit.enemy.position[k]);}this.emit('sound',{alias:'wpn_ubersniper_bomb_rampup',position:p.position});}
          else{if(ray.hit){if(p.weapon.startsWith('humangun'))this.humanize(ray.hit.enemy);else this.hitEnemy(ray.hit.enemy,d.damage*(ray.hit.head?d.locHead||1:1),ray.hit.head);this.emit('hit',ray.hit.head);}
            if(!p.weapon.startsWith('humangun')&&d.explosionRadius>0)this.explodeProjectile(p,d);else if(d.projExplosionEffect)this.emit('effect',{name:d.projExplosionEffect,position:p.position.slice(),duration:1});p.done=true;}
        }else if(this.time>=p.due)p.done=true;
      }
      if(p.done)this.emit('coastProjectileRemove',p.id);
    }
    this.projectiles=this.projectiles.filter(p=>!p.done);
  }
  tick(dt,input){super.tick(dt,input);if(!['ready','dead'].includes(this.phase))this.updateProjectiles(dt);}
  movePlayerOverride(p,input,dt){if(this.mapRules.transport||this.mapRules.frozen){this.sprinting=false;p.velocityZ=0;return true;}return super.movePlayerOverride(p,input,dt);}
  pickup(drop){
    if(!['minigun','free_perk'].includes(drop.type))return super.pickup(drop);
    drop.used=true;this.emit('pickup',drop);this.emit('stopLoop',{id:'drop'+drop.id});this.emit('sound',{alias:'powerup_grabbed'});
    if(drop.type==='free_perk'){this.mapRules.grantPerk();return;}
    if(this.coop?.pickupBy&&this.coop.pickupBy!==this.coop.localId)return;
    this.grantDeathMachine();
  }
  grantDeathMachine(){
    const r=this.mapRules;if(!r.deathMachine)r.deathMachine={inventory:this.inventory,slot:this.slot};r.deathMachineUntil=this.time+30;
    this.inventory=[this.makeWeapon('minigun_zm')];this.slot=0;this.reloadEnd=0;this.switching=null;this.emit('weapon',this.weapon);this.message('Death Machine · 30 seconds');
  }
  switchWeapon(...args){if(!this.mapRules.deathMachine)return super.switchWeapon(...args);}
  canSave(){return !this.projectiles.length&&!this.mapRules.deathMachine&&super.canSave();}
}
