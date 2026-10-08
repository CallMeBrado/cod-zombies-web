import {BlackOpsEngine,KinoRules} from './bo1-engine.js';
import {PERKS} from './map-rules.js';
import {gaitSpeed} from './game.js';
import {inMoonHulls} from './bo1-moon.js';
const dist=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k])),pick=a=>a[Math.floor(Math.random()*a.length)],rnd=(a,b)=>a+Math.floor(Math.random()*(b-a));
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=rnd(0,i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
const vec=e=>String(e.origin||'0 0 0').split(/\s+/).map(Number);
export function routeLength(path){return path.slice(1).reduce((v,p,i)=>v+dist(path[i].position,p.position),0);}
export function sampleTempleRoute(path,t){const total=routeLength(path);let left=Math.max(0,Math.min(1,t))*total;
  for(let i=1;i<path.length;i++){const a=path[i-1].position,b=path[i].position,d=dist(a,b);if(left<=d||i===path.length-1){const f=d?Math.min(1,left/d):0;return {position:a.map((v,k)=>v+(b[k]-v)*f),yaw:Math.atan2(b[1]-a[1],b[0]-a[0])};}left-=d;}return {position:path[0].position.slice(),yaw:0};}

export class ShangriRules extends KinoRules {
  constructor(g){super(g);g.interactions.push(...g.entities.filter(e=>['minecart_lever_trigger','waterslide_message_trigger'].includes(e.targetname)).map(e=>({...e,position:vec(e)})));}
  reset(){super.reset();this.switches={};this.switchDue=0;this.papUntil=0;this.papOpened=0;this.plateOrder=shuffle([1,2,3,4]);this.plateTouched=[];
    this.placements={};let remaining=Object.keys(PERKS).filter(n=>n!=='specialty_quickrevive');
    for(const slot of this.data.perkSlots.slice().sort((a,b)=>a.allowed.length-b.allowed.length)){const id=pick(slot.allowed.filter(n=>remaining.includes(n)));this.placements[slot.index]=id;remaining=remaining.filter(n=>n!==id);}
    this.cart=null;this.cartReady=0;this.transport=null;this.slideReady=0;this.nextNapalm=rnd(5,8);this.nextSonic=rnd(4,8);this.specialRound=0;this.roundTotal=0;this.fires=[];this.sonicUntil=0;this.monkeyDue=0;
    const boxes=this.game.interactions.filter(e=>e.targetname==='treasure_chest_use'&&e.start_exclude!=='1');if(boxes.length)this.game.activeBox=pick(boxes).target;
  }
  perkEntity(e){return e.templePerkSlot==null?e:{...e,script_noteworthy:this.placements[e.templePerkSlot]};}
  visible(e){if(e.templeSwitch)return !this.switches[e.templeSwitch];if(e.targetname==='zombie_vending')return super.visible(this.perkEntity(e));return super.visible(e);}
  prompt(e,key){if(e.templeSwitch)return key+' · Release '+e.templeSwitch+' water wheel';
    if(e.targetname==='minecart_lever_trigger')return !this.power?'You must turn on the power first':this.game.time<this.cartReady?'Minecart returning':key+' · Ride minecart · 250 points';
    if(e.targetname==='waterslide_message_trigger')return this.slideOpen?key+' · Water slide':'Open the lower route and turn on the power';
    if(e.targetname==='zombie_vending_upgrade'&&!this.papAvailable&&!this.pap)return 'Stand on the pressure plate marked for '+(this.game.coop?.playerCount()||1)+' player(s)';
    return super.prompt(e.targetname==='zombie_vending'?this.perkEntity(e):e,key);}
  get papAvailable(){return this.power&&this.game.time<this.papUntil;}
  get slideOpen(){return this.power&&(this.flags.has('cave01_to_cave02')||this.flags.has('pressure_to_cave01'));}
  use(e){const g=this.game;
    if(e.templeSwitch){if(!this.switches[e.templeSwitch]){this.switches[e.templeSwitch]=g.time+.5;this.flags.add(e.templeSwitch+'_switch_pulled');g.emit('sound',{alias:'switch_flip'});g.message('Water wheel released · '+Object.keys(this.switches).length+'/2');if(Object.keys(this.switches).length===2)this.switchDue=g.time+1.5;}return true;}
    if(e.targetname==='zombie_vending'){if(this.perks.size>=4&&!this.perks.has(this.perkEntity(e).script_noteworthy)){g.message('Four perks already purchased');return true;}return super.use(this.perkEntity(e));}
    if(e.targetname==='zombie_vending_upgrade'&&!this.papAvailable&&!this.pap){g.message('Pack-a-Punch stairs are closed');return true;}
    if(e.targetname==='minecart_lever_trigger'){if(this.power&&g.time>=this.cartReady&&!this.transport&&!g.gesture&&g.spendPoints(250))this.rideCart();return true;}
    if(e.targetname==='waterslide_message_trigger'){if(this.slideOpen)this.rideSlide();return true;}
    return super.use(e);
  }
  setPap(open){const g=this.game;for(const t of this.data.papBlockers)if(open)g.collision.disabled.add(t);else g.collision.disabled.delete(t);
    for(const t of this.data.papFloor)if(open)g.collision.disabled.delete(t);else g.collision.disabled.add(t);g.invalidateNavigation([...this.data.papBlockers,...this.data.papFloor]);}
  openPap(){const g=this.game;this.papOpened=g.time;this.papUntil=g.time+60;this.setPap(true);g.emit('sound',{alias:'evt_pap_timer_start'});g.message('Pack-a-Punch open · 60 seconds');}
  rideCart(){const g=this.game,path=this.data.minecart.path,duration=Math.max(6,routeLength(path)/450);if(path.length<2)return;
    this.cart={started:g.time,duration,returnAt:g.time+duration+5};this.cartReady=g.time+duration*2+6;this.transport={kind:'cart',started:g.time,duration,path,offset:24};g.changeStance('stand');g.emit('loop',{id:'temple-cart',alias:'evt_minecart_climb_loop'});g.message('Minecart departing');}
  rideSlide(){const g=this.game;if(g.time<this.slideReady||this.transport||g.dive||g.pendingGrenade)return;const path=this.data.slide.path;
    if(path.length<2)return;this.transport={kind:'slide',started:g.time,duration:Math.max(3,routeLength(path)/450),path,offset:0};g.changeStance('crouch');g.emit('sound',{alias:'amb_waterslide01'});}
  moveTransport(){const g=this.game,t=this.transport;if(!t)return;const f=Math.min(1,(g.time-t.started)/t.duration),s=sampleTempleRoute(t.path,f),at=s.position.slice();at[2]+=t.offset;Object.assign(g.player,{position:at,previousPosition:at.slice(),grounded:false,velocityZ:0});
    if(t.yaw!=null)g.emit('templeView',{delta:Math.atan2(Math.sin(s.yaw-t.yaw),Math.cos(s.yaw-t.yaw))});t.yaw=s.yaw;
    if(f===1){this.transport=null;this.slideReady=g.time+1;g.emit('stopLoop',{id:'temple-cart'});try{const feet=g.settleFeet(at);Object.assign(g.player,{position:feet,previousPosition:feet.slice(),grounded:true});}catch{g.player.grounded=false;}g.changeStance('stand');g.message(t.kind==='cart'?'Minecart arrived':'Slide completed');}}
  tick(){const g=this.game;super.tick();if(['ready','dead'].includes(g.phase))return;
    if(this.switchDue&&g.time>=this.switchDue&&!this.power){this.switchDue=0;super.use({targetname:'use_power_switch'});}
    if(this.slideOpen&&!g.collision.disabled.has(this.data.slide.blocker)){g.collision.disabled.add(this.data.slide.blocker);g.invalidateNavigation([this.data.slide.blocker]);}
    if(this.power&&!this.papAvailable&&!this.papUntil&&!this.transport){const points=g.coop?.playerPositions()||[g.player.position],count=g.coop?.playerCount()||1;
      this.plateTouched=this.data.plates.filter((p,i)=>this.plateOrder[i]<=count&&points.some(at=>p.hulls.some(h=>at[2]<=h.maxs[2]&&at[2]+30>=h.mins[2]&&inMoonHulls([at[0],at[1],Math.max(at[2],h.mins[2]+.01)],[h])))).map(p=>p.index);
      if(this.plateTouched.length>=count)this.openPap();}
    if(this.papUntil&&g.time>=this.papUntil){this.papUntil=0;this.setPap(false);this.plateOrder=shuffle([1,2,3,4]);g.message('Pack-a-Punch stairs closing');
      if(g.player.position[1]>200&&Math.abs(g.player.position[0])<160&&g.player.position[2]>100){const feet=g.settleFeet(this.data.plates[0].position);Object.assign(g.player,{position:feet,previousPosition:feet.slice(),velocityZ:0,grounded:true});}}
    if(!this.transport&&this.slideOpen&&g.time>=this.slideReady&&inMoonHulls([g.player.position[0],g.player.position[1],g.player.position[2]+25],this.data.slide.hulls))this.rideSlide();
    this.moveTransport();
    for(const e of g.enemies){if(e.dead||!e.shrunkUntil)continue;if(g.time>=e.shrunkUntil){e.shrunkUntil=0;e.visualScale=1;e.health=e.originalHealth;e.speed=e.originalSpeed;}
      else if(dist(e.position,g.player.position)<30){g.hitEnemy(e,e.health,false,true);e.gibbed=true;g.emit('effect',{name:'maps/zombie_temple/fx_ztem_zombie_mini_squish',position:e.position,duration:.6});}}
    this.fires=this.fires.filter(f=>g.time<f.until);for(const f of this.fires)if(g.time>=f.next&&dist(f.position,g.player.position)<100&&!this.perks.has('specialty_flakjacket')){f.next=g.time+.5;g.damagePlayer(10);}
    this.tickMonkeys();
  }
  tickMonkeys(){const g=this.game;if(g.mirror)return;const held=new Set(g.enemies.filter(e=>e.kind==='monkey'&&!e.dead).map(e=>e.drop));
    if(g.time>=this.monkeyDue&&g.drops.some(d=>!held.has(d.id))){const drop=g.drops.find(d=>!held.has(d.id));if(g.spawnMonkey(drop))this.monkeyDue=g.time+10;else this.monkeyDue=g.time+2;}
  }
  saveState(){return {...super.saveState(),temple:Object.fromEntries(['switches','switchDue','papUntil','papOpened','plateOrder','plateTouched','placements','cart','cartReady','transport','slideReady','nextNapalm','nextSonic','specialRound','roundTotal','fires','sonicUntil','monkeyDue'].map(k=>[k,this[k]]))};}
  loadState(s){super.loadState(s);Object.assign(this,s.temple||{});this.setPap(this.papAvailable);}
  coopState(){return {placements:this.placements,plateOrder:this.plateOrder,plateTouched:this.plateTouched,papLeft:this.papUntil-this.game.time,switches:this.switches,cart:this.cart};}
  applyCoopState(s){if(!s)return;Object.assign(this,s);this.papUntil=this.game.time+s.papLeft;this.setPap(this.papAvailable);}
}

export class ShangriEngine extends BlackOpsEngine {
  constructor(m,c,paths,events={},p={}){super(m,c,paths,events,p,g=>new ShangriRules(g));this.engine='black-ops-t5-shangri-la';
    for(const marker of m.map.exteriorRisers||[]){const window=this.windows.find(w=>w.target===marker.window),node=this.nodes[marker.node];if(!window||!node)continue;
      const group=this.mapRules.group(window),template=this.spawnEntities.find(e=>e.targetname===group);if(template)this.spawnEntities.push({...template,origin:node.origin.join(' '),script_string:'zombie_riser'});}
  }
  startRound(){super.startRound();this.mapRules.roundTotal=this.remaining;this.mapRules.specialRound=0;}
  movePlayerOverride(p,input,dt){if(this.mapRules.transport)return true;return super.movePlayerOverride(p,input,dt);}
  settleActor(at){return this.collision.actor(()=>{const start=[at[0],at[1],at[2]+80],f=this.collision.trace(start,[start[0],start[1],start[2]-240],[14,14,35]);return f.fraction<1&&!f.allSolid&&f.normal[2]>.65?[f.end[0],f.end[1],f.end[2]-35]:null;});}
  spawnEnemy(){const r=this.mapRules;
    if(!r.specialRound&&this.remaining<r.roundTotal*.5){const kind=this.round>=r.nextNapalm?'napalm':this.round>=r.nextSonic?'sonic':null;if(kind&&this.spawnSpecial(kind)){r.specialRound=this.round;return;}}
    super.spawnEnemy();}
  spawnSpecial(kind){const r=this.mapRules;if(this.enemies.some(e=>!e.dead&&e.kind===kind))return false;
    const points=r.data.specials.slice().sort((a,b)=>dist(a.position,this.player.position)-dist(b.position,this.player.position));
    for(const marker of points){const at=this.settleActor(marker.position);if(!at||dist(at,this.player.position)<170||!(this.walkableLink(at,this.player.position)||this.path(at,this.player.position,true).length))continue;
      const gait=kind==='napalm'?'ai_zombie_napalm_run_01':'ai_zombie_sonic_run_01',e={id:this.nextId++,kind,position:at,previousPosition:at.slice(),health:this.zombieHealth*(kind==='napalm'?4*(this.coop?.playerCount()||1):2.5),window:this.windows[0],stage:'rise',...this.riseClip({name:gait}),gait,speed:gaitSpeed(this.presentation.animations[gait]),attackDue:0,navDue:0,path:[],angle:0,age:0,spawnTime:this.time,dead:false};
      if(kind==='napalm')e.ignoreNuke=true;else e.screamDue=0;this.enemies.push(e);this.remaining--;this.emit('spawn',e);this.emit('sound',{alias:kind==='napalm'?'evt_napalm_zombie_spawn':'evt_sonic_spawn',position:at});return true;}
    return false;
  }
  spawnMonkey(drop){if(this.enemies.filter(e=>e.kind==='monkey'&&!e.dead).length>=3)return false;
    const markers=this.mapRules.data.monkeySpawns.slice().sort((a,b)=>dist(a.position,drop.position)-dist(b.position,drop.position));
    for(const marker of markers){const at=this.settleActor(marker.position)||this.settleActor(marker.position.map((v,k)=>v+(k===2?80:0)));if(!at||!(this.walkableLink(at,drop.position)||this.path(at,drop.position,true).length))continue;
      const gait=Object.keys(this.presentation.animations).find(n=>/^ai_zombie_monkey_run_/.test(n));if(!gait)return false;
      const exit=this.mapRules.data.monkeyExits[0]?.position;if(!exit)continue;
      const e={id:this.nextId++,kind:'monkey',ignoreRound:true,position:at,previousPosition:at.slice(),health:150,window:this.windows[0],stage:'hunt',gait,speed:gaitSpeed(this.presentation.animations[gait]),attackDue:0,navDue:0,path:[],angle:0,age:0,spawnTime:this.time,dead:false,drop:drop.id,exit};this.enemies.push(e);this.emit('spawn',e);return true;}
    return false;
  }
  tickEnemy(e,dt){if(e.kind==='monkey'&&!e.dead){e.age+=dt;const d=this.drops.find(d=>d.id===e.drop);if(!d){this.emit('removeEnemy',e);this.enemies=this.enemies.filter(v=>v!==e);return;}
      if(e.escaping){const f=Math.min(1,(this.time-e.escapeAt)/e.escapeDuration);e.position=e.exitFrom.map((v,k)=>v+(e.exit[k]-v)*f);d.position=e.position.map((v,k)=>v+(k===2?24:0));
        if(f===1){this.drops=this.drops.filter(v=>v!==d);this.emit('removeEnemy',e);this.emit('stopLoop',{id:'drop'+d.id});this.enemies=this.enemies.filter(v=>v!==e);}return;}
      const marker=this.mapRules.data.monkeySpawns[0].position,target=e.carrying?(this.settleActor(marker)||this.settleActor(marker.map((v,k)=>v+(k===2?80:0)))):d.position;if(!target)return;
      if(dist(e.position,target)<35){if(!e.carrying){e.carrying=true;e.cycleAt=this.time+.5;}else{e.escaping=true;e.escapeAt=this.time;e.exitFrom=e.position.slice();e.escapeDuration=this.presentation.animations.ai_zombie_monkey_jump_up_pap.duration;e.nativeTraversal={animation:'ai_zombie_monkey_jump_up_pap',started:this.time};return;}}
      if(e.carrying){d.position=e.position.map((v,k)=>v+(k===2?24:0));if(this.time>=e.cycleAt){const types=['full_ammo','insta_kill','double_points','nuke','carpenter'];d.type=types[(types.indexOf(d.type)+1)%types.length];e.cycleAt=this.time+.5;this.emit('templeDropCycle',d);}}
      if(this.time>=e.navDue){e.path=this.path(e.position,target,true);e.navDue=this.time+1;}this.advancePath(e,dt,target);return;}
    if(!e.dead&&!e.shrunkUntil&&e.stage!=='rise'&&e.kind==='napalm'&&dist(e.position,this.player.position)<90){this.hitEnemy(e,e.health);return;}
    if(!e.dead&&!e.shrunkUntil&&e.stage!=='rise'&&e.kind==='sonic'&&dist(e.position,this.player.position)<240&&this.time>=e.screamDue){e.screamDue=this.time+rnd(3,10);this.mapRules.sonicUntil=this.time+2;this.damagePlayer(10);this.emit('sound',{alias:'evt_sonic_buildup',position:e.position});}
    return super.tickEnemy(e,dt);
  }
  hitEnemy(e,damage,head=false,melee=false){if(this.shrinkShot&&!melee)return;
    const alive=!e.dead;super.hitEnemy(e,damage,head,melee);if(!alive||!e.dead)return;
    if(e.kind==='napalm'){const r=this.mapRules;r.nextNapalm=this.round+rnd(1,3);e.gibbed=true;this.emit('sound',{alias:'evt_napalm_zombie_explo',position:e.position});this.emit('effect',{name:'explosions/grenadeexp_concrete',position:e.position,duration:2});r.fires.push({position:e.position.slice(),until:this.time+30,next:this.time});
      const d=dist(e.position,this.player.position),kill=r.perks.has('specialty_armorvest')?90:150;if(d<400&&!r.perks.has('specialty_flakjacket'))this.damagePlayer(d<kill?r.maxHealth*2:50);}
    if(e.kind==='sonic'){this.mapRules.nextSonic=this.round+rnd(1,4);for(const other of this.enemies)if(other!==e&&!other.dead&&other.kind!=='napalm'&&dist(other.position,e.position)<240)this.hitEnemy(other,other.health);}
    if(e.kind==='monkey'&&e.carrying){const d=this.drops.find(d=>d.id===e.drop);if(d){d.position=e.position.slice();d.expires=this.time+30;}this.awardPoints(500);}
  }
  fire(){const shrink=this.weapon.name.startsWith('shrink_ray');if(!shrink)return super.fire();this.shrinkShot=true;let fired;
    try{fired=super.fire();}finally{this.shrinkShot=false;}if(!fired)return false;
    const upgraded=this.weapon.name.includes('upgraded'),range=upgraded?1200:480,radius=upgraded?84:60,eye=this.player.position.map((v,k)=>v+(k===2?this.viewHeight:0)),dir=[Math.cos(this.yaw)*Math.cos(this.pitch),Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch)];
    for(const e of this.enemies){if(e.dead||e.shrunkUntil)continue;const center=e.position.map((v,k)=>v+(k===2?35:0)),d=center.map((v,k)=>v-eye[k]),along=d.reduce((a,v,k)=>a+v*dir[k],0);
      if(along<0||along>range||dist(eye,center)>range||Math.hypot(...d.map((v,k)=>v-along*dir[k]))>radius||this.collision.trace(eye,center,[0,0,0],1).fraction<.98)continue;this.shrinkEnemy(e,upgraded);}
    return true;
  }
  shrinkEnemy(e,upgraded){if(e.dead||e.shrunkUntil)return;if(e.kind==='monkey'){this.hitEnemy(e,e.health);return;}
    const special=e.kind==='napalm'||e.kind==='sonic',duration=special?[.75,1.5,2.5][Math.min(2,e.shrinkCount||0)]:2.5+Math.random()*.5;e.shrinkCount=(e.shrinkCount||0)+1;
    e.originalHealth=e.health;e.originalSpeed=e.speed;e.health=1;e.speed*=.65;e.visualScale=.25;e.shrunkUntil=this.time+duration*(upgraded?2:1)+.5;this.emit('sound',{alias:'evt_shrink',position:e.position});
  }
  damagePlayer(amount,options={}){return super.damagePlayer(options.enemy?.shrunkUntil?5:amount,options);}
}
