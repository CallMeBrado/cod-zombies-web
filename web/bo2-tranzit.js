// Classic TranZit: native zones, buildables and the authored bus loop.
import {KinoRules} from './bo1-engine.js';
import {NuketownRules} from './bo2-nuketown.js';
import {BuriedEquipment} from './bo2-equipment.js';
import {PERKS} from './map-rules.js';
import {playerSpeed} from './player-movement.js';
const pos=e=>e.origin.split(/\s+/).map(Number),distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const inside=(at,h)=>h.mins.every((v,k)=>at[k]>=v)&&h.maxs.every((v,k)=>at[k]<=v)&&h.planes.every(p=>p[0]*at[0]+p[1]*at[1]+p[2]*at[2]<=p[3]+1);
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
export const TRANZIT_STOPS={depot:'Bus Depot',diner:'Diner',farm:'Farm',power:'Power Station',town:'Town'};

class TranzitEquipment extends BuriedEquipment {
  prompt(e,key){const b=this.benches.get(e.targetname),kind=e.tranzitBench;
    if(b?.complete&&['powerswitch','pap','cattlecatcher','bushatch','busladder'].includes(kind))return this.name(kind)+' assembled';
    if(this.rules.carry?.equipment&&this.rules.carry.equipment!==kind)return 'This bench builds '+this.name(kind);
    return super.prompt(e,key);}
  use(e){const kind=e.tranzitBench;if(!kind)return true;
    if(['powerswitch','pap','cattlecatcher','bushatch','busladder'].includes(kind)&&this.benches.get(e.targetname)?.complete)return true;
    if(this.rules.carry&&this.rules.carry.equipment!==kind)return true;
    const before=this.benches.get(e.targetname);
    if(before?.complete&&kind==='riotshield_zm'){this.rules.shield=15;this.game.message('Zombie Shield equipped');return true;}
    return super.use(e);}
  tick(dt){super.tick(dt);const g=this.game;
    for(const [key,b]of this.benches)if(b.complete)this.rules.built.add(b.kind);
    for(const item of this.placed){if(!['turret','electric_trap'].includes(item.kind)||g.time<item.due||!this.placed.some(p=>p.kind==='turbine'&&distance(p.position,item.position)<335))continue;
      const targets=g.enemies.filter(e=>!e.dead&&!e.ignoreRound&&distance(e.position,item.position)<(item.kind==='turret'?1100:140));
      for(const e of targets){const from=[...item.position];from[2]+=35;const to=[...e.position];to[2]+=35;if(g.collision.trace(from,to,[0,0,0],1).fraction<.98)continue;
        g.hitEnemy(e,item.kind==='turret'?250:this.damage50,false,false);g.emit('effect',{name:'maps/zombie/fx_zmb_electric_trap',position:e.position.slice(),duration:.2});if(item.kind==='turret')break;}
      item.due=g.time+(item.kind==='turret'?.15:1);}
  }
}

