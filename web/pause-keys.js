// Escape can release browser pointer lock before its keydown reaches the game.
// Count that release and its keydown as one pause, and keep resume from asking
// for pointer lock while Escape is still held (the browser would release it).
export class PauseKeys {
  constructor(now=()=>performance.now()){this.now=now;this.reset();}
  reset(){this.held=false;this.nativePauseAt=-Infinity;}
  nativePause(){this.nativePauseAt=this.now();}
  down(repeat=false){
    if(repeat||this.held)return false;
    this.held=true;return this.now()-this.nativePauseAt>=100;
  }
  up(){this.held=false;this.nativePauseAt=-Infinity;}
  get canCaptureMouse(){return !this.held;}
}
