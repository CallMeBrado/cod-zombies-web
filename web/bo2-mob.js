// Map state recovered from zm_prison, _zm_afterlife and _zm_ai_brutus.
import {KinoRules} from './bo1-engine.js';
import {NuketownRules} from './bo2-nuketown.js';
import {PERKS} from './map-rules.js';
const pos=e=>e.origin.split(/\s+/).map(Number),dist=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const PERK={...PERKS,specialty_rof:{...PERKS.specialty_rof,name:'Double Tap II'},specialty_grenadepulldeath:{name:'Electric Cherry',cost:2000,sting:'mx_cherry_sting'}};
const clone=v=>structuredClone(v);
const within=(p,h)=>h.mins.every((v,k)=>p[k]>=v-2)&&h.maxs.every((v,k)=>p[k]<=v+2)&&h.planes.every(q=>q[0]*p[0]+q[1]*p[1]+q[2]*p[2]<=q[3]+2);
export class MobRules extends KinoRules {
  reset(){
    super.reset();this.power=true;this.papOn=true;this.souls=this.game.coop?1:3;this.afterlife=null;this.afterlifeDeaths=0;this.afterlifeRound=0;
    this.powered=new Set();this.collected=new Set();this.itemChoices=new Set(Object.values(this.data.parts).map(a=>a[Math.floor(Math.random()*a.length)]));
    this.planeParts=new Set();this.planeBuilt=false;this.bridgeVisits=0;this.fuel=new Set();this.hold=null;this.travel=null;this.shield=0;
    this.seenRound=0;this.refillDue=0;this.seenEnd=0;this.brutusCount=0;this.nextBrutusRound=4+Math.floor(Math.random()*3);this.brutusDue=0;this.locked=new Set();
    this.game.activeBox=Math.random()<.5?'start_chest':'cafe_chest';
    for(const target of this.data.initialDisabled||[])this.game.collision.disabled.add(target);
  }
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  get spawnPaused(){return !!this.afterlife&&this.game.round===0;}
  negotiationLink(a,b,l){return NuketownRules.prototype.negotiationLink.call(this,a,b,l);}
  startTraversal(e){return NuketownRules.prototype.startTraversal.call(this,e);}
  advanceTraversal(e,dt){return NuketownRules.prototype.advanceTraversal.call(this,e,dt);}
  installInteractions(){
    const g=this.game;for(const e of g.entities)if(e.mobItem||e.mobPanel||['afterlife_trigger','plane_craftable_trigger','plane_fly_trigger','plane_fuelable_trigger','gondola_move_trigger','gondola_call_trigger','open_craftable_trigger'].includes(e.targetname)||e.targetname?.startsWith('trigger_electric_chair_')){
      if(!g.interactions.some(x=>x.origin===e.origin&&x.targetname===e.targetname))g.interactions.push({...e,position:pos(e)});
    }
    g.interactions.push({targetname:'mob_revive',position:this.data.corpseStarts[0].slice()});
  }
  enterAfterlife(initial=false,keepPerks=true){
    const g=this.game;if(this.afterlife||this.souls<=0)return false;
    this.souls--;if(this.afterlifeRound!==g.round){this.afterlifeRound=g.round;this.afterlifeDeaths=0;}this.afterlifeDeaths++;
    const at=initial?this.data.corpseStarts[g.character||0]:g.player.position;
    this.afterlife={started:g.time,mana:200,body:g.settleFeet([at[0],at[1],at[2]+48]),keepPerks,inventory:g.inventory.map(w=>({name:w.name,clip:w.clip,reserve:w.reserve,raised:w.raised})),slot:g.slot,grenades:g.player.grenades};
    if(!keepPerks)this.perks.clear();
    g.inventory=[g.makeWeapon('lightning_hands_zm')];g.slot=0;g.player.health=this.maxHealth;g.reloadEnd=0;g.gesture=null;g.switching=null;g.pendingFire=false;g.pendingGrenade=null;g.meleeDue=0;
    const body=g.interactions.find(e=>e.targetname==='mob_revive');if(body)body.position=[...this.afterlife.body.slice(0,2),this.afterlife.body[2]+25];
    for(const target of this.data.afterlifeDoors||[])g.collision.disabled.add(target);
    g.emit('weapon',g.weapon);g.emit('sound',{alias:'zmb_afterlife_trigger_activate'});g.emit('mobAfterlife',true);
    g.message('Afterlife · Fire to shock panels. Return to your body and hold Use to revive.');return true;
  }
  revive(){
    const g=this.game,a=this.afterlife;if(!a)return;
    g.inventory=a.inventory.map(w=>Object.assign(g.makeWeapon(w.name),w));g.slot=a.slot;g.player.grenades=a.grenades;
    Object.assign(g.player,{position:a.body.slice(),previousPosition:a.body.slice(),health:this.maxHealth,velocityZ:0,grounded:true});g.invulnerableUntil=g.time+2;g.lastDamage=g.time;
    this.afterlife=null;this.hold=null;g.gesture=null;g.switching=null;g.pendingFire=false;g.reloadEnd=0;
    for(const target of this.data.afterlifeDoors||[])if(!g.opened.has(target))g.collision.disabled.delete(target);
    g.emit('weapon',g.weapon);g.emit('mobAfterlife',false);g.emit('sound',{alias:'zmb_afterlife_revive'});g.message('Revived · '+this.souls+' Afterlife charge'+(this.souls===1?'':'s'));
    if(g.round===0)g.roundDue=g.time+2;
  }
  interceptDown(amount){
    if(this.afterlife)return true;
    if(this.game.player.health<=amount&&this.souls>0)return this.enterAfterlife(false,false);
    return false;
  }
  visible(e){
    if(e.targetname==='mob_revive')return !!this.afterlife;
    if(e.mobItem){if(this.afterlife)return false;if(e.mobItem==='wardens_key')return !this.collected.has('wardens_key');if(e.mobItem.startsWith('refuelable'))return this.bridgeVisits>0&&!this.fuel.has(e.itemGroup);return this.itemChoices.has(e.itemId)&&!this.collected.has(e.itemGroup);}
    if(e.mobPanel)return !!this.afterlife&&!this.powered.has(e.mobPanelId);
    if(e.targetname==='afterlife_trigger')return !this.afterlife;
    if(this.afterlife)return false;
    if(e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_quickrevive')return false;
    if(e.targetname==='plane_craftable_trigger')return !this.planeBuilt;
    if(e.targetname==='plane_fuelable_trigger')return this.planeBuilt&&this.bridgeVisits>0;
    if(e.targetname==='plane_fly_trigger')return this.planeBuilt;
    return super.visible(e);
  }
  isPowered(e){return !e.powerFlag||this.flags.has(e.powerFlag);}
  prompt(e,key){
    if(this.locked.has(e.target))return key+' · Unlock · 2000 points';
    if(e.targetname==='mob_revive')return 'Hold '+key+' · Revive yourself';
    if(e.targetname==='afterlife_trigger')return this.souls?key+' · Enter Afterlife · '+this.souls+' charges':'No Afterlife charges';
    if(e.mobPanel)return 'Fire · Shock the power panel';
    if(e.mobItem)return key+' · Pick up '+e.mobItem.replaceAll('_',' ');
    if(e.script_noteworthy==='afterlife_door')return 'Open this door by shocking its panel in Afterlife';
    if(e.targetname==='zombie_vending'){
      const p=PERK[e.script_noteworthy];if(!p)return '';
      if(!this.isPowered(e))return 'Power this machine in Afterlife';if(this.perks.has(e.script_noteworthy))return p.name+' purchased';
      return this.perks.size>=4?'Four perks already purchased':key+' · Buy '+p.name+' · '+p.cost+' points';
    }
    if(e.targetname==='plane_craftable_trigger')return key+' · Build plane · '+this.planeParts.size+'/5 parts';
    if(e.targetname==='plane_fuelable_trigger')return key+' · Refuel plane · '+this.fuel.size+'/5 cans';
    if(e.targetname==='plane_fly_trigger')return this.bridgeVisits&&this.fuel.size<5?'Find all five fuel cans':key+' · Fly to the Golden Gate Bridge';
    if(e.targetname?.startsWith('trigger_electric_chair_'))return key+' · Return to Alcatraz';
    if(e.targetname?.startsWith('gondola_'))return key+' · '+(this.flags.has('gondola_powered_on_roof')||this.flags.has('gondola_powered_on_docks')?'Ride gondola · 750 points':'Power the gondola in Afterlife');
    if(e.targetname==='open_craftable_trigger')return key+' · Build Zombie Shield / Acid Gat';
    return super.prompt(e,key);
  }
  use(e){
    const g=this.game,t=e.targetname;
    if(this.locked.has(e.target)){if(g.spendPoints(2000))this.locked.delete(e.target);return true;}
    if(t==='afterlife_trigger'){this.enterAfterlife();return true;}
    if(t==='mob_revive'){if(this.afterlife&&!this.hold){this.hold={kind:'revive',started:g.time,due:g.time+3,position:e.position.slice()};g.startHoldGesture('mob_revive');}return true;}
    if(e.mobPanel)return true;
    if(this.afterlife)return true;
    if(e.script_noteworthy==='afterlife_door')return true;
    if(e.mobItem){
      if(!this.visible(e))return true;
      this.collected.add(e.itemGroup);if(e.mobItem.startsWith('plane_'))this.planeParts.add(e.itemGroup);if(e.mobItem.startsWith('refuelable'))this.fuel.add(e.itemGroup);
      g.emit('sound',{alias:'zmb_buildable_pickup'});g.message(e.mobItem.replaceAll('_',' ')+' acquired');return true;
    }
    if(t==='zombie_vending'){
      const id=e.script_noteworthy,p=PERK[id];if(!p||!this.isPowered(e)||this.perks.has(id)||this.perks.size>=4||g.gesture||!g.spendPoints(p.cost))return true;
      g.startGesture(id,()=>{this.perks.add(id);if(id==='specialty_armorvest')g.player.health=this.maxHealth;});g.emit('sound',{alias:p.sting});return true;
    }
    if(t==='plane_craftable_trigger'){if(this.planeParts.size===5){this.planeBuilt=true;g.emit('sound',{alias:'zmb_buildable_complete'});g.message('Icarus assembled');}return true;}
    if(t==='plane_fuelable_trigger'){if(this.fuel.size===5)g.message('Icarus ready for takeoff');return true;}
    if(t==='plane_fly_trigger'){
      if(this.planeBuilt&&(!this.bridgeVisits||this.fuel.size===5)&&!this.travel){this.travel={due:g.time+5,kind:'plane'};g.emit('sound',{alias:'zmb_plane_countdown_tick'});g.message('Icarus taking off…');}return true;
    }
    if(t?.startsWith('trigger_electric_chair_')){this.teleport(this.data.corpseStarts[g.character||0].map((v,k)=>v+(k===2?48:0)));this.enterAfterlife(false,true);g.message('Returned to Alcatraz in Afterlife');return true;}
    if(t?.startsWith('gondola_')){
      if(!(this.flags.has('gondola_powered_on_roof')||this.flags.has('gondola_powered_on_docks'))||this.travel||!g.spendPoints(750))return true;
      this.travel={due:g.time+5,kind:'gondola',to:g.player.position[2]>800?'docks':'roof'};g.emit('sound',{alias:'zmb_gondola_start'});g.message('Gondola travelling…');return true;
    }
    if(t==='open_craftable_trigger'){
      const shield=['dolly','door','clamp'].every(k=>this.collected.has('alcatraz_shield_zm_'+k));
      const acid=['case','fuse','blood'].every(k=>this.collected.has('packasplat_'+k));
      if(acid&&g.weapon.name.startsWith('blundergat')){g.giveWeapon(g.weapon.name.includes('upgraded')?'blundersplat_upgraded_zm':'blundersplat_zm');g.message('Acid Gat assembled');}
      else if(shield){this.shield=15;g.message('Zombie Shield equipped');}else g.message('Find all three parts for a buildable');return true;
    }
    return super.use(e);
  }
  shock(){
    const g=this.game;if(!this.afterlife)return;
    const origin=[...g.player.position];origin[2]+=g.viewHeight;const dir=[Math.cos(g.pitch)*Math.cos(g.yaw),Math.cos(g.pitch)*Math.sin(g.yaw),Math.sin(g.pitch)];
    const candidates=g.entities.filter(e=>e.mobPanel&&!this.powered.has(e.mobPanelId)).map(e=>{const at=pos(e);at[2]+=25;const d=at.map((v,k)=>v-origin[k]),range=Math.hypot(...d),along=d.reduce((s,v,k)=>s+v*dir[k],0);return {e,at,range,aim:along/Math.max(1,range)};}).filter(v=>v.range<256&&v.aim>.93&&g.collision.trace(origin,v.at,[0,0,0],1).fraction>.9).sort((a,b)=>b.aim-a.aim);
    if(candidates.length){const e=candidates[0].e;this.powered.add(e.mobPanelId);this.flags.add(e.mobPanel);const door=this.data.shockDoors[e.targetname];
      if(door){this.flags.add(door.flag);this.openTargets([door.target]);}
      const powerup={intro_powerup_activate:'powerup_door',cell_1_powerup_activate:'powerup_cell_door_1',cell_2_powerup_activate:'powerup_cell_door_2'}[e.mobPanel];if(powerup)this.openTargets([powerup]);
      g.emit('sound',{alias:'zmb_powerpanel_activate',position:pos(e)});g.message('Power panel activated');
    }
    for(const enemy of g.enemies)if(!enemy.dead&&enemy.kind!=='brutus'){
      const d=enemy.position.map((v,k)=>v+(k===2?35:0)-origin[k]),length=Math.hypot(...d);if(length<256&&d.reduce((s,v,k)=>s+v*dir[k],0)/length>.94){enemy.paralyzedUntil=g.time+3;}
    }
  }
  tick(){
    super.tick();const g=this.game,dt=1/120;
    if(this.afterlife){
      if(!this.hold)this.afterlife.mana=Math.max(0,this.afterlife.mana-dt*this.afterlifeDeaths*3);
      if(this.afterlife.mana===0){this.souls=0;this.afterlife=null;g.player.health=0;g.phase='dead';g.emit('death',{round:g.round,kills:g.player.kills,points:g.player.points});return;}
    }
    if(this.hold){const h=this.hold;if(!g.useHeld&&g.time-h.started>.1||dist(g.player.position,h.position)>105){this.hold=null;g.endHoldGesture();}else if(g.time>=h.due){g.endHoldGesture();this.revive();}}
    if(g.roundEndedAt>this.seenEnd){this.seenEnd=g.roundEndedAt;this.refillDue=g.time+2;}
    if(this.refillDue&&g.time>=this.refillDue){this.refillDue=0;this.souls=Math.min(g.coop?1:3,this.souls+1);g.emit('sound',{alias:'zmb_afterlife_add'});}
    if(g.round!==this.seenRound){this.seenRound=g.round;this.afterlifeDeaths=0;if(g.round>=this.nextBrutusRound){this.brutusDue=g.time+10;this.nextBrutusRound=g.round+4+Math.floor(Math.random()*3);}}
    if(this.brutusDue&&g.time>=this.brutusDue&&!g.enemies.some(e=>!e.dead&&e.kind==='brutus')){if(this.spawnBrutus())this.brutusDue=0;else this.brutusDue=g.time+2;}
    if(this.travel&&g.time>=this.travel.due){const t=this.travel;this.travel=null;
      if(t.kind==='plane'){this.bridgeVisits++;this.fuel.clear();this.flags.add('activate_player_zone_bridge');this.teleport(this.data.bridgeSpawn);g.message('Golden Gate Bridge · Pack-a-Punch');}
      else {this.flags.add(t.to==='docks'?'gondola_roof_to_dock':'gondola_dock_to_roof');this.teleport(this.data.gondolaStops[t.to]);g.message('Gondola arrived at '+t.to);}
    }
  }
  spawnBrutus(){
    const g=this.game;if(this.afterlife||g.enemies.filter(e=>!e.dead).length>=24)return false;
    const options=this.data.brutusSpawns.filter(p=>dist(p,g.player.position)>150&&dist(p,g.player.position)<1800).sort((a,b)=>dist(a,g.player.position)-dist(b,g.player.position));
    for(const p of options){let at;try{at=g.collision.actor(()=>g.settleFeet([p[0],p[1],p[2]+64]));}catch{continue;}
      if(!g.path(at,g.player.position,true).length&&!g.walkableLink(at,g.player.position))continue;
      const count=this.brutusCount++,health=count?Math.min(5000,count*1000):500;
      const e={id:g.nextId++,kind:'brutus',position:at,previousPosition:at.slice(),health,helmet:5,window:g.windows[0],stage:'hunt',path:[],attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:g.time,gait:'ai_zombie_run_v1',speed:120,ignoreRound:true,ignoreNuke:true};
      g.enemies.push(e);g.emit('spawn',e);g.emit('sound',{alias:'zmb_ai_brutus_spawn',position:at});g.message('Brutus has arrived');return true;
    }return false;
  }
  saveState(){return {...super.saveState(),souls:this.souls,afterlife:clone(this.afterlife),afterlifeDeaths:this.afterlifeDeaths,afterlifeRound:this.afterlifeRound,powered:[...this.powered],collected:[...this.collected],itemChoices:[...this.itemChoices],planeParts:[...this.planeParts],planeBuilt:this.planeBuilt,bridgeVisits:this.bridgeVisits,fuel:[...this.fuel],shield:this.shield,travel:clone(this.travel),seenRound:this.seenRound,seenEnd:this.seenEnd,refillDue:this.refillDue,brutusCount:this.brutusCount,nextBrutusRound:this.nextBrutusRound,brutusDue:this.brutusDue,locked:[...this.locked]};}
  loadState(s){super.loadState(s);for(const k of ['souls','afterlife','afterlifeDeaths','afterlifeRound','planeBuilt','bridgeVisits','shield','travel','seenRound','seenEnd','refillDue','brutusCount','nextBrutusRound','brutusDue'])this[k]=clone(s[k]??this[k]);for(const k of ['powered','collected','itemChoices','planeParts','fuel','locked'])this[k]=new Set(s[k]||[]);this.hold=null;
    const body=this.game.interactions.find(e=>e.targetname==='mob_revive');if(this.afterlife&&body)body.position=[...this.afterlife.body.slice(0,2),this.afterlife.body[2]+25];
    for(const target of this.data.afterlifeDoors||[])if(this.afterlife)this.game.collision.disabled.add(target);else if(!this.game.opened.has(target))this.game.collision.disabled.delete(target);
  }
}
