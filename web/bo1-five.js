// Five's authored T5 elevators, DEFCON portals and Pentagon Thief.
import {BlackOpsEngine,KinoRules} from './bo1-engine.js';
const pos=e=>e.origin.split(/\s+/).map(Number),dist=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const inside=(p,hulls)=>hulls.some(h=>h.mins.every((v,k)=>p[k]>=v-1)&&h.maxs.every((v,k)=>p[k]<=v+1)&&h.planes.every(q=>q[0]*p[0]+q[1]*p[1]+q[2]*p[2]<=q[3]+1));
const random=(a,b)=>a+Math.floor(Math.random()*(b-a));

export class FiveRules extends KinoRules {
  reset(){
    super.reset();this.cars=Object.fromEntries(this.data.elevators.map(c=>[c.name,{stop:'up',z:0,from:0,to:0,started:0,moving:false,riders:[],called:false}]));
    this.switches=[];this.defcon=1;this.defconStarted=0;this.papUntil=0;this.papOpen=false;this.portalReady=0;this.portalDue=0;this.portalDestination=null;
    this.nextThiefRound=null;this.thiefRound=false;this.thiefReward=false;this.thiefStole=false;this.trapParts=[];this.trapCarry=null;this.traps={};
    this.lastTime=this.game.time;const boxes=this.game.interactions.filter(e=>e.targetname==='treasure_chest_use'&&e.start_exclude!=='1');
    if(boxes.length)this.game.activeBox=boxes[random(0,boxes.length)].target;
    for(const target of this.data.initialDisabled)this.game.collision.disabled.add(target);
    this.installed&&this.syncInteractions();
  }
  installInteractions(){this.installed=true;const g=this.game;for(const e of g.entities)if(e.fiveDefcon!=null||e.fiveTrapPart!=null||e.fiveTrap||e.targetname==='five_elevator_buy'||/^elevator[12]_call_box$/.test(e.targetname))g.interactions.push({...e,position:pos(e)});this.syncInteractions();}
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  activeZones(){const active=super.activeZones();for(const [name,c]of Object.entries(this.cars)){if(c.visited){const d=this.data.elevators.find(v=>v.name===name);active.add(d.downZone);if(name==='elevator2')active.add('war_room_zone_top');else{active.add('labs_elevator');active.add('labs_hallway1');active.add('labs_hallway2');}}}
    if(this.papOpen)active.add('conference_level2');for(const portal of this.data.portals)if(this.flags.has('visited_'+portal.zone))active.add(portal.zone);
    let changed=true;while(changed){changed=false;for(const [a,b,flag]of this.data.connections)if(this.flags.has(flag)){if(active.has(a)&&!active.has(b)){active.add(b);changed=true;}if(active.has(b)&&!active.has(a)){active.add(a);changed=true;}}}return active;
  }
  get moverTargets(){return this.data.moving.map(m=>m.target);}
  moverOffset(e){const m=this.data.moving.find(m=>m.target===e.targetname);return m?this.offset(m):null;}
  offset(m){const c=this.cars[m.car],open=!c.moving&&(m.role==='outer'?c.stop===m.stop:true),v=m.vector;return [open?v[0]:0,open?v[1]:0,(m.role==='outer'?0:c.z)+(open?v[2]:0)];}
  syncInteractions(){for(const e of this.game.interactions)if(e.targetname==='five_elevator_buy'){e.position=e.fiveHome.map((v,k)=>v+(k===2?this.cars[e.fiveCar].z:0));}}
  visible(e){if(/^elevator[12]_call_box$/.test(e.targetname)){const c=this.cars[e.targetname.slice(0,9)],stop=e.script_noteworthy.endsWith('_down')?'down':'up';return c.moving||c.stop!==stop;}
    if(e.fiveDefcon!=null)return !this.switches.includes(e.fiveDefcon);if(e.fiveTrapPart!=null)return !this.trapParts.includes(e.fiveTrapPart);if(e.targetname==='zombie_vending_upgrade')return this.papOpen||!!this.pap;
    if(e.targetname==='pack_room_door')return false;if(e.targetname==='treasure_chest_use'&&this.game.powerup.fire_sale)return true;return super.visible(e);}
  prompt(e,key){
    if(e.fiveDefcon!=null)return !this.power?'You must turn on the power first':key+' · Raise DEFCON';
    if(e.targetname==='five_elevator_buy')return this.thiefRound?'Elevator disabled during the Pentagon Thief round':this.cars[e.fiveCar].moving?'Elevator moving…':key+' · Use elevator · 250 points';
    if(/^elevator[12]_call_box$/.test(e.targetname)){const c=this.cars[e.targetname.slice(0,9)],stop=e.script_noteworthy.endsWith('_down')?'down':'up';return this.thiefRound?'Elevator disabled during the Pentagon Thief round':c.moving?'Elevator moving…':c.stop===stop?'The elevator is here':key+' · Call elevator';}
    if(e.fiveTrapPart!=null)return this.trapCarry!=null?'Already carrying a trap part':key+' · Pick up trap part';
    if(e.fiveTrap)return !this.power?'You must turn on the power first':!this.traps[e.fiveTrap]?.installed?(this.trapCarry!=null?key+' · Repair electric trap':'Find the missing trap part'):key+' · Activate electric trap · 1000 points';
    if(e.targetname==='zombie_vending_upgrade'&&!this.papOpen&&!this.pap)return 'Raise DEFCON to 5 to reach Pack-a-Punch';return super.prompt(e,key);
  }
  use(e){const g=this.game;
    if(e.targetname==='use_power_switch'){const off=!this.power;super.use(e);if(off){this.nextThiefRound=g.round+random(1,4);g.emit('sound',{alias:'zmb_vox_pentann_poweron'});}return true;}
    if(e.fiveDefcon!=null){if(this.power&&!this.switches.includes(e.fiveDefcon)){this.switches.push(e.fiveDefcon);this.defcon=1+this.switches.length;g.emit('sound',{alias:'zmb_defcon_switch',position:e.position});g.message('DEFCON '+this.defcon);if(this.defcon===5)g.message('DEFCON 5 · all teleporters lead to Pack-a-Punch');}return true;}
    if(e.targetname==='five_elevator_buy'){this.ride(e.fiveCar);return true;}
    if(/^elevator[12]_call_box$/.test(e.targetname)){const name=e.targetname.slice(0,9),stop=e.script_noteworthy.endsWith('_down')?'down':'up';this.call(name,stop);return true;}
    if(e.fiveTrapPart!=null){if(this.trapCarry==null&&!this.trapParts.includes(e.fiveTrapPart)){this.trapParts.push(e.fiveTrapPart);this.trapCarry=e.fiveTrapPart;g.message('Trap part collected');}return true;}
    if(e.fiveTrap){const t=this.traps[e.fiveTrap]??={installed:false,until:0,ready:0};if(!t.installed){if(this.trapCarry!=null){t.installed=true;this.trapCarry=null;g.message('Electric trap repaired');}}else if(this.power&&g.time>=t.ready&&g.spendPoints(1000)){t.until=g.time+30;t.ready=t.until+60;g.emit('sound',{alias:'zmb_zapper_on',position:e.position});}return true;}
    if(e.targetname==='zombie_vending_upgrade'&&!(this.papOpen||this.pap))return true;
    if(e.targetname==='zombie_vending_upgrade'&&g.powerup.bonfire_sale&&!this.pap){const spend=g.spendPoints;g.spendPoints=amount=>spend.call(g,amount===5000?1000:amount);try{return super.use(e);}finally{g.spendPoints=spend;}}
    return super.use(e);
  }
  ride(name){const g=this.game,d=this.data.elevators.find(c=>c.name===name),c=this.cars[name];if(c.moving||this.thiefRound||!inside(g.player.position.map((v,k)=>v+(k===2?35:0)),c.stop==='up'?d.upVolume:d.downVolume))return false;
    if(!g.spendPoints(250))return false;return this.moveCar(name,c.stop==='up'?'down':'up',false);
  }
  call(name,stop){const c=this.cars[name];if(this.thiefRound||c.moving||c.stop===stop)return false;return this.moveCar(name,stop,true);}
  moveCar(name,stop,called){const g=this.game,d=this.data.elevators.find(c=>c.name===name),c=this.cars[name];
    c.riders=(g.coop?.playerPositions()||[g.player.position]).map((p,i)=>inside(p.map((v,k)=>v+(k===2?35:0)),c.stop==='up'?d.upVolume:d.downVolume)?i:-1).filter(i=>i>=0);
    Object.assign(c,{from:c.z,to:stop==='down'?-d.drop:0,started:g.time,moving:true,called,target:stop});
    g.emit('sound',{alias:name==='elevator1'?'evt_elevator_freight_door_close':'evt_elevator_office_door_close',position:d.origin});
    g.emit('loop',{id:'five_'+name,alias:name==='elevator1'?'evt_elevator_freight_run_3d':'evt_elevator_office_run_3d',position:d.origin,near:160,far:700});g.message('Elevator travelling');return true;
  }
  get spawnPaused(){return Object.values(this.cars).some(c=>c.moving&&c.riders.includes(0));}
  get rider(){return Object.values(this.cars).find(c=>c.moving&&c.riders.includes(0));}
  tick(){const g=this.game;super.tick();
    for(const d of this.data.elevators){const c=this.cars[d.name];if(!c.moving)continue;const f=Math.min(1,(g.time-c.started)/d.travel),z=c.from+(c.to-c.from)*f,dz=z-c.z;c.z=z;
      if(c.riders.includes(0)){g.player.position[2]+=dz;g.player.previousPosition[2]+=dz;g.player.velocityZ=0;g.player.grounded=true;}
      if(f===1){c.moving=false;c.stop=c.target;delete c.target;c.visited=true;c.riders=[];g.emit('stopLoop',{id:'five_'+d.name});if(d.name==='elevator1'){this.flags.add('labs_enabled');}else this.flags.add('war_room_start');
        g.emit('sound',{alias:'zmb_vox_pentann_level_'+(d.name==='elevator2'?(c.stop==='up'?1:2):(c.stop==='up'?2:3))});
        g.emit('sound',{alias:d.name==='elevator1'?'evt_elevator_freight_door_open':'evt_elevator_office_door_open_1',position:d.origin.map((v,k)=>v+(k===2?z:0))});g.message(d.name==='elevator2'?(c.stop==='down'?'War Room':'Offices'):(c.stop==='down'?'Laboratories':'War Room'));this.relocateZombies(d,c.stop);}}
    this.syncInteractions();
    if(this.portalDue&&g.time>=this.portalDue){this.portalDue=0;this.portal(this.portalDestination);}
    if(this.power&&!this.portalDue&&g.time>=this.portalReady){const at=g.player.position.map((v,k)=>v+(k===2?35:0)),source=this.data.portals.find(p=>inside(at,p.hulls));if(source){let dest;
        if(this.defcon===5&&source.zone!=='conference_level2')dest=this.data.portals.find(p=>p.zone==='conference_level2');else{const allowed=this.activeZones(),rows=this.data.portals.filter(p=>p.index!==source.index&&p.zone!==source.zone&&p.zone!=='conference_level2'&&allowed.has(p.zone));dest=rows[random(0,rows.length)];}
        if(dest){this.portalDestination=dest.index;this.portalDue=g.time+.5;this.portalReady=g.time+20;g.emit('sound',{alias:'evt_teleporter'});}}}
    if(this.defconStarted){this.defcon=Math.max(1,5-Math.floor((g.time-this.defconStarted)/7.5));if(this.defcon===1){this.defconStarted=0;this.switches=[];}}
    if(this.papOpen&&g.time>=this.papUntil&&!this.pap){this.papOpen=false;this.flags.delete('open_pack_hideaway');for(const t of this.data.papBlockers)g.collision.disabled.delete(t);g.invalidateNavigation(this.data.papBlockers);}
    // On DEFCON reset the room's exit stays open while somebody is inside.
    const door=this.data.papBlockers[1],room=inside(g.player.position.map((v,k)=>v+(k===2?35:0)),this.data.papVolume);
    if(room&&!g.collision.disabled.has(door)){g.collision.disabled.add(door);g.invalidateNavigation([door]);}
    for(const e of g.enemies){if(e.dead)continue;if(e.frozenUntil&&g.time>=e.frozenUntil){e.frozenUntil=0;e.speed=e.unfrozenSpeed;}
      for(const [name,t]of Object.entries(this.traps))if(g.time<t.until){const switchAt=g.interactions.find(v=>v.fiveTrap===name)?.position;if(switchAt&&dist(e.position,switchAt)<100)g.hitEnemy(e,e.health);}}
    this.lastTime=g.time;
  }
  portal(index){const g=this.game,d=this.data.portals[index];if(!d)return;
    const at=g.settleFeet(d.destination.map((v,k)=>v+(k===2?8:0)));Object.assign(g.player,{position:at,previousPosition:at.slice(),grounded:true,velocityZ:0});g.targetNodeDue=0;g.spawnDistanceCache=null;this.flags.add('visited_'+d.zone);g.yaw=d.yaw*Math.PI/180;g.emit('fiveTeleport',{yaw:g.yaw});
    if(d.zone==='conference_level2'&&this.defcon===5){if(!this.defconStarted)this.defconStarted=g.time;this.papOpen=true;this.papUntil=g.time+70;this.flags.add('open_pack_hideaway');for(const t of this.data.papBlockers)g.collision.disabled.add(t);g.invalidateNavigation(this.data.papBlockers);g.message('Pack-a-Punch · DEFCON countdown');}
    this.relocateZombies(null,d.zone);
  }
  // The native scripts recycle enemies stranded on empty floors after travel.
  relocateZombies(d,stop){const g=this.game,feet=g.player.position,rows=d?.zombieStops[stop]||this.data.portals.filter(p=>p.zone===stop).map(p=>p.destination);
    const candidates=rows.map(p=>g.settleActor(p)).filter(Boolean).filter(p=>dist(p,feet)>160);if(!candidates.length)return;
    for(const e of g.enemies)if(!e.dead&&Math.abs(e.position[2]-feet[2])>150&&e.kind!=='thief'){const at=candidates[random(0,candidates.length)].slice();Object.assign(e,{position:at,previousPosition:at.slice(),path:[],stage:'hunt',window:null,navDue:0});}
  }
  boxCost(e){return this.game.powerup.fire_sale?10:Number(e.zombie_cost)||950;}
  saveState(){return {...super.saveState(),cars:this.cars,switches:this.switches,defcon:this.defcon,defconStarted:this.defconStarted,papUntil:this.papUntil,papOpen:this.papOpen,portalReady:this.portalReady,portalDue:this.portalDue,portalDestination:this.portalDestination,nextThiefRound:this.nextThiefRound,thiefRound:this.thiefRound,thiefReward:this.thiefReward,thiefStole:this.thiefStole,trapParts:this.trapParts,trapCarry:this.trapCarry,traps:this.traps};}
  loadState(s){super.loadState(s);for(const k of ['cars','switches','defcon','defconStarted','papUntil','papOpen','portalReady','portalDue','portalDestination','nextThiefRound','thiefRound','thiefReward','thiefStole','trapParts','trapCarry','traps'])if(s[k]!==undefined)this[k]=s[k];this.syncInteractions();}
  coopState(){return this.saveState();}applyCoopState(s){if(s)this.loadState(s);}
}

