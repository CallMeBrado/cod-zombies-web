// The in-game half of co-op (tools/lobby-api.mjs `net`). Each browser in a
// running match exchanges with the server about 25 times a second: it sends
// its own player state and queued events (the host also sends its world
// snapshot), and receives the other players' latest states, the newest host
// snapshot and its events, which arrive in order and exactly once.
const lerp=(a,b,t)=>a+(b-a)*t;
const angle=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
const ANGLES=new Set(['yaw','pitch','diveYaw']);
function mix(a,b,t){
  if(typeof a==='number'&&typeof b==='number')return lerp(a,b,t);
  if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every(Number.isFinite))return a.map((v,i)=>lerp(v,b[i],t));
  return t<.5?a:b;
}
export function blendState(a,b,t){
  const out={...b};for(const key of Object.keys(b))if(key in a)out[key]=ANGLES.has(key)&&typeof a[key]==='number'?angle(a[key],b[key],t):mix(a[key],b[key],t);return out;
}
// Timed samples from another clock: keeps the clock offset and returns the
// state at a fixed delay behind the newest, interpolated between samples.
export class Timeline {
  constructor(limit=40){this.samples=[];this.limit=limit;this.offset=null;}
  push(t,value,now=performance.now()){
    if(!Number.isFinite(t)||this.samples.length&&t<=this.samples.at(-1).t)return false;
    // The smallest observed (arrival - send) is the best clock offset estimate;
    // let it relax slowly so a single late packet cannot pin it.
    const offset=now-t;this.offset=this.offset===null||offset<this.offset?offset:this.offset+(offset-this.offset)*.02;
    this.samples.push({t,value});if(this.samples.length>this.limit)this.samples.shift();return true;
  }
  latest(){return this.samples.at(-1)?.value??null;}
  sample(delay=100,now=performance.now()){
    const s=this.samples;if(!s.length)return null;if(s.length===1||this.offset===null)return s.at(-1).value;
    const t=now-this.offset-delay;if(t<=s[0].t)return s[0].value;if(t>=s.at(-1).t)return s.at(-1).value;
    let i=1;while(i<s.length-1&&s[i].t<t)i++;const a=s[i-1],b=s[i];return blendState(a.value,b.value,(t-a.t)/((b.t-a.t)||1));
  }
}
export class NetSession {
  constructor(map,id,{interval=40,snapshotInterval=66,state=()=>null,snapshot=null,onEvent=()=>{},onSnapshot=()=>{},onPlayers=()=>{},onHostLost=()=>{},fetch:fetcher=(...a)=>fetch(...a),now=()=>performance.now(),base=''}={}){
    Object.assign(this,{map,id,interval,snapshotInterval,state,snapshot,onEvent,onSnapshot,onPlayers,onHostLost,fetcher,now,base});
    this.outbox=[];this.ack=0;this.snapSeq=0;this.players=new Map();this.timelines=new Map();this.running=false;this.lastSnapshot=-Infinity;this.stateSeq=0;this.failures=0;this.hostLost=false;
  }
  start(){if(this.running)return this;this.running=true;this.loop();return this;}
  stop(){this.running=false;clearTimeout(this.timer);}
  send(to,msg){this.outbox.push({to,msg});}
  async loop(){
    if(!this.running)return;const began=this.now();
    try{await this.exchange();this.failures=0;}catch{this.failures++;}
    if(this.running)this.timer=setTimeout(()=>this.loop(),Math.max(0,this.interval-(this.now()-began))+(this.failures?Math.min(1000,this.failures*100):0));
  }
  async exchange(){
    const events=this.outbox.splice(0),now=this.now(),body={ack:this.ack,snapSeq:this.snapSeq,events};
    const state=this.state();if(state)body.state={...state,t:now,seq:++this.stateSeq};
    if(this.snapshot&&now-this.lastSnapshot>=this.snapshotInterval){const snap=this.snapshot();if(snap){body.snap={...snap,t:now};this.lastSnapshot=now;}}
    let response;
    try{response=await this.fetcher(`${this.base||''}/api/lobby/${this.map}/${this.id}/net`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});}
    catch(error){this.outbox.unshift(...events);throw error;}
    if(!response.ok){this.outbox.unshift(...events);throw new Error('Relay '+response.status);}
    this.receive(await response.json());
  }
  receive(value,now=this.now()){
    const seen=new Set();
    for(const p of value.players||[]){
      seen.add(p.id);let record=this.players.get(p.id);
      if(!record){record={id:p.id};this.players.set(p.id,record);this.timelines.set(p.id,new Timeline());}
      Object.assign(record,{slot:p.slot,character:p.character,present:p.present,status:p.status});
      if(p.state&&(record.state?.seq??-1)<p.state.seq){record.state=p.state;this.timelines.get(p.id).push(p.state.t,p.state,now);}
    }
    for(const id of [...this.players.keys()])if(!seen.has(id)){this.players.delete(id);this.timelines.delete(id);}
    this.onPlayers(this.players);
    if(value.snap&&value.snap.seq>this.snapSeq){this.snapSeq=value.snap.seq;this.onSnapshot(value.snap.data,now);}
    for(const e of value.events||[])if(e.seq>this.ack){this.ack=e.seq;this.onEvent(e.from,e.msg);}
    if(value.hostPresent===false&&!this.hostLost){this.hostLost=true;this.onHostLost();}
  }
  // Another player's state, drawn a little behind its newest sample.
  sample(id,delay=100){return this.timelines.get(id)?.sample(delay,this.now())??null;}
}
