// Ascension (zombie_cosmodrome.gsc) on the shared T5 rules. Kino's teleporter
// is absent; this adds the lunar lander (zombie_cosmodrome_lander.gsc) and the
// rocket launch that opens Pack-a-Punch (zombie_cosmodrome_pack_a_punch.gsc).
import {KinoRules} from './bo1-engine.js';

const vec=s=>String(s||'0 0 0').trim().split(/\s+/).map(Number);
const add=(a,b)=>a.map((v,k)=>v+b[k]),sub=(a,b)=>a.map((v,k)=>v-b[k]),lerp=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
// MoveTo( origin, time, accel, decel ): the fraction travelled after t.
function travelled(t,time,accel=0,decel=0){
  if(time<=0||t>=time)return 1;if(t<=0)return 0;
  const peak=1/(time-accel/2-decel/2);
  if(t<accel)return peak*t*t/(2*accel);
  if(t<=time-decel)return peak*(accel/2+(t-accel));
  const left=time-t;return 1-peak*left*left/(2*decel);
}
// Each station's zone and descent (lander_goto_dest: catwalk 5 s, base entry
// and storage 6 s, centrifuge 7 s); riding from 1, 3 and 4 counts toward the
// launch (lander_a/b/c_used).
const STATIONS={
  lander_station1:{zone:'base_entry_zone',descent:6,used:'lander_a_used',name:'Base Entry'},
  lander_station3:{zone:'north_catwalk_zone3',descent:5,used:'lander_b_used',name:'Catwalk'},
  lander_station4:{zone:'storage_lander_zone',descent:6,used:'lander_c_used',name:'Storage'},
  lander_station5:{zone:'centrifuge_zone',descent:7,name:'Centrifuge'},
};
const LANDER_COST=250,GATE_DROP=-132,RIDE_RADIUS=96,PAD_CLEAR=150;
const ROCKET_RISE=50000,ROCKET_TIME=50;

