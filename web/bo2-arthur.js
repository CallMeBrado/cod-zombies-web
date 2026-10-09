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
// The berserk charge (remake tuning): barricades within `search`, their
// approach point at most `sideways` off his line; up to `correct` units of
// sideways forgiveness blended over `blend` seconds when a wall or corner
// edges into his lane; zombies within `body` of his swept path are run down.
export const CHARGE={search:900,sideways:100,approach:64,correct:32,blend:.25,body:31,lane:10,square:.7};
const WORLD=1|0x20000;

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
    this.mover={position:this.position.slice(),path:[],speed:75,velocityZ:0};this.goal=null;this.goalKey=null;this.routedKey=null;this.pathDue=0;this.stalls=0;this.progressFrom=null;this.progressDue=0;
    this.scared=false;this.charge=null;this.protectUntil=0;this.target=null;this.attackHit=false;
  }
  // ----- clips -------------------------------------------------------------
  duration(name){return this.clips[name]?.duration||1;}
  age(){return this.game.time-this.clipStarted;}
  play(name){if(name===this.clip)return;this.clip=name;this.clipStarted=this.game.time;this.noteAge=-1e-6;this.clipYaw=this.yaw;}
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
    const g=this.game,key=target.map(v=>Math.round(v/48)).join(',');
    // Re-route when the goal moves (at most twice a second), when the route
    // runs out, or after two seconds without progress; three stalls on one
    // goal mean he cannot reach it.
    const stalled=g.time>=(this.progressDue||0)&&this.progressFrom&&flat(this.position,this.progressFrom)<16;
    if(g.time>=(this.progressDue||0)){this.progressFrom=this.position.slice();this.progressDue=g.time+2;}
    if(key!==this.goalKey){this.goalKey=key;this.stalls=0;this.pathDue=Math.min(this.pathDue,g.time+.5);}
    if(stalled)this.stalls=(this.stalls||0)+1;
    if(stalled||g.time>=this.pathDue&&(this.routedKey!==key||!this.mover.path.length)){
      this.routedKey=key;this.pathDue=g.time+1;
      // Physical walks, not sight lines: a porch railing or a drop must not
      // count as a straight way through.
      const direct=flat(this.position,target)<256&&this.walkable(this.position,target);
      this.mover.path=direct?[]:this.route(target);this.unreachable=!direct&&!this.mover.path.length||this.stalls>=3;
      if(this.mover.path.length>1&&this.walkable(this.position,this.mover.path[1]))this.mover.path.shift();
    }
    if(this.unreachable)return null;
    this.play(clip);this.mover.position=this.position;this.mover.speed=this.speed(clip);this.mover.kinematic=true;
    // Roam nodes can sit well above the floor (one is 56 units over the
    // street), so arriving is judged across the ground.
    const done=g.advancePath(this.mover,dt,target)||flat(this.position,target)<12&&Math.abs(this.position[2]-target[2])<80;this.position=this.mover.position;
    if(!done)this.yaw=wrap(this.yaw+Math.max(-6*dt,Math.min(6*dt,wrap(this.mover.angle-this.yaw))));
    return done;
  }
  // Can he walk there? He follows the floor (as the native AI does along its
  // authored links): it must continue without a gap or a step over 22 units,
  // with nothing at chest height. Swept-box walks catch on the burnt planks
  // and rock clusters littering the tunnels out of the jail.
  walkable(p,q){return flat(p,q)<=300&&(this.game.kinematicLink(p,q,6)||this.physicalWalk(p,q));}
  // A coarse physical walk (4-unit steps with gravity and the hull's
  // step-ups) that fails as soon as he is blocked or drops away.
  physicalWalk(p,q){
    const g=this.game,length=flat(p,q);let at=p.slice(),fall=0;
    for(let i=0;i<Math.ceil(length/4)+20;i++){
      const dx=q[0]-at[0],dy=q[1]-at[1],left=Math.hypot(dx,dy);if(left<4)return Math.abs(at[2]-q[2])<48;
      const step=Math.min(4,left);fall-=800/30;const r=g.collision.step(at,[dx/left*step,dy/left*step,fall/30],HULL);
      if(flat(r.position,at)<step*.3)return false;at=r.position;if(r.grounded)fall=0;if(at[2]<Math.min(p[2],q[2])-80)return false;
    }
    return false;
  }
  // Nodes he can reach on foot from a point, nearest first.
  entries(at){
    const g=this.game;return g.nodes.map((n,i)=>[i,flat(n.origin,at),Math.abs(n.origin[2]-at[2])]).filter(c=>c[1]<256&&c[2]<120&&g.nodes[c[0]].type!==g.negotiationBegin&&g.nodes[c[0]].type!==g.negotiationEnd)
      .sort((a,b)=>a[1]-b[1]).slice(0,6).filter(([i])=>this.walkable(at,g.nodes[i].origin)).map(([i])=>i);
  }
  // A link is shut while a door, barricade or clip that changes it is still
  // solid (the gate states prepared for the zombies); one that only passes
  // beside a closed door stays open.
  open(a,b){
    const g=this.game,row=g.gateNavigation?.get(a+','+b);if(!row)return true;
    const now=row.values[row.targets.reduce((bits,t,i)=>bits|(g.collision.disabled.has(t)?1<<i:0),0)],free=row.values[(1<<row.targets.length)-1];
    return now===free;
  }
  // The authored node graph (sloth uses the zombies' path nodes), gated only
  // by what is still shut. Traversal links are left to the zombies.
  route(target){
    const g=this.game,starts=this.entries(this.position),ends=new Set(this.entries(target));if(!starts.length||!ends.size)return [];
    const costs=new Float64Array(g.nodes.length).fill(Infinity),prev=new Int32Array(g.nodes.length).fill(-1),heap=[];
    const push=(c,i)=>{heap.push([c,i]);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(heap[p][0]<=c)break;heap[k]=heap[p];k=p;}heap[k]=[c,i];};
    const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[k]=heap[c];k=c;}heap[k]=last;}return top;};
    for(const s of starts){costs[s]=flat(this.position,g.nodes[s].origin);push(costs[s],s);}
    let found=-1;
    while(heap.length){const [c,at]=pop();if(c>costs[at])continue;if(ends.has(at)){found=at;break;}
      for(const l of g.nodes[at].links){const n=l.node;if(n>=g.nodes.length||l.negotiation||g.nodes[n].type===g.negotiationBegin||g.nodes[n].type===g.negotiationEnd||g.nodes[at].type===g.negotiationBegin)continue;
        if(!this.open(at,n))continue;const v=c+l.distance;if(v<costs[n]){costs[n]=v;prev[n]=at;push(v,n);}}}
    if(found<0)return [];
    const path=[];for(let i=found;i>=0;i=prev[i])path.unshift(g.nodes[i].origin.slice());
    return [...path,target.slice()];
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
      this.gotBooze=true;this.state='drink';this.play('drinkbooze');this.prop='booze';this.charge=null;
      const b=this.facingBarricade();this.aim=b&&{barricade:b,impact:this.impactPoint(b)};
    }else{this.state='eat';this.play('eatcandy');this.prop='candy';}
  }
  // get_facing_barricade(): within 900, its back toward him, along his
  // backward line (he faces the player) with its approach point within 100
  // units of that line, nearest the line first; failing that, along the
  // player's view with no sideways limit.
  facingBarricade(){
    const g=this.game,search=(origin,forward,sideways)=>{let best=null,bestDistance=Infinity;
      for(const b of this.barricades){if(g.opened.has(b.target)||b.noteworthy==='courtyard_fountain')continue;
        const back=this.barricadeBack(b),at=[b.position[0]-back[0]*CHARGE.approach,b.position[1]-back[1]*CHARGE.approach];
        const d=[at[0]-origin[0],at[1]-origin[1]],length=Math.hypot(...d);if(length>CHARGE.search||length<1)continue;
        if(forward[0]*back[0]+forward[1]*back[1]<.707||(d[0]*back[0]+d[1]*back[1])/length<.707)continue;
        const along=Math.max(0,Math.min(length*2,d[0]*forward[0]+d[1]*forward[1])),off=Math.hypot(d[0]-forward[0]*along,d[1]-forward[1]*along);
        if(sideways&&off>CHARGE.sideways)continue;if(off<bestDistance){bestDistance=off;best=b;}}
      return best;};
    return search(this.position,[-Math.cos(this.yaw),-Math.sin(this.yaw)],true)||search(g.player.position,[Math.cos(g.yaw),Math.sin(g.yaw)],false);
  }
  // The way he runs through a barricade.
  barricadeBack(b){const yaw=b.angles[1]*Math.PI/180;return [-Math.cos(yaw),-Math.sin(yaw)];}
  // Where he aims: the barricade's centre at his floor height, shifted across
  // its face (up to the correction allowance) to where his hull has a clear
  // run up through the opening.
  impactPoint(b){
    const back=this.barricadeBack(b),across=[-back[1],back[0]],z=this.position[2];
    return this.withBarricadesOpen(()=>{
      for(const o of [0,8,-8,16,-16,24,-24,32,-32]){
        const at=[b.position[0]+across[0]*o,b.position[1]+across[1]*o,z],c=[at[0],at[1],z+HULL[2]+4];
        const from=[c[0]-back[0]*128,c[1]-back[1]*128,c[2]],run=this.game.collision.trace(from,[c[0]+back[0]*16,c[1]+back[1]*16,c[2]],HULL,WORLD);
        if(run.fraction===1&&!run.allSolid)return at;
      }
      return [b.position[0],b.position[1],z];
    });
  }
  // His traces ignore the barricades still standing (is_barricade_ent).
  withBarricadesOpen(fn){
    const g=this.game,disabled=g.collision.disabled,added=this.barricades.map(b=>b.target).filter(t=>!g.opened.has(t)&&!disabled.has(t));
    for(const t of added)disabled.add(t);try{return fn();}finally{for(const t of added)disabled.delete(t);}
  }
  // ----- the charge ----------------------------------------------------------
  touching(b,reach=24){
    const points=[[0,0,35],[reach,0,35],[reach,0,70]].map(v=>{const r=rotate(v,this.yaw);return this.position.map((x,k)=>x+r[k]);});
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
  // The charge runs on a fixed line to the chosen impact point. A wall or
  // corner edging into his lane ahead is forgiven by a sideways shift (one
  // side for the whole charge, checked with his hull), and a glancing wall
  // is scraped along; a wall square ahead (within 45 degrees) stops him. Zombies are not solid to him: any his body sweeps through
  // dies and he keeps running.
  tickCharge(dt){
    const g=this.game,c=this.charge;
    if(!c.dir)c.dir=[Math.cos(this.yaw),Math.sin(this.yaw)];
    // His roam walk does not use the hull, so he can start a charge pressed
    // into a wall: run with the widest hull that is free to move.
    if(!c.hull)c.hull=[15,14,13,12,10].map(w=>[w,w,HULL[2]]).find(h=>flat(g.collision.step(this.position,[c.dir[0]*2,c.dir[1]*2,0],h).position,this.position)>1.5)||HULL;
    const hull=c.hull,forward=c.dir,side=[-forward[1],forward[0]];this.yaw=Math.atan2(forward[1],forward[0]);
    const target=c.target&&this.barricades.find(b=>b.target===c.target&&!g.opened.has(b.target));
    for(const b of this.barricades)if(!g.opened.has(b.target)&&this.touching(b)){this.breakBarricade(b);this.crash(true);return;}
    const speed=this.speed('run_berserk'),step=speed*dt,from=this.position.slice();
    const probe=(at,reach,width)=>{const start=[at[0],at[1],at[2]+39];return g.collision.trace(start,[start[0]+forward[0]*reach,start[1]+forward[1]*reach,start[2]],[width,width,1],WORLD);};
    let blocked=false,wall=Infinity;
    this.withBarricadesOpen(()=>{
      // The run still to go: up to the impact point, or just ahead of him.
      const look=Math.max(48,speed*CHARGE.blend*1.2),impact=target&&c.impact,run=impact?Math.max(look,(impact[0]-this.position[0])*forward[0]+(impact[1]-this.position[1])*forward[1]-16):look;
      const ahead=probe(this.position,look,hull[0]),clear=ahead.fraction===1&&(run===look||probe(this.position,run,hull[0]).fraction===1);
      // Something edging into his lane: the smallest sideways shift (within
      // what is left of the allowance) that clears the whole run, failing
      // that the stretch just ahead.
      if(!clear&&!c.pending&&!(ahead.fraction<1&&target&&this.touching(target,look*ahead.fraction+HULL[0]+8))){
        const left=CHARGE.correct-(c.offset||0),centre=[this.position[0],this.position[1],this.position[2]+HULL[2]+2];let near=null,whole=null;
        search:for(let o=4;o<=left;o+=4)for(const s of c.side?[c.side]:[1,-1]){
          const to=this.position.map((v,k)=>k<2?v+side[k]*s*o:v),shift=g.collision.trace(centre,[to[0],to[1],centre[2]],hull,WORLD);
          if(shift.fraction<1||shift.allSolid||probe(to,look,hull[0]).fraction<1)continue;
          near??=[s,o];if(run===look||probe(to,run,hull[0]).fraction===1){whole=[s,o];break search;}
        }
        const pick=whole||(ahead.fraction<1?near:null);if(pick){c.side=pick[0];c.pending=pick[1];c.rate=pick[1]/CHARGE.blend;}
      }
      const front=probe(this.position,48,CHARGE.lane);
      if(front.fraction<1){
        // The barricade he is aimed at (and its frame) is the goal, not a wall.
        if(target&&this.touching(target,48*front.fraction+HULL[0]+8))return;
        const n=front.normal,square=-(n[0]*forward[0]+n[1]*forward[1])/(Math.hypot(n[0],n[1])||1);
        if(square>=CHARGE.square){wall=48*front.fraction;blocked=!c.pending;}}
      if(!blocked){
        const lateral=c.pending?Math.min(c.pending,c.rate*dt):0;if(lateral){c.pending-=lateral;c.offset=(c.offset||0)+lateral;if(c.pending<1e-6)c.pending=0;}
        c.velocityZ-=800*dt;const r=g.collision.step(this.position,[forward[0]*step+side[0]*(c.side||0)*lateral,forward[1]*step+side[1]*(c.side||0)*lateral,c.velocityZ*dt],hull);
        this.position=r.position;if(r.grounded)c.velocityZ=0;
      }
    });
    if(target&&this.touching(target,wall<Infinity?wall+HULL[0]+8:24)){this.runDown(from,this.position,HULL[0]);this.breakBarricade(target);this.crash(true);return;}
    // Zombies his body sweeps through this tick, and on a crash the ones
    // pinned between him and the wall; never through solid world.
    this.runDown(from,this.position,blocked?Math.max(HULL[0],wall):HULL[0]);
    // A player in his path goes down.
    const p=g.player.position,rel=[p[0]-this.position[0],p[1]-this.position[1]],ahead=rel[0]*forward[0]+rel[1]*forward[1];
    if(ahead>0&&ahead<48&&Math.abs(rel[0]*forward[1]-rel[1]*forward[0])<30&&Math.abs(p[2]-this.position[2])<60&&!g.coop?.down)g.damagePlayer(g.player.health);
    // The failsafe: under 30 units in half a second is a crash.
    if(g.time>=c.checkAt){if(flat(this.position,c.checkFrom)<30)blocked=true;c.checkAt=g.time+.5;c.checkFrom=this.position.slice();}
    if(blocked||this.position[2]<c.start[2]-400)this.crash(false);
  }
  // Swept contact: every zombie within body reach of the segment he covered
  // (plus `front` units ahead of it) with nothing solid between them.
  runDown(from,to,front){
    const g=this.game,dir=this.charge?.dir||[Math.cos(this.yaw),Math.sin(this.yaw)];
    const end=[to[0]+dir[0]*front,to[1]+dir[1]*front],seg=[end[0]-from[0],end[1]-from[1]],length2=seg[0]*seg[0]+seg[1]*seg[1];
    for(const e of g.enemies){
      if(e.dead||e.kind==='ghost'||Math.abs(e.position[2]-to[2])>60)continue;
      const t=length2?Math.max(0,Math.min(1,((e.position[0]-from[0])*seg[0]+(e.position[1]-from[1])*seg[1])/length2)):0;
      const near=[from[0]+seg[0]*t,from[1]+seg[1]*t];if(Math.hypot(e.position[0]-near[0],e.position[1]-near[1])>CHARGE.body)continue;
      if(g.collision.trace([near[0],near[1],to[2]+39],[e.position[0],e.position[1],e.position[2]+39],[0,0,0],WORLD).fraction<1)continue;
      this.killZombie(e);
    }
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
      case 'aim':{
        // Turned onto the impact point by the time the run begins.
        const impact=this.aim?.impact,left=(this.clips[this.clip]?.notes?.blend??this.duration(this.clip))-this.age();
        if(impact){const want=Math.atan2(impact[1]-this.position[1],impact[0]-this.position[0]);this.turn(impact,dt,Math.max(4,Math.abs(wrap(want-this.yaw))/Math.max(dt,left)));}
        for(const e of this.hunters())if(flat(e.position,this.position)<MELEE)this.killZombie(e);
        if(this.passed('blend')){
          let dir=[Math.cos(this.yaw),Math.sin(this.yaw)];
          if(impact){const d=[impact[0]-this.position[0],impact[1]-this.position[1]],l=Math.hypot(...d);if(l>1){dir=[d[0]/l,d[1]/l];this.yaw=Math.atan2(dir[1],dir[0]);}}
          this.state='berserk';this.play('run_berserk');
          this.charge={start:this.position.slice(),checkAt:g.time+.5,checkFrom:this.position.slice(),velocityZ:0,dir,target:this.aim?.barricade.target||null,impact:impact?.slice()||null,side:0,offset:0,pending:0,rate:0};
        }
        break;}
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
  saveState(){return {...this.view(),gotBooze:this.gotBooze,protectLeft:Math.max(0,this.protectUntil-this.game.time),charge:this.charge&&{start:this.charge.start,velocityZ:this.charge.velocityZ,dir:this.charge.dir,hull:this.charge.hull,target:this.charge.target,impact:this.charge.impact,side:this.charge.side,offset:this.charge.offset,pending:this.charge.pending,rate:this.charge.rate},crashFrom:this.crashFrom,crashAge:this.crashAge};}
  loadState(s){
    if(!s)return;this.applyView(s);this.gotBooze=!!s.gotBooze;this.protectUntil=this.game.time+(s.protectLeft||0);this.crashFrom=s.crashFrom;this.crashAge=s.crashAge||0;
    this.charge=s.charge?{...s.charge,checkAt:this.game.time+.5,checkFrom:this.position.slice()}:null;
    // Mid-action states that need live targets resume in a safe state.
    if(['attack','player_idle','follow'].includes(this.state))this.state='roam';
    if(this.state==='berserk'&&!this.charge)this.state='roam';
    this.goal=null;this.target=null;this.holding=false;this.pathDue=0;
  }
}
