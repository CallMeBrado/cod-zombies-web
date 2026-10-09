import {BlackOps2Engine} from './bo2-engine.js';
export class TownEngine extends BlackOps2Engine {
  constructor(...args){super(...args);this.engine='black-ops-t6-town';}
  // Native pavement seams need a probe larger than a slow walker's sub-unit
  // physics tick. Sweep the longer segment, then evaluate its floor plane at
  // the requested position; the actor still travels at its animation speed.
  kinematicStep(from,to){
    const step=super.kinematicStep(from,to);if(step)return step;
    const dx=to[0]-from[0],dy=to[1]-from[1],length=Math.hypot(dx,dy);if(!length||length>=1)return null;
    return this.collision.actor(()=>{
      const probe=[from[0]+dx/length,from[1]+dy/length],chest=this.collision.trace([from[0],from[1],from[2]+40],[probe[0],probe[1],from[2]+40],[6,6,12]);if(chest.fraction<1)return null;
      const floor=this.collision.trace([probe[0],probe[1],from[2]+22],[probe[0],probe[1],from[2]-48],[0,0,0]);if(floor.fraction===1||floor.allSolid||floor.normal[2]<.5)return null;
      const z=floor.end[2]+((floor.end[0]-to[0])*floor.normal[0]+(floor.end[1]-to[1])*floor.normal[1])/floor.normal[2];
      return [to[0],to[1],z];
    });
  }
  tickEnemy(e,dt){
    super.tickEnemy(e,dt);if(e.dead||e.stage!=='hunt')return;
    const players=this.coop?.playerPositions()||[this.player.position],far=players.every(p=>Math.hypot(...e.position.map((v,k)=>v-p[k]))>130),progress=e.townProgress;
    if(!far||!progress||Math.hypot(...e.position.map((v,k)=>v-progress.position[k]))>12)e.townProgress={at:this.time,position:e.position.slice()};
    else if(this.time-progress.at>10){
      // Retry an authored spawn when dense native rubble strands a hull.
      // Retain its health and round slot, and release its barrier queue.
      e.dead=true;e.deathTime=this.time;this.recycleHealth.push(e.health);this.remaining++;
      if(e.window){e.window.attackers=e.window.attackers?.map(x=>x===e?null:x);if(e.window.traverser===e)e.window.traverser=null;}
      this.emit('removeEnemy',e);
    }
  }
}
