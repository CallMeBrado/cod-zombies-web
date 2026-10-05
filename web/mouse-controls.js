// Mouse events report each button transition, including left/right button chords.
export class MouseControls {
  constructor(canvas,document,{mode,fire,buttons=b=>b===0?['fire']:b===2?['aim']:[],now=()=>performance.now()}) {
    this.mode=mode;this.fireShot=fire;this.buttons=buttons;this.now=now;this.reset();
    canvas.addEventListener('mousedown',event=>this.down(event));
    document.addEventListener('mouseup',event=>this.up(event));
    canvas.addEventListener('contextmenu',event=>event.preventDefault());
  }
  reset(){this.left=false;this.right=false;this.fireButton=null;this.dragging=false;this.firing=false;this.distance=0;this.fired=false;this.due=Infinity;}
  shoot(){this.fireShot();this.fired=true;this.firing=true;}
  down(event){
    const mode=this.mode(),actions=this.buttons(event.button);if(!mode.playing||!actions.some(a=>['fire','aim'].includes(a)))return;
    event.preventDefault();event.currentTarget?.focus?.();
    if(actions.includes('aim')){this.right=true;if(this.left&&!this.fired)this.shoot();return;}
    if(this.left)return;
    this.left=true;this.fireButton=event.button;this.distance=0;this.fired=false;this.dragging=mode.inputMode==='drag';
    if(this.dragging&&!this.right&&!mode.aiming)this.due=this.now()+180;else this.shoot();
  }
  up(event){
    if(this.buttons(event.button).includes('aim')){this.right=false;if(this.dragging&&!this.mode().aiming)this.firing=false;return;}
    if(event.button!==this.fireButton)return;
    if(this.mode().playing&&this.left&&this.dragging&&this.distance<4&&!this.fired)this.fireShot();
    this.left=false;this.fireButton=null;this.dragging=false;this.firing=false;this.due=Infinity;
  }
  move(dx,dy){if(this.dragging){this.distance+=Math.hypot(dx,dy);if(this.distance>=4&&!this.right&&!this.mode().aiming)this.firing=false;}}
  update(time){if(this.mode().playing&&this.dragging&&this.left&&this.distance<4&&!this.fired&&time>=this.due)this.shoot();}
}
