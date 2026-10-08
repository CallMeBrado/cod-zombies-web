// Initial IW7 exploration physics. Render triangles are a temporary collision
// source while the native Havok world and scriptable blockers are being ported.
export class SpacelandMovement {
  constructor(trace,spawn){this.trace=trace;this.spawn=[...spawn];this.position=[...spawn];this.vz=0;this.grounded=false;this.noclip=false;}
  reset(){this.position=[...this.spawn];this.vz=0;this.grounded=false;}
  ground(at,above=20,below=80){const hit=this.trace([at[0],at[1],at[2]+above],[0,0,-1],above+below);return hit&&hit.normal[2]>.45?at[2]+above-hit.distance:null;}
  step(dt,{forward=0,right=0,yaw=0,sprint=false,jump=false,vertical=0}={}){
    const speed=sprint?260:190,mag=Math.hypot(forward,right),scale=mag>1?1/mag:1;
    const dx=(Math.cos(yaw)*forward+Math.sin(yaw)*right)*speed*dt*scale,dy=(Math.sin(yaw)*forward-Math.cos(yaw)*right)*speed*dt*scale;
    if(this.noclip){this.position[0]+=dx;this.position[1]+=dy;this.position[2]+=vertical*speed*dt;this.vz=0;return;}
    const moveAxis=(axis,amount)=>{
      if(!amount)return;const sign=Math.sign(amount),direction=[0,0,0];direction[axis]=sign;
      let blocked=false;
      for(const z of [20,43,65])for(const side of [-12,0,12]){
        const origin=[...this.position];origin[2]+=z;origin[1-axis]+=side;
        const hit=this.trace(origin,direction,Math.abs(amount)+14);
        if(hit&&hit.normal[2]<.45){blocked=true;break;}
      }
      if(!blocked)this.position[axis]+=amount;
    };
    moveAxis(0,dx);moveAxis(1,dy);
    if(jump&&this.grounded){this.vz=250;this.grounded=false;}
    const oldZ=this.position[2];this.vz-=800*dt;this.position[2]+=this.vz*dt;
    const floor=this.ground([this.position[0],this.position[1],Math.max(oldZ,this.position[2])],18,Math.max(40,oldZ-this.position[2]+2));
    if(floor!==null&&this.vz<=0&&this.position[2]<=floor+.1){this.position[2]=floor+.05;this.vz=0;this.grounded=true;}
    else this.grounded=false;
    if(!this.position.every(Number.isFinite)||this.position[2]<-16000)this.reset();
  }
}
