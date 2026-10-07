// Arthur (zm_buried "sloth"), after _zm_ai_sloth.gsc. The host runs his state
// machine; positions come from the clips' own root motion where the game
// plays them scripted (the cell), and from the clips' travel speeds when he
// walks the navigation graph. The view plays the clip named in `clip`.
const pos=e=>e.origin.split(/\s+/).map(Number),flat=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),rotate=(v,yaw)=>[v[0]*Math.cos(yaw)-v[1]*Math.sin(yaw),v[0]*Math.sin(yaw)+v[1]*Math.cos(yaw),v[2]];
export const ARTHUR_LOOPS=new Set(['idle_jail','idle_cower','idle_cower_jumpback','idle','walk','walk_hunched','walk_scared','run','run_hunched','gimme_booze','gimme_candy','run_berserk','idle_protect','frantic_run','frantic_run_hunched']);
// The gift trigger is registered while he cowers in the cell, follows, waits
// for the player or roams; never while drinking, charging, eating or helping.
const GIFT_STATES=new Set(['jail_cower','follow','player_idle','roam']);
const PROTECT_SECONDS=45,FOLLOW_STOP=90,FOLLOW_RESUME=144,PROTECT_IDLE=180,PROTECT_RANGE=240,MELEE=64,HULL=[15,15,35];

