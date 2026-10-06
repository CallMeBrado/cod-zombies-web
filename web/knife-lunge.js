export const KNIFE_CHARGE_RANGE=128;
export const KNIFE_STOP_RANGE=40;
export const KNIFE_HIT_RANGE=95;
const CONE=Math.cos(35*Math.PI/180),HEIGHT=32,MAX_SPEED=600;
export const meleeValue=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
const horizontal=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const clear=(g,e)=>{
  const p=g.player.position;return g.collision.trace([p[0],p[1],p[2]+40],[e.position[0],e.position[1],e.position[2]+40],[0,0,0],1).fraction>=.999;
};
const visible=(g,e,range,cone)=>{
  if(e.dead||Math.abs(e.position[2]-g.player.position[2])>HEIGHT)return false;
  const p=g.player.position,length=horizontal(p,e.position);if(length>range)return false;
  return (!length||((e.position[0]-p[0])*Math.cos(g.yaw)+(e.position[1]-p[1])*Math.sin(g.yaw))/length>=cone)&&clear(g,e);
};

// T5's native knife supplies a 128-unit charge range. T4 uses that conservative
// fallback with its own native stick animation and charge timing.
export function chooseKnifeLunge(game){
  if(!game.player.grounded||Math.abs(game.pitch)>Math.PI/3||game.mapRules?.reviveDue)return null;
  const range=meleeValue(game.weapon.definition.meleeChargeRange,KNIFE_CHARGE_RANGE);
  let target=null,nearest=range+1;
  for(const e of game.enemies){
    // Window/vault actors stay behind the player clips; knife them from where
    // the player is standing rather than pulling the player into a barrier.
    if(e.stage&&e.stage!=='hunt'||!visible(game,e,range,CONE))continue;
    const distance=horizontal(game.player.position,e.position);if(distance<=KNIFE_STOP_RANGE+8)continue;
    if(distance<nearest){target=e;nearest=distance;}
  }
  return target?{target,range,travel:0,maxTravel:Math.max(0,range-KNIFE_STOP_RANGE),origin:game.player.position.slice(),weapon:game.weapon,stopped:false}:null;
}

export function moveKnifeLunge(game,dt,input){
  const pending=game.pendingMelee;if(!pending)return false;
  if(game.gesture||game.switching||game.pendingGrenade||game.reloadEnd||game.mapRules?.reviveDue){pending.cancelled=true;if(pending.lunge)pending.lunge.stopped=true;return false;}
  const s=pending.lunge;if(!s||s.stopped)return false;
  const p=game.player;
  if(s.weapon!==game.weapon||!p.grounded||Math.abs(game.pitch)>Math.PI/3||input.jump||(input.forward||0)<0||horizontal(p.position,s.origin)>s.range||!game.enemies.includes(s.target)||!visible(game,s.target,s.range,CONE)){
    s.stopped=true;return false;
  }
  const distance=horizontal(p.position,s.target.position),remaining=Math.max(0,distance-KNIFE_STOP_RANGE);
  if(remaining<.05){s.stopped=true;return false;}
  const timeLeft=Math.max(dt,pending.due-game.time+dt),amount=Math.min(remaining,MAX_SPEED*dt,remaining/timeLeft*dt,s.maxTravel-s.travel);
  if(amount<=.001){s.stopped=true;return false;}
  const from=p.position,dx=(s.target.position[0]-from[0])/distance*amount,dy=(s.target.position[1]-from[1])/distance*amount;
  // Use the same native hull and stair sweeps as normal movement. A charge is
  // bounded movement, never a teleport or an exception to player collision.
  const result=game.collision.step(from,[dx,dy,0]);p.position=result.position;
  const moved=horizontal(from,result.position);s.travel+=moved;if(moved<amount*.2)s.stopped=true;
  if(moved>.001){
    const yaw=Math.atan2(s.target.position[1]-p.position[1],s.target.position[0]-p.position[0]),turn=Math.atan2(Math.sin(yaw-game.yaw),Math.cos(yaw-game.yaw));
    const pitch=Math.atan2(s.target.position[2]+56-p.position[2]-60,horizontal(p.position,s.target.position));
    game.yaw+=Math.max(-5*dt,Math.min(5*dt,turn));game.pitch+=Math.max(-2.5*dt,Math.min(2.5*dt,pitch-game.pitch));game.emit('meleeAim',{yaw:game.yaw,pitch:game.pitch});
  }
  return true;
}

export function knifeHitValid(game,enemy){
  return game.enemies.includes(enemy)&&visible(game,enemy,KNIFE_HIT_RANGE,.55)&&Math.abs(game.pitch)<=Math.PI/3;
}