export class FiveEngine extends BlackOpsEngine {
  constructor(m,c,paths,events={},p={}){super(m,c,paths,events,p,g=>new FiveRules(g));this.engine='black-ops-t5-five';this.mapRules.installInteractions();
    const trace=c.trace.bind(c);c.trace=(a,b,half=[0,0,0],mask=c.mask,tiny=false)=>{let out=trace(a,b,half,mask,tiny);for(const m of this.data.map.moving){if(!m.hulls.length)continue;const o=this.mapRules.offset(m);for(const h of m.hulls)if(h.contents&mask)out=movingHullTrace(h,o,a,b,half,out);}return out;};
  }
  settleActor(at){return this.collision.actor(()=>{const a=[at[0],at[1],at[2]+80],f=this.collision.trace(a,[a[0],a[1],a[2]-200],[14,14,35]);return f.fraction<1&&!f.allSolid&&f.normal[2]>.65?[f.end[0],f.end[1],f.end[2]-35]:null;});}
  walkableLink(a,b,navigation=false){if(!super.walkableLink(a,b,navigation))return false;if(navigation)return true;
    // Five's chairs/table edges can clear the shared raised step probe while
    // trapping a slow walker underneath. Only shortcut across a clear hull;
    // the prepared graph still carries physically walked stair connections.
    return this.collision.trace(a.map((v,k)=>v+(k===2?35:0)),b.map((v,k)=>v+(k===2?35:0)),[14,14,35],1|0x20000).fraction>=.98;
  }
  movePlayerOverride(){return !!this.mapRules.rider;}
  startRound(){super.startRound();const r=this.mapRules;r.thiefRound=!!r.power&&this.round>=r.nextThiefRound;
    if(r.thiefRound){this.remaining=1;r.thiefReward=false;r.thiefStole=false;r.nextThiefRound=this.round+random(4,6);this.message('Pentagon Thief');this.emit('sound',{alias:'evt_thief_alarm_single'});}}
  maxAlive(){return this.mapRules.thiefRound?1:super.maxAlive();}
  spawnEnemy(){const r=this.mapRules;if(r.thiefRound){if(this.enemies.some(e=>!e.dead&&e.kind==='thief'))return;const portals=r.data.portals.filter(p=>r.activeZones().has(p.zone)&&Math.abs(p.destination[2]-this.player.position[2])<120&&dist(p.destination,this.player.position)>250);
      const spots=[...portals.map(p=>p.destination),r.data.thiefSpawn],at=spots.map(p=>this.settleActor(p)).find(p=>p&&(this.walkableLink(p,this.player.position)||this.path(p,this.player.position,true).length));if(!at)return;
      const players=this.coop?.playerCount()||1,scale=[0,.3,.6,.8,1][players],e={id:this.nextId++,kind:'thief',position:at,previousPosition:at.slice(),health:Math.min(60000,this.round*2000)*scale,stage:'hunt',path:[],attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:this.time,gait:'ai_zombie_walk_v1',speed:100,ignoreNuke:true,ignoreInstaKill:true,stolen:null};
      this.enemies.push(e);this.remaining--;this.emit('spawn',e);return;}
    const count=this.enemies.length;super.spawnEnemy();const e=this.enemies[count];if(e&&r.power&&this.round>=6&&Math.random()<.16){e.kind='crawler';e.gait='ai_zombie_quad_crawl';e.speed=35;this.emit('removeEnemy',e);this.emit('spawn',e);}else if(e&&e.position[2]<-600){e.kind='scientist';this.emit('removeEnemy',e);this.emit('spawn',e);}}
  tickEnemy(e,dt){if(e.dead)return;
    if(e.stage==='hunt'&&this.time>=(e.fiveResolveDue||0)){e.fiveResolveDue=this.time+.25;this.resolveActorOverlap(e);}
    if(e.frozenUntil>this.time){e.age+=dt;return;}
    if(e.kind==='thief'){e.age+=dt;const r=this.mapRules;if(!e.stolen){if(this.time>=e.navDue){e.path=this.path(e.position,this.player.position,true);e.navDue=this.time+.5;}this.advancePath(e,dt,this.player.position);
        if(dist(e.position,this.player.position)<64&&!this.gesture){const w=this.weapon;e.stolen={name:w.name,clip:w.clip,reserve:w.reserve};this.inventory.splice(this.slot,1);if(!this.inventory.length)this.inventory.push(this.makeWeapon(this.data.startWeapon));this.slot=0;this.reloadEnd=0;this.switching=null;this.pendingFire=false;this.emit('weapon',this.weapon);r.thiefStole=true;e.speed=240;e.gait='ai_zombie_sprint_v1';e.escapeAt=this.time+25;
          const exits=r.data.portals.filter(p=>r.activeZones().has(p.zone)&&Math.abs(p.destination[2]-e.position[2])<130).sort((a,b)=>dist(b.destination,this.player.position)-dist(a.destination,this.player.position));e.exit=exits[0]?.destination||r.data.thiefSpawn;this.message('The Pentagon Thief stole '+this.weaponName(w.name)+'!');}}
      else{if(this.time>=e.navDue){e.path=this.path(e.position,e.exit,true);e.navDue=this.time+1;}this.advancePath(e,dt,e.exit);if(dist(e.position,e.exit)<55||this.time>=e.escapeAt){e.dead=true;e.deathTime=this.time;this.emit('removeEnemy',e);this.addDrop('full_ammo',this.player.position.slice());r.thiefReward=true;this.message('The Pentagon Thief escaped');}}return;}
    // Keep a valid route while its player target stays nearby. Refreshing
    // from the nearest node midway round a chair repeatedly sent a walker
    // back to that node before it could finish the next leg.
    if(e.stage==='hunt'&&e.path?.length&&dist(e.path.at(-1),this.player.position)<48&&this.time>=e.navDue)e.navDue=this.time+1.25;
    return super.tickEnemy(e,dt);
  }
  resolveActorOverlap(e){return this.collision.actor(()=>{const feet=e.position,center=feet.map((v,k)=>v+(k===2?35:0));
    if(!this.collision.trace(center,center,[14,14,35]).allSolid)return;
    // Resolve only an existing overlap, by the smallest same-floor offset.
    // This can occur when a native bevel and crowd separation meet a chair.
    for(const radius of [1,2,4,8,12,16,24])for(let i=0;i<16;i++){const a=i*Math.PI/8,candidate=[feet[0]+Math.cos(a)*radius,feet[1]+Math.sin(a)*radius,feet[2]],at=candidate.map((v,k)=>v+(k===2?35:0));
      if(this.collision.trace(at,at,[14,14,35]).allSolid)continue;const floor=this.collision.move(candidate.map((v,k)=>v+(k===2?2:0)),[0,0,-6]);
      if(!floor.grounded||Math.abs(floor.position[2]-feet[2])>4)continue;e.position=floor.position;e.velocityZ=0;e.path=[];e.navDue=0;e.clear=false;e.blocked=2;return;}
  });}
  hitEnemy(e,damage,head=false,melee=false){if(this.freezeShot&&!melee)return;const alive=!e.dead;super.hitEnemy(e,damage,head,melee);if(!alive||!e.dead)return;
    if(e.kind==='thief'){if(e.stolen){const w=e.stolen;this.giveWeapon(w.name);Object.assign(this.weapon,{clip:w.clip,reserve:w.reserve});this.message('Stolen weapon recovered');}this.addDrop('full_ammo',e.position.slice());this.addDrop(e.stolen?'fire_sale':'bonfire_sale',e.position.slice());this.mapRules.thiefReward=true;}
    if(e.kind==='crawler'){this.emit('effect',{name:'explosions/grenadeexp_concrete',position:e.position,duration:1});for(const other of this.enemies)if(other!==e&&!other.dead&&dist(e.position,other.position)<160)this.hitEnemy(other,Math.max(0,1000*(1-dist(e.position,other.position)/160)));if(dist(this.player.position,e.position)<120)this.damagePlayer(20);}
  }
  fire(){if(!this.weapon.name.startsWith('freezegun'))return super.fire();this.freezeShot=true;let fired;try{fired=super.fire();}finally{this.freezeShot=false;}if(!fired)return false;
    const up=this.weapon.name.includes('upgraded'),suffix=up?'_upgraded':'',v=this.data.map.freeze,range=v['freezegun_outer_range'+suffix],radius=v['freezegun_cylinder_radius'+suffix],inner=v['freezegun_inner_range'+suffix];
    const eye=this.player.position.map((x,k)=>x+(k===2?this.viewHeight:0)),dir=[Math.cos(this.yaw)*Math.cos(this.pitch),Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch)];
    for(const e of this.enemies){if(e.dead)continue;const center=e.position.map((x,k)=>x+(k===2?35:0)),d=center.map((x,k)=>x-eye[k]),along=d.reduce((a,x,k)=>a+x*dir[k],0);
      if(along<0||along>range||Math.hypot(...d.map((x,k)=>x-along*dir[k]))>radius||this.collision.trace(eye,center,[0,0,0],1).fraction<.98)continue;
      const t=Math.max(0,Math.min(1,(along-inner)/(range-inner))),near=v['freezegun_inner_damage'+suffix],far=v['freezegun_outer_damage'+suffix];this.hitEnemy(e,near+(far-near)*t);if(!e.dead&&e.kind!=='thief'){e.unfrozenSpeed??=e.speed;e.speed=0;e.frozenUntil=this.time+4;}this.emit('effect',{name:'weapon/freeze_gun/fx_freezegun_smoke_cloud',position:center,duration:1});}
    return true;
  }
  pickup(d){if(['bonfire_sale','fire_sale'].includes(d.type)){d.used=true;this.emit('stopLoop',{id:'drop'+d.id});this.emit('pickup',d);this.powerup[d.type]=this.time+30;if(d.type==='bonfire_sale'){const r=this.mapRules;r.defcon=5;r.switches=[0,1,2,3];r.defconStarted=0;r.papOpen=true;r.papUntil=this.time+70;for(const t of r.data.papBlockers)this.collision.disabled.add(t);this.invalidateNavigation(r.data.papBlockers);}this.message(d.type==='bonfire_sale'?'Bonfire Sale · Pack-a-Punch 1000 points':'Fire Sale · Mystery Box 10 points');return;}return super.pickup(d);}
  canSave(){return !this.mapRules.portalDue&&super.canSave();}
}