export class Arthur {
  constructor(rules){
    this.rules=rules;this.game=rules.game;const g=this.game,m=g.data.map;
    this.clips=m.arthurClips||{};this.barricades=m.slothBarricades||[];
    const start=g.entities.find(e=>e.targetname==='sloth_idle_pos');
    this.anchor=pos(start);this.anchorYaw=Number((start.angles||'0 270 0').split(/\s+/)[1])*Math.PI/180;
    this.roamPoints=g.entities.filter(e=>e.targetname==='sloth_roam').map(pos);
    this.reset();
  }
  reset(){
    this.state='jail_idle';this.gotBooze=false;this.prop=null;this.door=null;this.holding=false;
    this.yaw=this.anchorYaw;this.clip=null;this.play('idle_jail');this.position=this.anchored('idle_jail',0);
    this.mover={position:this.position.slice(),path:[],speed:75,velocityZ:0};this.goal=null;this.goalKey=null;this.pathDue=0;
    this.scared=false;this.charge=null;this.protectUntil=0;this.target=null;this.attackHit=false;
  }
  // ----- clips -------------------------------------------------------------
  duration(name){return this.clips[name]?.duration||1;}
  age(){return this.game.time-this.clipStarted;}
  play(name){if(name===this.clip)return;this.clip=name;this.clipStarted=this.game.time;this.noteAge=0;this.clipYaw=this.yaw;}
  // Root yaw of a clip at time t (the delta rotation): drinking turns him
  // around to face away from the giver, as do backing into the cell and
  // bouncing off a wall.
  turnAt(name,t){
    const keys=this.clips[name]?.turn;if(!keys)return 0;if(t<=keys[0][0])return keys[0][1];
    for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const a=keys[i-1],b=keys[i];return a[1]+(b[1]-a[1])*(t-a[0])/((b[0]-a[0])||1);}
    return keys.at(-1)[1];
  }
  // One-shot clips that carry a turn steer his facing from where they began.
  applyTurn(){if(!ARTHUR_LOOPS.has(this.clip)&&this.clips[this.clip]?.turn)this.yaw=wrap(this.clipYaw+this.turnAt(this.clip,Math.min(this.age(),this.duration(this.clip))));}
  // Root (tag_origin) motion of a clip at time t, in the clip's local frame:
  // x forward, y left, z up.
  motion(name,t){
    const keys=this.clips[name]?.motion||[[0,0,0,0]];if(keys.length===1||t<=keys[0][0])return keys[0].slice(1);
    for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const a=keys[i-1],b=keys[i],f=(t-a[0])/((b[0]-a[0])||1);return [1,2,3].map(k=>a[k]+(b[k]-a[k])*f);}
    return keys.at(-1).slice(1);
  }
  // animscripted(jail_start): the clip places him relative to sloth_idle_pos.
  anchored(name,t){const d=rotate(this.motion(name,t),this.anchorYaw);return this.anchor.map((v,k)=>v+d[k]);}
  // Notetrack sounds ("sndnt#alias") and the notes the state machine waits on.
  passed(note){const t=this.clips[this.clip]?.notes?.[note];return t!=null&&this.age()>=t;}
  emitNotes(){
    const notes=this.clips[this.clip]?.notes;if(!notes)return;const length=this.duration(this.clip),loop=ARTHUR_LOOPS.has(this.clip);
    let from=this.noteAge,to=this.age();if(!loop)to=Math.min(to,length+1e-6);this.noteAge=to;
    for(const [name,at]of Object.entries(notes)){if(!name.startsWith('sndnt#'))continue;
      const cycles=loop?Math.floor((to-at)/length)-Math.floor((from-at)/length):(from<at&&to>=at?1:0);
      if(cycles>0)this.game.emit('sound',{alias:name.slice(6),position:this.position.slice()});}
  }
  // ----- helpers -----------------------------------------------------------
  // The player carrying booze or candy (get_player_to_follow).
  carrier(){const kind=this.rules.carry?.kind;return kind==='booze'||kind==='candy'?this.game.player:null;}
  facing(at,limit=.75){const d=[at[0]-this.position[0],at[1]-this.position[1]],l=Math.hypot(...d)||1;return (Math.cos(this.yaw)*d[0]+Math.sin(this.yaw)*d[1])/l>limit;}
  turn(toward,dt,rate=5){const want=Math.atan2(toward[1]-this.position[1],toward[0]-this.position[0]),diff=wrap(want-this.yaw);this.yaw=wrap(this.yaw+Math.sign(diff)*Math.min(Math.abs(diff),rate*dt));}
  speed(name){const c=this.clips[name];if(!c)return 75;const a=c.motion[0],b=c.motion.at(-1);return Math.hypot(b[1]-a[1],b[2]-a[2])/c.duration;}
  hunters(){return this.game.enemies.filter(e=>!e.dead&&e.kind!=='ghost'&&e.stage==='hunt');}
  // watch_zombies(): walk scared with a zombie within 60, until all are past 120.
  gait(){
    const near=this.hunters().map(e=>flat(e.position,this.position));
    if(near.some(d=>d<=60))this.scared=true;else if(near.every(d=>d>120))this.scared=false;
    return this.scared?'walk_scared':'walk';
  }
  // Walks the navigation graph toward a point at the clip's own speed.
  // Returns true on arrival and null when no route reaches it (a closed door
  // or barricade between), in which case he stays where he is.
  moveTo(target,clip,dt){
    const g=this.game,key=target.map(Math.round).join(',');
    if(g.time>=this.pathDue||key!==this.goalKey){
      this.goalKey=key;this.pathDue=g.time+1;const direct=g.walkableLink(this.position,target);
      this.mover.path=direct?[]:g.path(this.position,target,false);this.unreachable=!direct&&!this.mover.path.length;
      while(this.mover.path.length>1&&g.walkableLink(this.position,this.mover.path[1]))this.mover.path.shift();
    }
    if(this.unreachable)return null;
    this.play(clip);this.mover.position=this.position;this.mover.speed=this.speed(clip);
    const done=g.advancePath(this.mover,dt,target);this.position=this.mover.position;
    if(!done)this.yaw=wrap(this.yaw+Math.max(-6*dt,Math.min(6*dt,wrap(this.mover.angle-this.yaw))));
    return done;
  }
  // Zombies he barges through while running (sloth_check_ragdolls): no points,
  // and the round gets them back (level.zombie_total++).
  killZombie(e){
    const g=this.game;if(e.dead)return;e.dead=true;e.deathTime=g.time;g.remaining++;
    e.killDirection=[Math.cos(this.yaw)*400,Math.sin(this.yaw)*400,200];g.emit('kill',e);g.emit('sound',{alias:'zmb_ai_sloth_attack_impact',position:e.position.slice()});
  }
  barge(){for(const e of this.hunters())if(flat(e.position,this.position)<MELEE&&this.facing(e.position,.7))this.killZombie(e);}
  // ----- player actions ------------------------------------------------------
  // The cell is unlocked (watch_cell_open_close: level notify "cell_open").
  unlock(){
    if(!this.state.startsWith('jail'))return;const g=this.game,jump=this.gotBooze;
    this.state='jail_open';this.play(jump?'idle_jail_2_cower_jumpback':'idle_jail_2_cower');
    this.door={clip:jump?'o_zombie_sloth_idle_jail_2_cower_jumpback_door':'o_zombie_sloth_idle_jail_2_cower_door',started:g.time};
    g.emit('sound',{alias:'zmb_jail_door_open',position:this.anchor.slice()});
  }
  get cellOpen(){return !!this.door;}
  // sloth_gift_prompt(): within 96 of the trigger 32 in front of him, each
  // facing the other.
  giftOrigin(){return [this.position[0]+Math.cos(this.yaw)*32,this.position[1]+Math.sin(this.yaw)*32,this.position[2]+35];}
  canGift(player=this.game.player,yaw=this.game.yaw){
    if(!GIFT_STATES.has(this.state)||!this.carrier())return false;
    const at=this.giftOrigin(),p=player.position;if(Math.hypot(at[0]-p[0],at[1]-p[1],at[2]-p[2]-35)>96)return false;
    const d=[this.position[0]-p[0],this.position[1]-p[1]],l=Math.hypot(...d)||1,limit=this.holding?.7:.75;
    return (Math.cos(yaw)*d[0]+Math.sin(yaw)*d[1])/l>limit&&this.facing(p,limit);
  }
  give(kind){
    const g=this.game;this.holding=false;
    if(kind==='booze'){
      // start_berserk(): drink, turn to the barricade he faces, then charge.
      this.gotBooze=true;this.state='drink';this.play('drinkbooze');this.prop='booze';this.aim=this.facingBarricade();this.charge=null;
    }else{this.state='eat';this.play('eatcandy');this.prop='candy';}
    g.emit('sound',{alias:kind==='booze'?'zmb_ai_sloth_booze_give':'zmb_ai_sloth_candy_give',position:this.position.slice()});
  }
  // get_facing_barricade(): within 900, its back toward him, along his
  // backward line (he faces the player) within 100 units; failing that, along
  // the player's view with no sideways limit.
  facingBarricade(){
    const g=this.game,search=(origin,forward,sideways)=>{let best=null,bestDistance=Infinity;
      for(const b of this.barricades){if(g.opened.has(b.target)||b.noteworthy==='courtyard_fountain')continue;
        const d=[b.position[0]-origin[0],b.position[1]-origin[1]],length=Math.hypot(...d);if(length>900||length<1)continue;
        const yaw=b.angles[1]*Math.PI/180,back=[-Math.cos(yaw),-Math.sin(yaw)];
        if(forward[0]*back[0]+forward[1]*back[1]<.707||(d[0]*back[0]+d[1]*back[1])/length<.707)continue;
        const along=Math.max(0,Math.min(length*2,d[0]*forward[0]+d[1]*forward[1])),off=Math.hypot(d[0]-forward[0]*along,d[1]-forward[1]*along);
        if(sideways&&off>100)continue;if(off<bestDistance){bestDistance=off;best=b;}}
      return best;};
    return search(this.position,[-Math.cos(this.yaw),-Math.sin(this.yaw)],true)||search(g.player.position,[Math.cos(g.yaw),Math.sin(g.yaw)],false);
  }
  // ----- the charge ----------------------------------------------------------
  touching(b){
    const points=[[0,0,35],[24,0,35],[24,0,70]].map(v=>{const r=rotate(v,this.yaw);return this.position.map((x,k)=>x+r[k]);});
    return points.some(p=>b.hulls.some(h=>h.mins.every((v,k)=>p[k]>=v-15)&&h.maxs.every((v,k)=>p[k]<=v+15)&&h.planes.every(pl=>pl[0]*p[0]+pl[1]*p[1]+pl[2]*p[2]<=pl[3]+15)));
  }
  // watch_barricade(): touched by the charging Arthur, the barricade and its
  // clip go, its flag opens the zone, and whoever gave the booze is paid by
  // the distance he ran.
  breakBarricade(b){
    const g=this.game,start=this.charge?.start||this.position;
    this.rules.openTargets([b.target]);if(b.flag)this.rules.flags.add(b.flag);
    g.changePoints(Math.floor(Math.hypot(...start.map((v,k)=>v-this.position[k]))/10)*10);
    g.emit('sound',{alias:'zmb_sloth_barrier_break',position:b.position.slice()});g.emit('arthurBarricade',b.target);
  }
  crash(barricade){
    this.state='crash';this.play(barricade?'hit_barrier':'hit_wall');this.charge=null;this.crashFrom=this.position.slice();this.crashAge=0;
  }
  tickCharge(dt){
    const g=this.game,c=this.charge,forward=[Math.cos(this.yaw),Math.sin(this.yaw)];
    for(const b of this.barricades)if(!g.opened.has(b.target)&&this.touching(b)){this.breakBarricade(b);this.crash(true);return;}
    // The forward trace ignores the barricades themselves (is_barricade_ent).
    const shut=this.barricades.filter(b=>!g.opened.has(b.target)).map(b=>b.target),disabled=g.collision.disabled;
    const added=shut.filter(t=>!disabled.has(t));for(const t of added)disabled.add(t);
    let blocked=false;
    try{
      const start=[this.position[0],this.position[1],this.position[2]+39],end=[start[0]+forward[0]*48,start[1]+forward[1]*48,start[2]];
      blocked=g.collision.trace(start,end,[15,15,1],1|0x20000).fraction<1;
      if(!blocked){c.velocityZ-=800*dt;const step=this.speed('run_berserk')*dt,r=g.collision.step(this.position,[forward[0]*step,forward[1]*step,c.velocityZ*dt],HULL);this.position=r.position;if(r.grounded)c.velocityZ=0;}
    }finally{for(const t of added)disabled.delete(t);}
    // A player in his path goes down.
    const p=g.player.position,rel=[p[0]-this.position[0],p[1]-this.position[1]],ahead=rel[0]*forward[0]+rel[1]*forward[1];
    if(ahead>0&&ahead<48&&Math.abs(rel[0]*forward[1]-rel[1]*forward[0])<30&&Math.abs(p[2]-this.position[2])<60&&!g.coop?.down)g.damagePlayer(g.player.health);
    this.barge();
    // The failsafe: under 30 units in half a second is a crash.
    if(g.time>=c.checkAt){if(flat(this.position,c.checkFrom)<30)blocked=true;c.checkAt=g.time+.5;c.checkFrom=this.position.slice();}
    if(blocked||this.position[2]<c.start[2]-400)this.crash(false);
  }
  // ----- per tick ------------------------------------------------------------
  tick(dt){
    const g=this.game,carrier=this.carrier();this.emitNotes();
    switch(this.state){
      case 'jail_idle':this.position=this.anchored('idle_jail',this.age()%this.duration('idle_jail'));break;
      case 'jail_open':{
        const name=this.clip,t=Math.min(this.age(),this.duration(name));this.position=this.anchored(name,t);
        this.applyTurn();
        if(this.age()>=this.duration(name)){this.state='jail_cower';this.play(this.gotBooze?'idle_cower_jumpback':'idle_cower');}
        break;}
      case 'jail_cower':if(this.gotBooze&&carrier&&!this.holding)this.state='follow';break;
      case 'drink':
        this.applyTurn();
        if(this.prop==='booze'&&this.passed('hitground'))this.prop=null;
        if(this.passed('blend')){this.state='aim';this.play('drinkbooze_aim');this.prop=null;}
        break;
      case 'aim':
        if(this.aim)this.turn(this.aim.position,dt,4);
        for(const e of this.hunters())if(flat(e.position,this.position)<MELEE)this.killZombie(e);
        if(this.passed('blend')){this.state='berserk';this.play('run_berserk');this.charge={start:this.position.slice(),checkAt:g.time+.5,checkFrom:this.position.slice(),velocityZ:0};}
        break;
      case 'berserk':this.tickCharge(dt);break;
      case 'crash':{
        // Played in place from where he hit, with its stumble.
        const a=this.motion(this.clip,this.crashAge),b=this.motion(this.clip,Math.min(this.age(),this.duration(this.clip)));this.crashAge=this.age();
        const d=rotate([b[0]-a[0],b[1]-a[1],0],this.clipYaw);this.applyTurn();if(Math.hypot(d[0],d[1])>.001)this.position=g.collision.step(this.position,[d[0],d[1],-2],HULL).position;
        if(this.age()>=this.duration(this.clip)){this.state='roam';this.goal=null;}
        break;}
      case 'eat':
        if(this.age()>=this.duration('eatcandy')){this.prop=null;this.state='protect';this.protectUntil=g.time+PROTECT_SECONDS;this.target=null;}
        break;
      case 'protect':this.tickProtect(dt);break;
      case 'attack':
        if(this.target&&!this.target.dead)this.turn(this.target.position,dt,8);
        if(!this.attackHit&&['j_wrist_ri','j_wrist_le','j_ball_ri'].some(n=>this.passed(n))){this.attackHit=true;if(this.target)this.killZombie(this.target);}
        if(this.age()>=this.duration(this.clip)){this.state='protect';this.target=null;}
        break;
      case 'player_idle':
        if(!carrier){this.state='roam';this.goal=null;break;}
        this.turn(carrier.position,dt,4);this.play(this.rules.carry.kind==='booze'?'gimme_booze':'gimme_candy');
        if(!this.holding&&flat(this.position,carrier.position)>FOLLOW_RESUME)this.state='follow';
        break;
      case 'follow':
        if(!carrier){this.state='roam';this.goal=null;break;}
        if(flat(this.position,carrier.position)<FOLLOW_STOP){this.state='player_idle';break;}
        if(this.moveTo(carrier.position,this.gait(),dt)===null){this.play('idle');this.turn(carrier.position,dt,3);}
        break;
      case 'roam':
        if(carrier){this.state='follow';break;}
        // action_roam_point(): a random roam node; ones he cannot reach yet
        // are skipped for a while.
        if(!this.goal&&g.time>=(this.roamWait||0)){
          const open=this.roamPoints.filter(p=>!(this.blockedUntil?.get(p.join())>g.time));
          this.goal=open.length?open[Math.floor(Math.random()*open.length)]:null;
        }
        if(!this.goal){this.play('idle');break;}
        {const result=this.moveTo(this.goal,this.gait(),dt);
          if(result===null){(this.blockedUntil??=new Map()).set(this.goal.join(),g.time+20);this.goal=null;this.roamWait=g.time+2;this.play('idle');}
          else if(result){this.goal=null;this.play('idle');}}
        break;
    }
    if(this.holding&&carrier&&this.state!=='jail_cower'){this.state='player_idle';}
  }
  // protect_action(): run to the zombie nearest the candy giver (within 240,
  // 120 vertically), kill it with a swing, otherwise wait near the player.
  tickProtect(dt){
    const g=this.game,p=g.player.position;
    if(g.time>=this.protectUntil){this.state='roam';this.goal=null;return;}
    if(!this.target||this.target.dead){
      this.target=this.hunters().filter(e=>Math.abs(e.position[2]-p[2])<=120&&flat(e.position,p)<=PROTECT_RANGE).sort((a,b)=>flat(a.position,p)-flat(b.position,p))[0]||null;
    }
    if(this.target){
      if(flat(this.position,this.target.position)<MELEE){this.state='attack';this.attackHit=false;this.clip=null;this.play('attack_v'+(1+Math.floor(Math.random()*4)));return;}
      if(this.moveTo(this.target.position,'frantic_run',dt)===null)this.target=null;else this.barge();
    }else if(flat(this.position,p)<PROTECT_IDLE||this.moveTo(p,'frantic_run',dt)===null)this.play('idle_protect');
    else this.barge();
  }
  // ----- shared state --------------------------------------------------------
  view(){return {state:this.state,position:this.position.slice(),yaw:this.yaw,clipYaw:this.clipYaw,clip:this.clip,age:this.age(),prop:this.prop,door:this.door?{clip:this.door.clip,age:this.game.time-this.door.started}:null};}
  applyView(v){
    const g=this.game;this.state=v.state;this.position=v.position.slice();this.yaw=v.yaw;this.prop=v.prop;
    if(v.clip!==this.clip){this.clip=v.clip;this.noteAge=v.age;}this.clipStarted=g.time-v.age;this.clipYaw=v.clipYaw??v.yaw;
    this.door=v.door?{clip:v.door.clip,started:g.time-v.door.age}:null;
  }
  saveState(){return {...this.view(),gotBooze:this.gotBooze,protectLeft:Math.max(0,this.protectUntil-this.game.time),charge:this.charge&&{start:this.charge.start,velocityZ:this.charge.velocityZ},crashFrom:this.crashFrom,crashAge:this.crashAge};}
  loadState(s){
    if(!s)return;this.applyView(s);this.gotBooze=!!s.gotBooze;this.protectUntil=this.game.time+(s.protectLeft||0);this.crashFrom=s.crashFrom;this.crashAge=s.crashAge||0;
    this.charge=s.charge?{...s.charge,checkAt:this.game.time+.5,checkFrom:this.position.slice()}:null;
    // Mid-action states that need live targets resume in a safe state.
    if(['attack','player_idle','follow'].includes(this.state))this.state='roam';
    if(this.state==='berserk'&&!this.charge)this.state='roam';
    this.goal=null;this.target=null;this.holding=false;this.pathDue=0;
  }
}