export class TranzitRules extends KinoRules {
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  reset(){super.reset();this.flags.add('init_classic_adjacencies');this.flags.add('OnFarm_enter');this.built=new Set();this.collected=new Set();this.partChoices={};
    for(const [group,choices]of Object.entries(this.data.partGroups))this.partChoices[group]=choices[Math.floor(Math.random()*choices.length)];
    this.equipment=new TranzitEquipment(this);this.carry=null;this.meleeUpgrade=null;this.shield=0;this.bank=0;this.weaponLocker=null;
    this.lastTick=this.game.time;this.lavaDue=0;this.fogDue=this.game.time+5;this.denizen=null;this.avogadroRound=0;this.salePlaying=false;
    const first=this.data.bus.route[0];this.bus={index:0,fraction:0,position:first.position.map((v,k)=>v+(k===2?this.data.bus.originZOffset:0)),yaw:(first.yaw||0)*Math.PI/180,stop:'depot',due:this.game.time+60,moving:false,doors:true,horn:false};
    this.riding=false;this.riderLocal=[170,0,36];this.busInteraction();
  }
  installInteractions(){const g=this.game;
    for(const e of g.entities)if(e.tranzitPart||e.tranzitBench||e.targetname==='tranzit_power')g.interactions.push({...e,position:pos(e)});
    for(const [name,tag]of [['bank_deposit','tranzit_bank_deposit'],['bank_withdraw','tranzit_bank_withdraw'],['weapons_locker','tranzit_locker']])
      for(const e of g.entities.filter(e=>e.targetname===name))g.interactions.push({...e,targetname:tag,position:pos(e)});
    this.busInteraction();
  }
  world(local,bus=this.bus){const c=Math.cos(bus.yaw),s=Math.sin(bus.yaw);return [bus.position[0]+local[0]*c-local[1]*s,bus.position[1]+local[0]*s+local[1]*c,bus.position[2]+local[2]];}
  local(at){const dx=at[0]-this.bus.position[0],dy=at[1]-this.bus.position[1],c=Math.cos(this.bus.yaw),s=Math.sin(this.bus.yaw);return [dx*c+dy*s,-dx*s+dy*c,at[2]-this.bus.position[2]];}
  busInteraction(){const g=this.game;let e=g.interactions.find(e=>e.targetname==='tranzit_bus');
    if(!e){e={targetname:'tranzit_bus'};g.interactions.push(e);}e.position=this.world([280,-88,55]);
    // Two authored doors; both remain usable when the bus is at a stop.
    let rear=g.interactions.find(e=>e.targetname==='tranzit_bus_rear');if(!rear){rear={targetname:'tranzit_bus_rear'};g.interactions.push(rear);}rear.position=this.world([20,-88,55]);
    for(const [kind,at]of [['cattlecatcher',[345,0,45]],['bushatch',[180,0,55]],['busladder',[142,-96,55]]]){let trigger=g.interactions.find(e=>e.targetname==='tranzit_install_'+kind);if(!trigger){trigger={targetname:'tranzit_install_'+kind,tranzitBench:kind};g.interactions.push(trigger);}trigger.position=this.world(at);}
  }
  negotiationLink(a,b,l){return NuketownRules.prototype.negotiationLink.call(this,a,b,l);}
  startTraversal(e){return NuketownRules.prototype.startTraversal.call(this,e);}
  advanceTraversal(e,dt){return NuketownRules.prototype.advanceTraversal.call(this,e,dt);}
  enabledSpawners(){return super.enabledSpawners().filter(e=>!e.nativeNoteworthy?.includes('screecher'));}
  visible(e){if(e.tranzitPart)return this.partChoices[e.partGroup]===e.itemId&&!this.collected.has(e.itemId);
    if(e.targetname==='tranzit_power')return this.built.has('powerswitch');
    if(e.targetname==='zombie_vending_upgrade')return this.built.has('pap');
    if(e.targetname?.startsWith('tranzit_install_'))return this.carry?.equipment===e.tranzitBench&&!this.built.has(e.tranzitBench);
    if(e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_scavenger')return false; // Tombstone's co-op recovery remains pending.
    if(e.targetname==='buried_equipment')return this.equipment.placed.some(p=>p.id===e.equipmentId);
    if(e.targetname==='tranzit_bus'||e.targetname==='tranzit_bus_rear')return true;
    if(e.targetname==='treasure_chest_use'&&this.game.powerup.fire_sale)return true;
    if(e.targetname==='zombie_door'&&e.script_noteworthy?.includes('electric_door'))return !this.game.opened.has(e.target);
    return super.visible(e);}
  prompt(e,key){const g=this.game;
    if((e.tranzitPart||e.tranzitBench)&&g.mirror)return 'The host assembles buildables';
    if(e.tranzitPart)return this.carry?'Already carrying a part':key+' · Pick up '+this.equipment.name(e.tranzitPart)+' part';
    if(e.tranzitBench)return this.equipment.prompt(e,key);
    if(e.targetname==='tranzit_power')return key+' · Turn '+(this.power?'off':'on')+' the power';
    if(e.targetname==='tranzit_bus'||e.targetname==='tranzit_bus_rear')return key+' · '+(!this.bus.doors?'Open doors':this.riding?'Leave bus':'Board bus')+' · '+(TRANZIT_STOPS[this.bus.stop]||'In transit');
    if(e.targetname==='buried_equipment')return key+' · Pick up '+this.equipment.name(this.equipment.placed.find(p=>p.id===e.equipmentId)?.kind||'turbine');
    if(e.targetname==='zombie_door'&&e.script_noteworthy?.includes('electric_door'))return this.equipment.powered(e.position)?key+' · Open electric door':'Place a Turbine nearby to power this door';
    if(e.targetname==='zombie_vending'){
      const quick=e.script_noteworthy==='specialty_quickrevive',p=PERKS[e.script_noteworthy];if(!p)return '';
      if(this.perks.has(e.script_noteworthy))return p.name+' purchased';if(!this.equipment.powered(e.position)&&!(quick&&!g.coop))return 'You must turn on the power or place a Turbine';
      return key+' · Buy '+(e.script_noteworthy==='specialty_rof'?'Double Tap II':p.name)+' · '+(quick&&!g.coop?500:p.cost)+' points';}
    if(e.zombie_weapon_upgrade==='tazer_knuckles_zm')return this.meleeUpgrade==='tazer_knuckles_zm'?'Galvaknuckles purchased':key+' · Buy Galvaknuckles · 6000 points';
    if(e.zombie_weapon_upgrade==='bowie_knife_zm')return this.meleeUpgrade==='bowie_knife_zm'?'Bowie Knife purchased':key+' · Buy Bowie Knife · 3000 points';
    if(e.targetname==='tranzit_bank_deposit')return key+' · Deposit 1000 · Bank '+this.bank;
    if(e.targetname==='tranzit_bank_withdraw')return key+' · Withdraw 1000 · Fee 100 · Bank '+this.bank;
    if(e.targetname==='tranzit_locker')return key+' · '+(this.weaponLocker?'Swap stored weapon':'Store weapon');
    return super.prompt(e,key);
  }
  use(e){const g=this.game,tag=e.targetname;
    if((e.tranzitPart||e.tranzitBench)&&g.mirror)return true;
    if(e.tranzitPart){if(!this.carry&&this.visible(e)){this.carry={kind:'part',equipment:e.tranzitPart,itemId:e.itemId};this.collected.add(e.itemId);g.emit('buriedItem',{id:e.itemId,visible:false});g.emit('sound',{alias:'zmb_buildable_pickup'});}return true;}
    if(e.tranzitBench)return this.equipment.use(e);
    if(tag==='buried_equipment')return this.equipment.pickup(e);
    if(tag==='tranzit_power'){if(!this.built.has('powerswitch'))return true;this.power=!this.power;this.powerStartedAt=g.time;
      if(this.power)this.flags.add('power_on');else this.flags.delete('power_on');this.papOn=false;g.emit('power');g.emit('sound',{alias:'switch_flip'});g.emit('sound',{alias:this.power?'zmb_turn_on':'zmb_turn_off'});
      if(this.power){for(const e of g.interactions.filter(e=>e.target==='pf1766_auto2158')){this.openTargets([e.target]);if(e.script_flag)this.flags.add(e.script_flag);}this.openTargets(['reactor_core_door']);}g.message(this.power?'Power restored':'Power switched off');return true;}
    if(tag==='tranzit_bus'||tag==='tranzit_bus_rear'){if(!this.bus.doors){this.bus.doors=true;g.emit('sound',{alias:'zmb_bus_door_open',position:this.bus.position});return true;}
      if(this.riding){const at=this.world([tag.endsWith('rear')?20:280,-140,100]);let floor;
        try{floor=g.settleFeet(at);}catch{g.message('Cannot exit safely here');return true;}this.riding=false;this.teleportTo(floor);}
      else{this.riding=true;this.riderLocal=[tag.endsWith('rear')?45:250,0,36];this.teleportTo(this.world(this.riderLocal));}return true;}
    if(tag==='zombie_door'&&e.script_noteworthy?.includes('electric_door')){if(this.equipment.powered(e.position)){this.openTargets([e.target]);if(e.script_flag)this.flags.add(e.script_flag);}return true;}
    if(tag==='zombie_vending'){
      const id=e.script_noteworthy,p=PERKS[id],quick=id==='specialty_quickrevive',solo=!g.coop;
      if(!p||this.perks.has(id)||this.perks.size>=4||(!this.equipment.powered(e.position)&&!(quick&&solo))||g.gesture||quick&&solo&&this.revivesUsed>=3)return true;
      if(g.spendPoints(quick&&solo?500:p.cost)){g.startGesture(id,()=>{this.perks.add(id);if(id==='specialty_armorvest')g.player.health=this.maxHealth;});g.emit('sound',{alias:p.sting});}return true;}
    if(tag==='zombie_vending_upgrade'&&!this.built.has('pap'))return true;
    if(['bowie_knife_zm','tazer_knuckles_zm'].includes(e.zombie_weapon_upgrade)){const id=e.zombie_weapon_upgrade;if(this.meleeUpgrade!==id&&g.spendPoints(id==='tazer_knuckles_zm'?6000:3000)){this.meleeUpgrade=id;g.message(id==='tazer_knuckles_zm'?'Galvaknuckles purchased':'Bowie Knife purchased');}return true;}
    if(tag==='tranzit_bank_deposit'){if(this.bank<250000&&g.spendPoints(1000))this.bank+=1000;return true;}
    if(tag==='tranzit_bank_withdraw'){if(this.bank>=1000){this.bank-=1000;g.changePoints(900);g.emit('sound',{alias:'cha_ching'});}return true;}
    if(tag==='tranzit_locker'){const stored=this.weaponLocker;this.weaponLocker=JSON.parse(JSON.stringify(g.weapon));if(stored){g.inventory[g.slot]=stored;g.emit('weapon',g.weapon);}else{g.inventory.splice(g.slot,1);if(!g.inventory.length)g.inventory.push(g.makeWeapon(g.data.startWeapon));g.slot=0;g.emit('weapon',g.weapon);}return true;}
    return super.use(e);
  }
  openTargets(targets){const closed=targets.filter(target=>target&&!this.game.opened.has(target));if(closed.length)super.openTargets(closed);}
  teleportTo(at){const g=this.game;Object.assign(g.player,{position:at.slice(),previousPosition:at.slice(),velocityZ:0,grounded:true});g.targetNode=-1;g.targetNodeDue=0;g.spawnDistanceCache=null;}
  movePlayer(p,input,dt){if(!this.riding||this.game.mods?.noclip)return false;
    const g=this.game,f=input.forward||0,r=input.side||0,length=Math.max(1,Math.hypot(f,r)),speed=(g.sprinting?285:190)*g.weapon.definition.moveSpeedScale*playerSpeed(g)/length,a=g.yaw-this.bus.yaw;
    const dx=(Math.cos(a)*f+Math.sin(a)*r)*speed*dt,dy=(Math.sin(a)*f-Math.cos(a)*r)*speed*dt;
    this.riderLocal[0]=Math.max(4,Math.min(285,this.riderLocal[0]+dx));this.riderLocal[1]=Math.max(-54,Math.min(54,this.riderLocal[1]+dy));
    if(input.jump&&p.grounded){p.velocityZ=220;p.grounded=false;}if(!p.grounded){p.velocityZ-=800*dt;this.riderLocal[2]=Math.min(100,this.riderLocal[2]+p.velocityZ*dt);if(this.riderLocal[2]<=36){this.riderLocal[2]=36;p.velocityZ=0;p.grounded=true;}}
    p.position=this.world(this.riderLocal);return true;
  }
  updateBus(dt){const g=this.game,b=this.bus,route=this.data.bus.route,previousYaw=b.yaw;
    if(!b.moving){if(!b.horn&&g.time>=b.due-5){b.horn=true;g.emit('sound',{alias:'zmb_bus_horn',position:b.position});}
      if(g.time>=b.due){b.moving=true;b.doors=false;b.stop=null;g.emit('sound',{alias:'vox_bus_doors_close_0',position:this.world([327,36,60]),near:200,far:1200});g.emit('loop',{id:'tranzit_bus',alias:'zmb_bus_engine_loop',position:b.position,followBus:true,near:200,far:1800});}}
    if(b.moving){let travel=(route[b.index].speed||335)*dt;
      for(let n=0;n<8&&travel>0;n++){const from=route[b.index],nextIndex=(b.index+1)%route.length,to=route[nextIndex],length=distance(from.position,to.position),left=length*(1-b.fraction);
        if(travel<left){b.fraction+=travel/Math.max(1,length);travel=0;}else{travel-=left;b.index=nextIndex;b.fraction=0;if(to.stop){b.moving=false;b.doors=true;b.horn=false;b.stop=to.stop;b.due=g.time+this.data.bus.waitMin+Math.random()*(this.data.bus.waitMax-this.data.bus.waitMin);g.emit('stopLoop',{id:'tranzit_bus'});
          const prefix='vox_bus_near_'+(to.stop==='depot'?'station':to.stop),lines=Object.keys(g.data.sounds).filter(n=>n.startsWith(prefix));if(lines.length)g.emit('sound',{alias:lines[Math.floor(Math.random()*lines.length)],position:this.world([327,36,60]),near:200,far:1500});g.message('Bus arrived · '+TRANZIT_STOPS[to.stop]);break;}}}
      const from=route[b.index],to=route[(b.index+1)%route.length];b.position=from.position.map((v,k)=>v+(to.position[k]-v)*b.fraction+(k===2?this.data.bus.originZOffset:0));
      const heading=!b.moving&&from.yaw!==null?from.yaw*Math.PI/180:Math.atan2(to.position[1]-from.position[1],to.position[0]-from.position[0]);b.yaw+=angleDelta(heading,b.yaw)*Math.min(1,dt*6);
    }
    if(this.riding){const delta=angleDelta(b.yaw,previousYaw);g.yaw+=delta;g.emit('platformTurn',{delta});g.player.position=this.world(this.riderLocal);}
    this.busInteraction();
  }
  busTrace(start,end,half,result){
    if(['ready','dead'].includes(this.game.phase)||half[2]<10)return result;
    const a=this.local(start),z=this.local(end),c=Math.cos(this.bus.yaw),s=Math.sin(this.bus.yaw),h=[Math.abs(c)*half[0]+Math.abs(s)*half[1],Math.abs(s)*half[0]+Math.abs(c)*half[1],half[2]];
    const boxes=[[[0,-80,26],[340,80,36]],[[0,-80,166],[340,80,178]],[[-40,-80,36],[0,80,166]],[[300,-80,36],[355,80,166]],[[0,68,36],[340,88,166]]];
    if(this.bus.doors)boxes.push([[60,-88,36],[260,-68,166]]);else boxes.push([[0,-88,36],[340,-68,166]]);
    let fraction=result.fraction,normal=result.normal,solid=result.solid,allSolid=result.allSolid;
    for(const [lo,hi]of boxes){let near=0,far=1,hit=null,within=true,endWithin=true,reject=false;
      for(let k=0;k<3;k++){const min=lo[k]-h[k],max=hi[k]+h[k],d=z[k]-a[k];if(a[k]<min-.03||a[k]>max+.03)within=false;if(z[k]<min-.03||z[k]>max+.03)endWithin=false;
        if(Math.abs(d)<1e-9){if(a[k]<min||a[k]>max)reject=true;continue;}const t1=(min-a[k])/d,t2=(max-a[k])/d,n=Math.min(t1,t2);if(n>=near){near=n;hit=[0,0,0];hit[k]=d>0?-1:1;}far=Math.min(far,Math.max(t1,t2));if(near>far)reject=true;}
      if(reject)continue;if(within){solid=true;if(endWithin){let closest=-Infinity,face=null;for(let k=0;k<3;k++)for(const [d,sign]of [[lo[k]-h[k]-a[k],-1],[a[k]-hi[k]-h[k],1]])if(d>closest){closest=d;face=[0,0,0];face[k]=sign;}
        if(closest<-.06){allSolid=true;fraction=0;}else if(face.reduce((v,n,k)=>v+n*(z[k]-a[k]),0)<-1e-9){fraction=0;normal=[face[0]*c-face[1]*s,face[0]*s+face[1]*c,face[2]];}}continue;}
      if(hit&&near>=0&&near<fraction){fraction=Math.max(0,near-.001);normal=[hit[0]*c-hit[1]*s,hit[0]*s+hit[1]*c,hit[2]];}
    }
    return {...result,fraction,normal,solid,allSolid,end:start.map((v,k)=>v+(end[k]-v)*fraction)};
  }
  get inFog(){const p=this.game.player.position;return !this.riding&&this.data.fogVolumes.some(v=>v.hulls.some(h=>inside([p[0],p[1],p[2]+25],h)));}
  specialEnemy(kind,at){const g=this.game,e={id:g.nextId++,kind,ignoreRound:true,ignoreNuke:true,ignoreInstaKill:kind==='avogadro',position:at,previousPosition:at.slice(),health:kind==='denizen'?30:4,window:null,stage:'hunt',path:[],attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:g.time,gait:'ai_zombie_walk_v1',speed:kind==='denizen'?210:80};g.enemies.push(e);g.emit('spawn',e);return e;}
  tickSpecial(e,dt){if(e.dead)return false;const g=this.game;e.age+=dt;const target=g.player.position,delta=target.map((v,k)=>v-e.position[k]),d=Math.hypot(...delta);e.angle=Math.atan2(delta[1],delta[0]);
    if(e.kind==='denizen'){
      if(this.riding||!this.inFog){e.dead=true;e.deathTime=g.time;g.emit('kill',e);this.denizen=null;return true;}
      if(d<45||e.attached){e.attached=true;e.position=[target[0]+Math.cos(g.yaw)*20,target[1]+Math.sin(g.yaw)*20,target[2]+g.viewHeight-25];e.angle=g.yaw+Math.PI;
        if(g.time>=e.attackDue){e.attackDue=g.time+1;g.damagePlayer(5,{from:e.position});g.emit('sound',{alias:'zmb_vocals_screecher_attack'});}return true;}
    }else if(e.kind==='avogadro'&&d<600&&g.time>=e.attackDue){e.attackDue=g.time+3;
      const from=[...e.position];from[2]+=40;const to=[...target];to[2]+=35;if(g.collision.trace(from,to,[0,0,0],1).fraction>.98){g.damagePlayer(50,{from:e.position});g.emit('sound',{alias:'zmb_avogadro_attack',position:e.position});}return true;}
    if(d>1){const move=delta.map((v,k)=>k===2?-800*dt*dt:v/d*e.speed*dt),floor=g.collision.actor(()=>g.collision.step(e.position,move,e.kind==='denizen'?[8,8,12]:[14,14,35]));e.position=floor.position;}return true;
  }
  knifeDenizen(){const e=this.game.enemies.find(e=>!e.dead&&e.kind==='denizen'&&e.attached);if(!e)return false;const amount=this.meleeUpgrade==='tazer_knuckles_zm'?15:this.meleeUpgrade==='bowie_knife_zm'?10:6;
    this.game.pendingMelee=null;this.game.hitEnemy(e,amount,false,true);return true;}
  explosive(at){const g=this.game;for(const e of g.entities.filter(e=>e.targetname==='town_bunker_door'))if(distance(pos(e),at)<240){this.openTargets([e.target,e.targetname]);if(e.script_flag)this.flags.add(e.script_flag);}}
  tick(){const g=this.game,dt=Math.max(0,Math.min(.1,g.time-(this.lastTick??g.time)));this.lastTick=g.time;
    if(!g.mirror)this.updateBus(dt);this.papOn=true;super.tick();if(g.mirror||['ready','dead'].includes(g.phase))return;
    this.equipment.tick(dt);
    if(this.bus.moving&&this.built.has('cattlecatcher')){const front=this.world([350,0,35]);for(const e of g.enemies)if(!e.dead&&!e.ignoreRound&&distance(e.position,front)<100){e.killDirection=[Math.cos(this.bus.yaw)*400,Math.sin(this.bus.yaw)*400,100];g.hitEnemy(e,e.health,false,false);}}
    // A Turbine at the power-station hatch opens the bank's underground PAP
    // access. The vault doors are destroyed by an explosive, below.
    const hatch=g.entities.find(e=>e.targetname==='lab_secret_hatch');
    if(this.power&&hatch&&this.equipment.placed.some(p=>p.kind==='turbine'&&distance(p.position,pos(hatch))<335))this.openTargets(['pf1803_auto1']);
    if(g.time>=this.lavaDue){this.lavaDue=g.time+.5;if(!this.riding&&this.data.hazards.some(v=>v.hulls.some(h=>inside([g.player.position[0],g.player.position[1],g.player.position[2]+3],h))))g.damagePlayer(15);}
    if(this.inFog&&g.time>=this.fogDue&&!g.enemies.some(e=>!e.dead&&e.kind==='denizen')){this.fogDue=g.time+8;const p=g.player.position,a=g.yaw+Math.PI,at=[p[0]+Math.cos(a)*220,p[1]+Math.sin(a)*220,p[2]+80];
      try{this.denizen=this.specialEnemy('denizen',g.collision.actor(()=>g.settleFeet(at))).id;g.emit('sound',{alias:'zmb_vocals_screecher_spawn'});}catch{}}
    if(this.power&&g.round>=this.avogadroRound+3&&!g.enemies.some(e=>!e.dead&&e.kind==='avogadro')){
      const sites=g.entities.filter(e=>e.script_noteworthy==='avogadro_location').sort((a,b)=>distance(pos(a),g.player.position)-distance(pos(b),g.player.position));
      if(sites[0]&&distance(pos(sites[0]),g.player.position)<2400){try{this.specialEnemy('avogadro',g.collision.actor(()=>g.settleFeet([pos(sites[0])[0],pos(sites[0])[1],pos(sites[0])[2]+40])));this.avogadroRound=g.round;g.emit('sound',{alias:'zmb_avogadro_spawn_3d'});}catch{}}}
    const sale=!!g.powerup.fire_sale;if(sale!==this.salePlaying){this.salePlaying=sale;g.emit(sale?'loop':'stopLoop',sale?{id:'tranzit_sale',alias:'mus_fire_sale'}:{id:'tranzit_sale'});}
  }
  boxCost(e){return this.game.powerup.fire_sale?10:Number(e.zombie_cost)||950;}
  boxJoker(){return NuketownRules.prototype.boxJoker.call(this);}
  saveState(){return {...super.saveState(),built:[...this.built],collected:[...this.collected],partChoices:this.partChoices,carry:this.carry,equipment:this.equipment.saveState(),bus:JSON.parse(JSON.stringify(this.bus)),riding:this.riding,riderLocal:this.riderLocal.slice(),meleeUpgrade:this.meleeUpgrade,shield:this.shield,bank:this.bank,weaponLocker:this.weaponLocker,avogadroRound:this.avogadroRound};}
  loadState(s){super.loadState(s);this.built=new Set(s.built||[]);this.collected=new Set(s.collected||[]);for(const k of ['partChoices','carry','bus','riding','riderLocal','meleeUpgrade','shield','bank','weaponLocker','avogadroRound'])if(s[k]!==undefined)this[k]=s[k];this.equipment.loadState(s.equipment);this.lastTick=this.game.time;this.busInteraction();}
  coopState(){return {bus:this.bus,built:[...this.built],partChoices:this.partChoices,collected:[...this.collected]};}
  applyCoopState(s){const previousYaw=this.bus.yaw;this.bus=s.bus;if(this.riding){const delta=angleDelta(this.bus.yaw,previousYaw);this.game.yaw+=delta;this.game.emit('platformTurn',{delta});}this.built=new Set(s.built||[]);this.partChoices=s.partChoices;this.collected=new Set(s.collected||[]);this.busInteraction();}
}