// Sweep a player/actor hull against the moving native brush planes. The
// static collision grid retains the shaft and excludes these original poses.
export function movingHullTrace(h,o,start,end,half,result){
  if(h.mins.some((v,k)=>v+o[k]>Math.max(start[k],end[k])+half[k])||h.maxs.some((v,k)=>v+o[k]<Math.min(start[k],end[k])-half[k]))return result;
  const planes=[...h.planes];for(let k=0;k<3;k++){const a=[0,0,0,h.maxs[k]],b=[0,0,0,-h.mins[k]];a[k]=1;b[k]=-1;planes.push(a,b);}
  let enter=-1,leave=1,hit=null,outside=false,endOutside=false,closest=-Infinity,face=null;
  for(const p of planes){const support=p.slice(0,3).reduce((v,n,k)=>v+Math.abs(n)*half[k],0),d=p[3]+p.slice(0,3).reduce((v,n,k)=>v+n*o[k],0),a=p.slice(0,3).reduce((v,n,k)=>v+n*start[k],0)-d-support,b=p.slice(0,3).reduce((v,n,k)=>v+n*end[k],0)-d-support;
    if(a>closest){closest=a;face=p.slice(0,3);}if(a>0)outside=true;if(b>0)endOutside=true;if(a>0&&b>=a)return result;if(a<=0&&b<=0)continue;
    if(a>b){const t=(a-.03)/(a-b);if(t>enter){enter=t;hit=p.slice(0,3);}}else leave=Math.min(leave,(a+.03)/(a-b));if(enter>leave)return result;}
  if(!outside){if(!endOutside&&closest<-.06)return {...result,fraction:0,end:start.slice(),allSolid:true,solid:true};if(!endOutside&&face.reduce((v,n,k)=>v+n*(end[k]-start[k]),0)<-1e-9)return {...result,fraction:0,end:start.slice(),normal:face,solid:true};return result;}
  if(enter>=-1e-6&&enter<result.fraction&&hit){const fraction=Math.max(0,enter);return {...result,fraction,end:start.map((v,k)=>v+(end[k]-v)*fraction),normal:hit};}return result;
}