export class AscensionRules extends KinoRules {
  constructor(game){
    super(game);
    const E=game.entities,lander=E.find(e=>e.targetname==='lander');
    this.sky=vec(lander.origin);this.landerParts=lander.target;
    // Each gate brushmodel targets its gate model, which rides along with it.
    this.gateModels=new Set(E.filter(e=>e.targetname===lander.target&&/^zipline_door_[ns]$/.test(e.script_noteworthy||'')).map(e=>e.target).filter(Boolean));
    this.spots=E.filter(e=>e.targetname===lander.target&&e.script_noteworthy==='zipline_spots').map(e=>sub(vec(e.origin),this.sky));
    this.stations=Object.fromEntries(Object.entries(STATIONS).map(([id,s])=>{
      const struct=E.find(e=>e.targetname===id&&e.classname==='script_struct'),hub=E.find(e=>e.targetname===struct.target),extra=hub?.target&&E.find(e=>e.targetname===hub.target);
      const riders=E.find(e=>e.targetname===id+'_riders');
      return [id,{...s,id,origin:vec(struct.origin),hub:vec(hub.origin),extra:extra?vec(extra.origin):null,riders:riders?vec(riders.origin):vec(struct.origin)}];
    }));
    // The call boxes, the lander's ride trigger and the rocket launch panel.
    const use=e=>({...e,position:vec(e.origin)});
    this.callBoxes=E.filter(e=>e.targetname==='zip_call_box'&&this.stations[e.script_noteworthy]).map(use);
    this.ride=use(E.find(e=>e.targetname===lander.target&&e.script_noteworthy==='zip_buy'));this.rideOffset=sub(this.ride.position,this.sky);
    this.panel=E.find(e=>e.targetname==='trig_launch_rocket');
    game.interactions.push(...this.callBoxes,this.ride,...(this.panel?[use(this.panel)]:[]));
    this.doors=['rocket_room_top_door','rocket_room_bottom_door'].map(name=>E.find(e=>e.targetname===name)).filter(Boolean);
  }
  reset(){
    super.reset();
    // cosmodrome_zone_init(): flag_set( "centrifuge" ) joins the two start zones.
    this.flags.add('centrifuge');
    // new_lander_intro(): the players ride the lander down from the sky.
    this.lander={at:null,origin:this.sky?.slice(),gate:0,flight:null,cooldown:0,called:false,connected:false,buyAt:Infinity};
    this.intro=null;this.riding=false;this.spawnPaused=false;this.launch=null;this.launched=false;this.doorOpen=0;this.rocketRise=0;
  }
  // ----- lander -----------------------------------------------------------
  // A flight is a list of timed moves of the lander's anchor and events.
  plan(from,to,riders){
    const a=this.stations[from],b=this.stations[to],moves=[],events=[];let t=0;
    const move=(target,time,accel=0,decel=0)=>{moves.push({start:t,time,accel,decel,target});t+=time;};
    events.push({at:0,run:()=>this.gate(0)});
    // lander_take_off(): close the gates, wait 1 s, rise to the hub, hover.
    t=1;events.push({at:1,run:()=>this.clearPad(a,riders)});
    move(a.hub,3,2,1);t+=.5;
    if(a.extra)move(a.extra,2);
    // lander_goto_dest(): via the catwalk's extra point, or straight there.
    if(b.extra){move(b.extra,5,1);move(b.hub,2,0,2);}else move(b.hub,7,1,2.75);
    events.push({at:t,run:()=>{this.clearPad(b,false);this.game.emit('sound',{alias:'zmb_lander_land',position:b.origin});}});
    move(b.origin,b.descent,.1,b.descent-.1);
    events.push({at:t,run:()=>this.landed(from,to,riders)});
    return {moves,events,end:t};
  }
  depart(from,to,riders,called){
    const g=this.game;this.lander.flight={...this.plan(from,to,riders),started:g.time,from,to,riders,called,origin:this.lander.origin.slice()};this.lander.at=null;
    this.spawnPaused=true;this.riding=riders;
    g.emit('sound',{alias:'zmb_lander_start',position:this.lander.origin.slice()});g.emit('sound',{alias:'zmb_lander_launch',position:this.lander.origin.slice()});
    g.emit('loop',{id:'lander',alias:'zmb_lander_flying_low_loop',position:this.lander.origin.slice(),near:200,far:3000});
  }
  landed(from,to,riders){
    const g=this.game,l=this.lander;l.at=to;l.flight=null;this.riding=false;this.spawnPaused=false;this.gate(1);
    g.emit('stopLoop',{id:'lander'});
    // 30 s after a ride (vox_ann_lander_cooldown), 3 s after an empty call.
    l.cooldown=g.time+(riders?30:3);
    if(riders){g.emit('sound',{alias:'vox_ann_lander_cooldown'});
      const used=STATIONS[from].used;if(used&&!this.flags.has(used)){this.flags.add(used);this.landerProgress();}}
  }
  // The three launch landers authorize the rocket (launch_activated).
  landerProgress(){
    const count=['lander_a_used','lander_b_used','lander_c_used'].filter(f=>this.flags.has(f)).length;
    if(count===3&&!this.flags.has('launch_activated')){this.flags.add('launch_activated');this.game.emit('sound',{alias:'vox_ann_launch_button'});this.game.message('Rocket launch authorized');}
    else this.game.message('Lander '+count+' of 3 used');
  }
  gate(open){this.gateFrom=this.lander.gate;this.gateTo=open;this.gateStarted=this.game.time;this.game.emit('sound',{alias:'zmb_lander_gate',position:this.lander.origin.slice()});}
  // Zombies on a pad when the lander leaves or lands are gibbed and return
  // to the round's total (lander_clean_up_corpses, zombie_total++).
  clearPad(station,riders){
    const g=this.game;
    for(const e of g.enemies){
      if(e.dead||Math.hypot(e.position[0]-station.riders[0],e.position[1]-station.riders[1])>(riders?RIDE_RADIUS+80:PAD_CLEAR)||Math.abs(e.position[2]-station.origin[2])>120)continue;
      e.dead=true;e.deathTime=g.time;e.deathHeadshot=true;e.killDirection=[e.position[0]-station.origin[0],e.position[1]-station.origin[1],.4];g.remaining++;g.emit('kill',e);
    }
  }
  onPad(station){const p=this.game.player.position;return Math.hypot(p[0]-station.riders[0],p[1]-station.riders[1])<=RIDE_RADIUS&&Math.abs(p[2]-station.origin[2])<100;}
  // Destinations from the centrifuge: a station whose zone is enabled.
  destination(from){
    if(from!=='lander_station5')return 'lander_station5';
    const zones=this.activeZones(),choices=['lander_station1','lander_station3','lander_station4'].filter(id=>zones.has(STATIONS[id].zone));
    return choices[Math.floor(Math.random()*choices.length)]||null;
  }
  updateLander(){
    const g=this.game,l=this.lander;
    // new_lander_intro(): wait 1.5 s, then descend to the centrifuge over 8 s.
    if(!this.intro&&l.at===null&&!l.flight&&g.phase!=='ready'){
      this.intro={started:g.time};this.riding=true;
    }
    if(this.intro&&!this.intro.done){
      const t=g.time-this.intro.started-1.5,target=this.stations.lander_station5.origin;
      l.origin=lerp(this.sky,target,travelled(t,8,.1,7.9));
      if(t>=8){this.intro.done=true;this.riding=false;l.at='lander_station5';this.gate(1);l.buyAt=g.time+15;
        g.emit('sound',{alias:'zmb_lander_land',position:target});g.emit('sound',{alias:'vox_ann_startup'});}
    }
    const f=l.flight;
    if(f){
      const t=g.time-f.started;let origin=f.origin;
      for(const m of f.moves){if(t<m.start)break;origin=lerp(origin,m.target,travelled(t-m.start,m.time,m.accel,m.decel));if(t<m.start+m.time)break;}
      l.origin=origin;
      while(f.events.length&&t>=f.events[0].at)f.events.shift().run();
    }
    l.gate=this.gateStarted==null?l.gate:this.gateFrom+(this.gateTo-this.gateFrom)*Math.min(1,(g.time-this.gateStarted)/1);
    this.ride.position=add(l.origin,this.rideOffset);
    // Riders stay linked to the lander's zipline spots, invulnerable.
    if(this.riding){
      const p=add(l.origin,this.spots[0]||[0,0,0]);
      Object.assign(g.player,{position:p,previousPosition:p.slice(),velocityZ:0,grounded:true});g.invulnerableUntil=g.time+.2;
    }
  }
  // ----- rocket -------------------------------------------------------------
  // rocket_launch_think(): claws swing out, launch sounds after 3 s, a 5..1
  // countdown 2 s later, then liftoff (+50000 over 50 s); 10 s after liftoff
  // the launch completes and the Pack-a-Punch blast doors slide apart.
  startLaunch(){
    const g=this.game;this.launch={started:g.time,count:5};g.emit('sound',{alias:'vox_ann_engines_firing'});
  }
  updateLaunch(){
    const g=this.game,L=this.launch;if(!L)return;const t=g.time-L.started;
    if(!L.sound&&t>=3){L.sound=true;g.emit('sound',{alias:'evt_rocket_start'});g.emit('loop',{id:'rocket',alias:'evt_rocket_lp',position:[1378.7,384.3,738.5],near:600,far:9000});}
    while(L.count>0&&t>=5+(5-L.count)){g.emit('sound',{alias:'vox_ann_launch_countdown_'+L.count});L.count--;}
    if(!L.liftoff&&t>=10){L.liftoff=g.time;g.emit('sound',{alias:'zmb_rocket_launch'});g.emit('sound',{alias:'evt_cosmo_launch'});g.message('Liftoff');}
    if(L.liftoff){
      const up=g.time-L.liftoff;this.rocketRise=ROCKET_RISE*travelled(up,ROCKET_TIME,ROCKET_TIME*.6,0);
      if(!this.launched&&up>=10){this.launched=true;this.openPap();}
      if(up>=ROCKET_TIME){this.launch=null;g.emit('stopLoop',{id:'rocket'});}
    }
  }
  openPap(){
    const g=this.game;this.flags.add('launch_complete');this.flags.add('rocket_group');this.doorStarted=g.time;
    this.openTargets(this.doors.map(d=>d.target).filter(Boolean));
    g.emit('sound',{alias:'zmb_heavy_door_open',position:vec(this.doors[0]?.origin)});g.emit('sound',{alias:'vox_ann_after_launch'});g.message('Pack-a-Punch is open');
  }
  // ----- shared rules hooks -------------------------------------------------
  tick(){
    super.tick();
    if(this.power&&!this.flags.has('lander_power')){this.flags.add('lander_power');this.game.emit('sound',{alias:'vox_ann_power_switch'});}
    this.updateLander();this.updateLaunch();
    if(this.doorStarted!=null)this.doorOpen=Math.min(1,(this.game.time-this.doorStarted)/1.5);
  }
  // Where each moving entity is drawn, relative to its placement.
  moverOffset(e){
    if(e.targetname==='lander'||e.targetname===this.landerParts||this.gateModels.has(e.targetname)){
      const offset=sub(this.lander.origin,this.sky);
      if(/^zipline_door_[ns]$/.test(e.script_noteworthy||'')||this.gateModels.has(e.targetname))offset[2]+=GATE_DROP*this.lander.gate;
      return offset;
    }
    if(e.targetname==='zombie_rocket'||e.targetname==='zombie_rocket_parts')return [0,0,this.rocketRise];
    if(e.targetname==='rocket_room_top_door'||e.targetname==='rocket_room_bottom_door'){const v=vec(e.script_vector);return v.map(x=>x*this.doorOpen);}
    return null;
  }
  get moverTargets(){return ['lander',this.landerParts,...this.gateModels,'zombie_rocket','zombie_rocket_parts','rocket_room_top_door','rocket_room_bottom_door'];}
  visible(e){
    if(e.targetname==='zip_call_box'||e===this.ride||e.targetname==='trig_launch_rocket')return true;
    return super.visible(e);
  }
  prompt(e,key){
    const g=this.game,l=this.lander;
    if(e.targetname==='zip_call_box'){
      if(!this.power)return 'You must turn on the power first';
      if(l.flight||!l.at)return 'The lunar lander is in flight';
      if(l.at===e.script_noteworthy)return 'The lunar lander is here';
      if(g.time<l.cooldown)return 'Lunar lander cooling down · '+Math.ceil(l.cooldown-g.time)+'s';
      return key+' · Call the lunar lander';
    }
    if(e===this.ride){
      if(!l.at||l.flight)return '';
      if(!this.power)return 'You must turn on the power first';
      if(!l.connected)return 'No lunar lander connections';
      if(g.time<l.cooldown||g.time<l.buyAt)return 'Lunar lander cooling down · '+Math.ceil(Math.max(l.cooldown,l.buyAt)-g.time)+'s';
      return key+' · Ride the lunar lander · '+LANDER_COST+' points';
    }
    if(e.targetname==='trig_launch_rocket'){
      if(!this.power)return 'You must turn on the power first';
      if(this.launch||this.launched)return '';
      return this.flags.has('launch_activated')?key+' · Launch the rocket':'Waiting for launch authorization · use three lunar landers';
    }
    return super.prompt(e,key);
  }
  use(e){
    const g=this.game,l=this.lander;
    if(e.targetname==='zip_call_box'){
      if(!this.power||l.flight||!l.at||l.at===e.script_noteworthy||g.time<l.cooldown)return true;
      l.called=true;l.connected=true;g.emit('sound',{alias:'vox_ann_lander_current_0',position:e.position});
      this.depart(l.at,e.script_noteworthy,false,true);return true;
    }
    if(e===this.ride){
      if(!this.power||!l.at||l.flight||!l.connected||g.time<l.cooldown||g.time<l.buyAt)return true;
      const from=this.stations[l.at];if(!this.onPad(from)){g.message('Step onto the lander');return true;}
      const to=this.destination(l.at);if(!to){g.message('No lunar lander destination available');return true;}
      if(!g.spendPoints(LANDER_COST))return true;
      this.depart(l.at,to,true,false);return true;
    }
    if(e.targetname==='trig_launch_rocket'){
      if(this.power&&this.flags.has('launch_activated')&&!this.launch&&!this.launched)this.startLaunch();return true;
    }
    return super.use(e);
  }
  saveState(){
    const l=this.lander,f=l.flight;
    return {...super.saveState(),lander:{at:f?f.to:l.at??'lander_station5',called:l.called,connected:l.connected},launched:this.launched||!!this.launch};
  }
  loadState(s){
    super.loadState(s);const l=this.lander;
    if(s.lander){l.at=s.lander.at;l.called=!!s.lander.called;l.connected=!!s.lander.connected;l.origin=this.stations[l.at]?.origin.slice()??l.origin;l.gate=1;l.buyAt=0;this.intro={done:true};}
    if(s.launched){this.launched=true;this.rocketRise=ROCKET_RISE;this.doorOpen=1;this.flags.add('launch_complete');this.flags.add('rocket_group');}
  }
}
