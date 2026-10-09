const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
const radians=d=>d*Math.PI/180;
// Soft slowdown and rotational assistance. No ADS snap or automatic firing.
export class ControllerAimAssist {
  constructor(){this.reset();}
  reset(){this.clock=0;this.scanDue=0;this.targetId=null;this.slowdown=1;this.rotation=[0,0];}
  adjust({yaw,pitch,yawDelta=0,pitchDelta=0,dt=0,origin,targets=[],pointFor=e=>e.torsoPosition||[e.position[0],e.position[1],e.position[2]+42],visible=()=>false,active=false,enabled=true,strength=.75,ads=0,lookMagnitude=0,moveMagnitude=0}){
    const unchanged={yaw:yawDelta,pitch:pitchDelta};
    dt=clamp(dt,0,.1);strength=clamp(strength,0,1);ads=clamp(ads,0,1);
    if(!active||!enabled||!strength||!origin?.every(Number.isFinite)){this.reset();return unchanged;}
    this.clock+=dt;this.slowdown=1;this.rotation=[0,0];
    const geometry=e=>{
      if(e.dead||e.visible===false)return null;const point=pointFor(e);if(!point?.every(Number.isFinite))return null;
      const d=point.map((v,k)=>v-origin[k]),range=Math.hypot(...d);if(range<20||range>1800)return null;
      const x=angle(Math.atan2(d[1],d[0])-yaw),y=Math.atan2(d[2],Math.hypot(d[0],d[1]))-pitch;
      const rx=Math.min(radians(14),radians(5-ads*1.5)+Math.atan(14/range)),ry=Math.min(radians(18),radians(4-ads)+Math.atan(22/range));
      const score=(x/rx)**2+(y/ry)**2;if(score>1)return null;
      return {e,point,range,x,y,score};
    };
    let target=targets.find(e=>e.id===this.targetId),g=target&&geometry(target);
    if(this.clock>=this.scanDue||this.targetId!==null&&!g){
      this.scanDue=this.clock+.08;const candidates=targets.map(geometry).filter(Boolean).sort((a,b)=>(a.score-(a.e.id===this.targetId ? .15 : 0))-(b.score-(b.e.id===this.targetId ? .15 : 0)));
      g=null;for(const candidate of candidates.slice(0,3))if(visible(origin,candidate.point,candidate.e)){g=candidate;break;}
      this.targetId=g?.e.id??null;
    }
    if(!g)return unchanged;
    const weight=(1-Math.sqrt(g.score))*strength,escape=clamp((lookMagnitude-.65)/.35,0,1);
    this.slowdown=1-weight*(.4+.25*ads)*(1-.8*escape);
    const rotating=(moveMagnitude>.08||lookMagnitude>.08)&&lookMagnitude<.85;
    if(rotating){
      const blend=1-Math.exp(-(2+ads*2)*weight*dt),limit=(.35+.3*ads)*strength*dt;
      this.rotation=[clamp(g.x*blend,-limit,limit),clamp(g.y*blend,-limit,limit)];
    }
    return {yaw:yawDelta*this.slowdown+this.rotation[0],pitch:pitchDelta*this.slowdown+this.rotation[1]};
  }
  diagnostics(){return {targetId:this.targetId,slowdown:this.slowdown,rotation:this.rotation.slice()};}
}
