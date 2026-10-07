// Nuketown's zm_nuked.gsc / zm_nuked_perks.gsc on the shared T6 engine.
import {KinoRules} from './bo1-engine.js';
import {PERKS} from './map-rules.js';
const pos=e=>e.origin.split(/\s+/).map(Number),distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const shuffle=items=>{const a=items.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const between=(a,b)=>a+Math.floor(Math.random()*(b-a));
const RANGES=[[3,5,30,60],[6,9,30,60],[10,14,60,120],[15,19,60,120],[20,25,60,120]];

export class NuketownRules extends KinoRules {
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  reset(){
    super.reset();this.power=true;this.flags.add('power_on');this.started=false;this.solo=true;
    this.arrived=new Set();this.flight=null;this.schedule=[];this.queue=[];this.population=0;this.clock=0;this.clockAt=0;this.countedKills=new Set();
    this.meleeUpgrade=null;this.salePlaying=false;this.assignMachines(true);this.game.activeBox=Math.random()<.5?'start_chest1':'start_chest2';
  }
  assignMachines(solo){
    const landings=this.data.perkLandings,revive=shuffle(landings.filter(l=>!solo||l.soloRevive))[0];
    const others=shuffle(landings.filter(l=>l!==revive&&! (solo&&l.soloRevive)));
    const places=[revive,...others.slice(0,4)];this.placements={};
    for(const [i,e] of this.game.entities.filter(e=>e.nuketownMachine).entries()){
      const spot=places[i];this.placements[e.nuketownMachine]=spot.id;this.placeMachine(e.nuketownMachine,spot);
    }
  }
  placeMachine(id,spot){
    const g=this.game,m=g.entities.find(e=>e.nuketownMachine===id),trigger=g.interactions.find(e=>e.target===m.targetname);
    m.origin=spot.origin.join(' ');m.angles=spot.angles;
    if(trigger){trigger.origin=[...spot.origin.slice(0,2),spot.origin[2]+35].join(' ');trigger.position=pos(trigger);trigger.angles=spot.angles;}
    const entity=g.entities.find(e=>e.target===m.targetname&&e!==m);if(entity){entity.origin=trigger.origin;entity.angles=spot.angles;}
  }
  // The map's two cul-de-sac zones are always joined. Adjacent unlocked
  // rooms provide risers according to the occupied native volume.
  enabledSpawners(){return super.enabledSpawners().filter(e=>e.nativeNoteworthy==='riser_location');}
  negotiationLink(a,b,link){return link.negotiation&&this.game.nodes[a].type===17&&this.game.nodes[b].type===18&&!!this.data.traversals?.[a];}
  startTraversal(e){
    if(e.nativeTraversal||!e.path?.length)return false;const g=this.game;
    this.traverseNodes??=new Map(g.nodes.map((n,i)=>[n,i]).filter(([n])=>n.type===17).map(([n,i])=>[n.origin.join(','),i]));
    const index=this.traverseNodes.get(e.path[0].join(','));if(index===undefined||distance(e.position,e.path[0])>24)return false;
    const node=g.nodes[index],link=node.links.find(l=>this.negotiationLink(index,l.node,l));if(!link)return false;
    const end=g.nodes[link.node];if(!e.path[1]||distance(e.path[1],end.origin)>1)return false;
    const spec=this.data.traversals[index],clip=spec&&g.presentation.animations[spec.animation];
    if(!clip)return false;
    e.nativeTraversal={animation:spec.animation,started:g.time,duration:clip.duration,from:e.position.slice(),to:end.origin.slice(),arc:spec.arc};
    e.stage='maptraverse';e.angle=node.angle*Math.PI/180;e.path.splice(0,2);return true;
  }
  advanceTraversal(e){
    const t=e.nativeTraversal,f=Math.max(0,Math.min(1,(this.game.time-t.started)/t.duration));
    e.position=t.from.map((v,k)=>v+(t.to[k]-v)*f+(k===2?Math.sin(Math.PI*f)*t.arc:0));
    if(f>=1){e.position=t.to.slice();e.nativeTraversal=null;e.stage='hunt';e.navDue=this.game.time+.1;e.velocityZ=0;}
  }
  spawnEnemy(){
    const g=this.game,options=shuffle(this.enabledSpawners()),players=g.coop?.playerPositions()||[g.player.position];
    return g.collision.actor(()=>{
    for(const spawner of options){
      let at;const p=pos(spawner);
      for(const height of [80,32]){try{const candidate=g.settleFeet([p[0],p[1],p[2]+height]);
        if(players.some(q=>distance(candidate,q)<110))continue;
        if(players.some(q=>g.walkableLink(candidate,q)||g.path(candidate,q,true).length)){at=candidate;break;}}catch{}}
      if(!at)continue;
      const gait=g.zombieGait(),enemy={id:g.nextId++,kind:g.round>=25?'blue':undefined,position:at,previousPosition:at.slice(),health:g.recycleHealth.length?g.recycleHealth.shift():g.zombieHealth,
        window:null,stage:'rise',...g.riseClip(gait),path:[],attackDue:0,navDue:0,angle:Number((spawner.angles||'0 0 0').split(' ')[1])*Math.PI/180,dead:false,age:0,spawnTime:g.time,gait:gait.name,speed:gait.speed};
      g.enemies.push(enemy);g.remaining--;g.emit('spawn',enemy);return true;
    }
    return true; // Retry after the normal spawn delay; never invent a spawn.
    });
  }
  visible(e){
    if(e.targetname==='treasure_chest_use'&&this.game.powerup.fire_sale)return true;
    if(['zombie_vending','zombie_vending_upgrade'].includes(e.targetname))return this.arrived.has(e.script_noteworthy)&&super.visible(e);
    return super.visible(e);
  }
  prompt(e,key){
    if(e.targetname==='treasure_chest_use'&&this.game.powerup.fire_sale&&this.game.boxes.get(e.target)?.phase==='closed')return key+' · Mystery box · 10 points';
    if(e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_rof')return this.perks.has('specialty_rof')?'Double Tap II purchased':key+' · Buy Double Tap II · 2000 points';
    if(e.targetname==='zombie_vending_upgrade'){
      if(this.pap)return this.pap.phase==='ready'?key+' · Take '+this.game.weaponName(this.pap.upgraded):'Pack-a-Punch · upgrading…';
      return this.game.weapon.definition.upgrade?key+' · Pack-a-Punch · 5000 points':'No further upgrade available';
    }
    if(e.zombie_weapon_upgrade==='tazer_knuckles_zm')return this.meleeUpgrade==='tazer_knuckles_zm'?'Galvaknuckles purchased':key+' · Buy Galvaknuckles · 6000 points';
    if(e.zombie_weapon_upgrade==='bowie_knife_zm')return this.meleeUpgrade==='bowie_knife_zm'?'Bowie Knife purchased':key+' · Buy Bowie Knife · 3000 points';
    if(e.zombie_weapon_upgrade==='sticky_grenade_zm')return 'Semtex is not available in this build yet';
    return super.prompt(e,key);
  }
  use(e){
    if(['zombie_vending','zombie_vending_upgrade'].includes(e.targetname)&&!this.visible(e))return true;
    if(e.zombie_weapon_upgrade==='sticky_grenade_zm')return true;
    if(['tazer_knuckles_zm','bowie_knife_zm'].includes(e.zombie_weapon_upgrade)){
      const id=e.zombie_weapon_upgrade,cost=id==='tazer_knuckles_zm'?6000:3000;
      if(this.meleeUpgrade!==id&&this.game.spendPoints(cost)){this.meleeUpgrade=id;this.game.message(id==='tazer_knuckles_zm'?'Galvaknuckles purchased':'Bowie Knife purchased');}return true;
    }
    if(e.targetname==='zombie_vending'&&this.perks.size>=4)return true;
    return super.use(e);
  }
  boxCost(e){return this.game.powerup.fire_sale?10:Number(e.zombie_cost)||950;}
  boxJoker(){if(this.game.powerup.fire_sale)return false;const g=this.game,used=g.boxUses;let chance=-1;
    if(used>=4){chance=used+20;if(g.boxMoves===0&&used>=8)chance=100;else if(g.boxMoves>0)chance=used>=13?50:used>=8?30:15;}return Math.floor(Math.random()*100)<=chance;}
  beginSchedule(){
    const g=this.game;this.started=true;this.solo=!g.coop;if(!this.solo)this.assignMachines(false);
    this.queue=shuffle(g.entities.filter(e=>e.nuketownMachine).map(e=>e.nuketownMachine).filter(id=>!this.solo||id!=='specialty_quickrevive'));
    if(this.solo)this.schedule.push({id:'specialty_quickrevive',round:0,due:g.time+between(5,15)+4});
    for(const [a,b,min,max] of RANGES)this.schedule.push({round:between(a,b),delay:between(min,max),due:null});
  }
  bring(id){
    const g=this.game,spot=this.data.perkLandings.find(l=>l.id===this.placements[id]),path=spot.path;
    // Authored vehicle nodes specify miles/hour. Follow the original path
    // and speed (1 mph = 17.6 game units/second), then settle at its landing.
    const segments=[];let total=0,from=path[0]?.position||[...spot.origin.slice(0,2),spot.origin[2]+8000];
    for(const node of [...path.slice(1),{position:spot.origin,speed:path.at(-1)?.speed||60}]){const time=distance(from,node.position)/(Math.max(1,node.speed)*17.6);segments.push({from:from.slice(),to:node.position.slice(),start:total,time});total+=time;from=node.position;}
    this.flight={id,started:g.time,duration:total,segments};g.emit('sound',{alias:'zmb_perks_incoming_quad_front'});g.emit('sound',{alias:'zmb_perks_incoming_alarm',position:[-2198,486,327]});
    g.emit('loop',{id:'nuketown_perk',alias:'zmb_perks_incoming_loop',position:spot.origin,near:300,far:5000});
  }
  machinePosition(id){
    const spot=this.data.perkLandings.find(l=>l.id===this.placements[id]),f=this.flight;
    if(f?.id!==id)return spot.origin;
    const t=this.game.time-f.started,s=f.segments.find(s=>t<s.start+s.time)||f.segments.at(-1),blend=s.time?Math.max(0,Math.min(1,(t-s.start)/s.time)):1;
    return s.from.map((v,k)=>v+(s.to[k]-v)*blend);
  }
  land(){
    const g=this.game,id=this.flight.id,spot=this.data.perkLandings.find(l=>l.id===this.placements[id]);this.flight=null;this.arrived.add(id);
    if(spot.blocker)this.openTargets([spot.blocker]);g.emit('stopLoop',{id:'nuketown_perk'});g.emit('sound',{alias:'zmb_perks_incoming_land',position:spot.origin});g.emit('sound',{alias:'perks_power_on',position:spot.origin});
    g.emit('shake',{position:spot.origin,amplitude:.7,duration:2.5,radius:1000});
    const range=distance(g.player.position,spot.origin);if(range<300){g.changeStance('prone');g.damagePlayer(10);}
    // The original landing kills nearby zombies and adds them back to the round.
    for(const z of g.enemies)if(!z.dead&&distance(z.position,spot.origin)<500){z.dead=true;z.nuketownLandingDeath=true;z.deathTime=g.time;g.remaining++;g.emit('kill',z);}
    if(id==='specialty_weapupgrade')g.emit('loop',{id:'kino_pap_rollers',alias:'packa_rollers_loop',position:spot.origin,near:40,far:400});
    g.message((id==='specialty_weapupgrade'?'Pack-a-Punch':id==='specialty_rof'?'Double Tap II':PERKS[id].name)+' has landed');
  }
  tick(){
    // A dropped machine is already powered. Avoid Kino's blanket perk-start
    // sound and Pack-a-Punch loop before the machine has actually arrived.
    this.papOn=true;super.tick();const g=this.game;if(g.mirror||g.phase==='ready'||g.phase==='dead')return;
    const sale=!!g.powerup.fire_sale;if(sale!==!!this.salePlaying){this.salePlaying=sale;g.emit(sale?'loop':'stopLoop',sale?{id:'nuketown_sale',alias:g.round>=25?'mus_fire_sale_rich':'mus_fire_sale'}:{id:'nuketown_sale'});}
    if(!this.started)this.beginSchedule();
    for(const s of this.schedule)if(s.due===null&&g.round>=s.round)s.due=g.time+s.delay;
    if(this.flight){if(g.time-this.flight.started>=this.flight.duration)this.land();}
    else{const index=this.schedule.findIndex(s=>s.due!==null&&g.time>=s.due);if(index>=0){const [s]=this.schedule.splice(index,1),id=s.id||this.queue.shift();if(id)this.bring(id);}}
    const retained=new Set(g.enemies.map(z=>z.id));for(const id of this.countedKills)if(!retained.has(id))this.countedKills.delete(id);
    for(const z of g.enemies)if(z.dead&&!this.countedKills.has(z.id)){this.countedKills.add(z.id);if(z.health<=0&&!z.nuketownLandingDeath){this.population=(this.population+99)%100;
      g.emit('sound',{alias:'zmb_counter_flip',position:pos(g.entities.find(e=>e.targetname==='counter_ones'))});
      if([0,33,66,99].includes(this.population)){this.clock=(this.clock+1)%4;this.clockAt=g.time;g.emit('sound',{alias:'zmb_clock_hand'});}}}
  }
  saveState(){return {...super.saveState(),started:this.started,solo:this.solo,arrived:[...this.arrived],placements:this.placements,flight:this.flight,schedule:this.schedule,queue:this.queue,population:this.population,clock:this.clock,clockAt:this.clockAt,meleeUpgrade:this.meleeUpgrade};}
  loadState(s){super.loadState(s);for(const k of ['started','solo','placements','flight','schedule','queue','population','clock','clockAt','meleeUpgrade'])if(s[k]!==undefined)this[k]=s[k];this.arrived=new Set(s.arrived||[]);
    for(const [id,spot]of Object.entries(this.placements))this.placeMachine(id,this.data.perkLandings.find(l=>l.id===spot));}
  coopState(){return {placements:this.placements,arrived:[...this.arrived],flight:this.flight,population:this.population,clock:this.clock,clockAt:this.clockAt};}
  applyCoopState(s){if(!s)return;Object.assign(this,s);this.arrived=new Set(s.arrived||[]);for(const [id,spot]of Object.entries(this.placements))this.placeMachine(id,this.data.perkLandings.find(l=>l.id===spot));}
}
