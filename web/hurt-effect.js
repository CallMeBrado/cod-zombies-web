// Player damage feedback from _gameskill.gsc / _zm_playerhealth.gsc:
// every hit starts a fading blur (startfadingblur 3 over 0.8 s, 3.6 over 2 s
// on first dropping into the red) and the engine's hit_direction arc toward
// the attacker; at 20% health or below overlay_low_health pulses through
// redFlashingOverlay(), restarting on each hit.
const PULSE=.8,LONG_REGEN=5,RED=.2;
// HUD units are 640x480; the damage arc is 128x64, 128 from the centre, for 2 s.
const ARC={width:128,height:64,offset:128,time:2};

// fadeFunc(): one 0.8 s pulse as linear alpha keys after `start`.
function pulse(keys,start,severity,mult){
  const fadeIn=PULSE*.1,stay=PULSE*(.1+severity*.2),half=PULSE*(.1+severity*.1),full=PULSE*.3;
  keys.push([start+fadeIn,mult],[start+fadeIn+stay,mult],[start+fadeIn+stay+half,mult*(.8+severity*.1)],[start+fadeIn+stay+half+full,mult*(.5+severity*.3)]);
  return start+PULSE;
}
function redTimeline(start,alpha){
  const keys=[[start,alpha]];let t=pulse(keys,start,1,1);
  while(t<start+LONG_REGEN)t=pulse(keys,t,.9,1);
  t=pulse(keys,t,.65,.8);t=pulse(keys,t,0,.6);keys.push([t+.5,0]);
  return keys;
}
function sample(keys,t){
  if(!keys.length||t<=keys[0][0])return keys[0]?.[1]??0;
  for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const [a,va]=keys[i-1],[b,vb]=keys[i];return va+(vb-va)*(b>a?(t-a)/(b-a):1);}
  return keys.at(-1)[1];
}

export class HurtEffect {
  constructor({overlay,canvas,view,hudBase,arc='hit_direction',additive=false}){
    this.overlay=overlay;this.view=view;this.additive=additive;
    overlay.style.background=`url("${hudBase}overlay_low_health.png") center/100% 100% no-repeat`;
    this.arc=new Image();this.arc.src=hudBase+arc+'.png';
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.reset();
  }
  reset(){this.red=null;this.blur=null;this.arcs=[];this.wasRed=false;this.overlay.style.opacity='0';this.view.style.filter='';this.ctx?.clearRect(0,0,this.canvas.width,this.canvas.height);this.drawn=false;}
  hit({from,health,max},time,position){
    const ratio=max?health/max:1,entered=ratio<=RED&&!this.wasRed;
    this.blur=entered?{start:time,amount:3.6,duration:2}:{start:time,amount:3,duration:.8};
    if(ratio<=RED){this.red=redTimeline(time,this.alpha(time));this.wasRed=true;}
    if(from&&position)this.arcs.push({start:time,yaw:Math.atan2(from[1]-position[1],from[0]-position[0])});
  }
  alpha(time){return this.red?sample(this.red,time):0;}
  update(time,{health,max,viewYaw}){
    if(max&&health/max>RED&&(!this.red||time>this.red.at(-1)[0]))this.wasRed=false;
    if(this.red&&time>this.red.at(-1)[0])this.red=null;
    this.overlay.style.opacity=String(this.alpha(time));
    const b=this.blur,amount=b&&time<b.start+b.duration?b.amount*(1-(time-b.start)/b.duration):0;
    if(b&&!amount)this.blur=null;
    this.view.style.filter=amount>.01?`blur(${(amount*innerHeight/480).toFixed(2)}px)`:'';
    this.arcs=this.arcs.filter(a=>time<a.start+ARC.time);
    this.draw(time,viewYaw);
  }
  draw(time,viewYaw){
    const c=this.canvas,ctx=this.ctx,dpr=Math.min(2,devicePixelRatio||1),w=Math.round(innerWidth*dpr),h=Math.round(innerHeight*dpr);
    if(!this.arcs.length){if(this.drawn){ctx.clearRect(0,0,c.width,c.height);this.drawn=false;}return;}
    if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
    ctx.clearRect(0,0,w,h);if(!this.arc.complete||!this.arc.naturalWidth)return;
    const unit=h/480;ctx.save();ctx.globalCompositeOperation=this.additive?'lighter':'source-over';
    for(const a of this.arcs){
      // Attacker yaw relative to the view: positive is to the left on screen.
      const rel=a.yaw-viewYaw;ctx.globalAlpha=Math.max(0,1-(time-a.start)/ARC.time);
      ctx.setTransform(1,0,0,1,w/2,h/2);ctx.rotate(-rel);ctx.translate(0,-ARC.offset*unit);
      ctx.drawImage(this.arc,-ARC.width*unit/2,-ARC.height*unit/2,ARC.width*unit,ARC.height*unit);
    }
    ctx.restore();this.drawn=true;
  }
}
