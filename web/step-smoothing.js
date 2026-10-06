// CoD's movement steps the player up (or down) a stair, ledge or low prop
// instantly; the view then follows smoothly, so the camera glides instead of
// popping (Quake's CG_StepOffset spreads a step over 200 ms, and a new step
// mid-glide adds to what is left). On a staircase the steps come every
// ~60 ms, so a fixed 200 ms glide piled up and left the view a whole step
// behind (low going up, high going down): each glide lasts no longer than the
// time since the previous step, so stairs track within about half a step.
export const STEP_SECONDS=.2,MIN_STEP_SECONDS=.04,MAX_STEP=18.5;
export class StepSmoothing {
  constructor(duration=STEP_SECONDS){this.maxDuration=duration;this.reset();}
  reset(){this.change=0;this.elapsed=Infinity;this.duration=this.maxDuration;this.lastZ=null;this.wasGrounded=false;}
  get offset(){return this.elapsed>=this.duration?0:this.change*(1-this.elapsed/this.duration);}
  // The view offset for this frame, from the player's feet height.
  update(player,dt){
    const z=player.position[2];
    if(this.lastZ!==null){
      const dz=z-this.lastZ;
      if(player.grounded&&this.wasGrounded&&Math.abs(dz)>.25&&Math.abs(dz)<=MAX_STEP){
        const since=this.elapsed;this.change=this.offset-dz;this.elapsed=0;
        this.duration=Math.max(MIN_STEP_SECONDS,Math.min(this.maxDuration,since));
      }else if(Math.abs(dz)>64)this.reset();
    }
    this.elapsed+=dt;this.lastZ=z;this.wasGrounded=!!player.grounded;
    return this.offset;
  }
}
