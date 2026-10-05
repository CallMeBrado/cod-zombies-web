const radians=Math.PI/180;

// Keep the reticle centered on the aim point; move its arms with the weapon's
// hip-fire cone. Use simulation time so settling and cooking freeze on pause.
export class CrosshairHud {
  constructor(){this.game=null;this.time=0;this.spread=0;}
  state(game,ads=0,verticalFov=65) {
    const d=game.weapon.definition;
    const moving=game.moving||!game.player.grounded;
    const target=Math.min(d.hipSpreadMax||6,(d.hipSpreadStandMin||0)+
      (game.spreadBloom||0)+(moving?d.hipSpreadMoveAdd||0:0));
    if(this.game!==game||game.time<this.time){this.game=game;this.spread=target;this.time=game.time;}
    const dt=Math.max(0,game.time-this.time);this.time=game.time;
    this.spread+=(target-this.spread)*(1-Math.exp(-12*dt));
    const projection=240/Math.tan(Math.max(20,Math.min(120,verticalFov))*radians/2);
    let gap=Math.max(5,Math.tan(this.spread*radians)*projection),alpha=(1-ads)*.8;
    const grenade=game.pendingGrenade;
    const cooking=!!(grenade?.cookable&&grenade.cooking&&game.time>=grenade.holdEnd&&game.time<grenade.due);
    if(cooking){
      const pulse=(1-Math.cos((game.time-grenade.holdEnd)*Math.PI*2))/2;
      gap=6+4*pulse;alpha=.65+.35*pulse;
    }
    return {gap,alpha,cooking};
  }
}
