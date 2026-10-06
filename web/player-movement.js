// Player stances use the classic CoD view heights and body bounds. NPC
// navigation continues to use the standing hull, independently of these.
export const STANCES={stand:{view:60,half:[14,14,35],speed:1},crouch:{view:40,half:[14,14,25],speed:.65},prone:{view:11,half:[14,14,15],speed:.15}};
import {BO1_INPUT_REFERENCE,normalizeDiveConfig,units} from './dive-config.js';
// Controller hold times (cl_dtpHoldTime, cl_stanceHoldTime) and dtp_startup_delay.
export const DIVE={hold:BO1_INPUT_REFERENCE.stanceHoldSeconds,stanceHold:BO1_INPUT_REFERENCE.ordinaryHoldSeconds,startup:BO1_INPUT_REFERENCE.sprintSeconds};
const stance=g=>STANCES[g.player.stance]||STANCES.stand;
export const playerHull=g=>{if(!g.dive)return stance(g).half;const t=Math.min(1,Math.max(0,(g.time-g.dive.started)/g.dive.config.bodyBlendSeconds)),blend=t*t*(3-2*t);return [14,14,35+(15-35)*blend];};
export const playerView=g=>{const current=g.viewHeightCurrent??stance(g).view,previous=g.viewHeightPrevious??current;return previous+(current-previous)*Math.min(1,(g.accumulator??1/120)*120);};
export const playerSpeed=g=>stance(g).speed*(g.data.game==='black-ops-2'&&g.mapRules?.perks.has('specialty_longersprint')?1.07:1);
export const playerBusy=g=>!!g.dive||!!g.diveRecovery||g.time<(g.stanceReadyAt||0);
export function resetMovement(g){g.player.stance='stand';g.viewHeightCurrent=60;g.viewHeightPrevious=60;g.stanceReadyAt=0;g.stanceChangedAt=0;g.stanceHold=null;g.dive=null;g.diveRecovery=null;g.lastDive=null;g.diveEndedAt=-Infinity;g.nextDiveId=1;g.movementSession=(g.movementSession||0)+1;g.diveConfig??=normalizeDiveConfig(g.data.playerMovement?.dive);g.sprintStartedAt=null;g.groundedAt=undefined;g.jumpStanceBlocked=false;g.sprintStanceBlocked=false;g.lastMoveSpeed=0;g.horizontalVelocity=[0,0];}
export function restoreMovement(g,s){g.player.stance=Object.hasOwn(STANCES,s)?s:'stand';g.viewHeightCurrent=stance(g).view;g.viewHeightPrevious=g.viewHeightCurrent;g.dive=null;g.diveRecovery=null;g.diveEndedAt=-Infinity;g.stanceHold=null;}
function fits(g,name){
  const p=g.player.position,h=STANCES[name].half;
  const t=g.collision.trace([p[0],p[1],p[2]+h[2]+.03],[p[0],p[1],p[2]+h[2]+.03],[h[0]-.03,h[1]-.03,h[2]-.03]);return !t.allSolid;
}
export function changeStance(g,name,{toggle=true,dive=true}={}){
  if(!Object.hasOwn(STANCES,name)||['ready','dead'].includes(g.phase)||g.dive||g.mods?.noclip||g.mapRules?.reviveDue)return false;
  if(toggle&&g.player.stance===name)name='stand';
  if(name==='prone'&&dive&&['black-ops','black-ops-2'].includes(g.data.game)&&g.sprinting&&startDive(g))return true;
  if(name==='prone'&&!g.player.grounded)return false;
  if(STANCES[name].half[2]>playerHull(g)[2]&&!fits(g,name)){g.message('Cannot '+(name==='stand'?'stand':'crouch')+' here');return false;}
  const previous=g.player.stance;g.player.stance=name;g.stanceChangedAt=g.time;if(name!=='stand')g.sprintStanceBlocked=true;g.sprinting=false;g.sprintStartedAt=null;
  if(previous==='prone'||name==='prone')g.stanceReadyAt=g.time+.25;
  g.emit('stance',{stance:name});return true;
}
export function stanceButton(g){if(!g.dive&&!g.stanceHold)g.stanceHold={at:g.time,sprint:g.sprinting,handled:false};}
export function releaseStance(g,cancel=false){const hold=g.stanceHold;g.stanceHold=null;if(!cancel&&hold&&!hold.handled)changeStance(g,'crouch');}
export function movementInput(g,input,dt){
  updateDiveRecovery(g);
  if(g.mods?.noclip)return input;
  if(!input.jump)g.jumpStanceBlocked=false;
  const hold=g.stanceHold;
  if(hold&&!hold.handled){
    const sprintHold=hold.sprint&&['black-ops','black-ops-2'].includes(g.data.game);
    // The stance hold and sprint eligibility run concurrently. A qualifying
    // held request waits for the remaining sprint time rather than dropping
    // into ordinary prone just before the sprint becomes eligible.
    const awaitingSprint=sprintHold&&g.sprinting&&g.sprintStartedAt!==null&&g.time-g.sprintStartedAt<DIVE.startup-1e-9;
    if(g.time-hold.at>=(sprintHold?DIVE.hold:DIVE.stanceHold)-1e-9&&!awaitingSprint){hold.handled=true;changeStance(g,'prone');}
  }
  if(input.jump&&g.player.stance!=='stand'&&!g.dive){changeStance(g,'stand',{toggle:false});g.jumpStanceBlocked=true;}
  // Stand/Jump raises the player first; holding it must not immediately jump.
  if(g.jumpStanceBlocked)input={...input,jump:false};
  if(input.sprint&&!g.sprintStanceBlocked&&input.forward>0&&g.player.stance!=='stand'&&!g.dive)changeStance(g,'stand',{toggle:false});
  g.viewHeightPrevious=g.viewHeightCurrent;
  const desired=stance(g).view;if(g.dive){const t=Math.min(1,(g.time-g.dive.started)/g.dive.config.cameraTransitionSeconds),blend=t*t*(3-2*t);g.viewHeightCurrent=g.dive.startView+(desired-g.dive.startView)*blend;}else{const delta=desired-g.viewHeightCurrent;g.viewHeightCurrent+=Math.sign(delta)*Math.min(Math.abs(delta),240*dt);}
  return input;
}
export function movementFrame(g,input){if(!input.jump)g.jumpStanceBlocked=false;if(!input.sprint)g.sprintStanceBlocked=false;}
export function movementEnd(g,dt){
  if(g.sprinting){if(g.sprintStartedAt===null)g.sprintStartedAt=g.time-dt;}else g.sprintStartedAt=null;
  const p=g.player.position,from=g.player.previousPosition;g.horizontalVelocity=[(p[0]-from[0])/dt,(p[1]-from[1])/dt];g.lastMoveSpeed=Math.hypot(...g.horizontalVelocity);
  // Lowered camera transitions cannot peek through a ceiling on entering cover.
  const desired=stance(g).view;if(g.viewHeightCurrent>desired){const start=[p[0],p[1],p[2]+desired],end=[p[0],p[1],p[2]+g.viewHeightCurrent],t=g.collision.trace(start,end,[1,1,1],1);if(t.fraction<1)g.viewHeightCurrent=Math.max(desired,t.end[2]-p[2]);}
}
// PM_CheckDive / the dive launch: sprinting for dtp_startup_delay, moving
// faster than dtp_min_speed and dtp_exhaustion_window after the last dive.
// The sprint's horizontal velocity carries the dive; only the upward speed is set.
export function startDive(g){
  const c=normalizeDiveConfig(g.diveConfig),p=g.player,velocity=(g.horizontalVelocity||[0,0]).slice(),speed=Math.hypot(...velocity);
  if(!['black-ops','black-ops-2'].includes(g.data.game)||p.health<=0||g.dive||g.diveRecovery||p.stance!=='stand'||!p.grounded||!g.sprinting||g.sprintStartedAt===null||g.time-g.sprintStartedAt<c.startupSeconds-1e-9||speed<=c.minSpeed||g.time-g.diveEndedAt<=c.exhaustionSeconds||g.gesture||g.switching||g.pendingGrenade||g.reloadEnd||g.pendingMelee)return false;
  const direction=velocity.map(v=>v/speed),id=g.nextDiveId++;
  const report={id,session:g.movementSession,takeoffPosition:p.position.slice(),started:g.time,launchSpeed:speed,peakRise:0,touchdownDistance:null,finalStopDistance:null,airborneSeconds:null,slideSeconds:0,movementReadySeconds:null,weaponReadySeconds:null,launchEvents:0,landingEvents:0,collisionEvents:0,configuration:{...c}};
  g.dive={id,phase:'air',started:g.time,phaseAt:g.time,origin:p.position.slice(),launchZ:p.position[2],direction,yaw:Math.atan2(direction[1],direction[0]),velocity,launchSpeed:speed,config:c,report,startView:playerView(g),sequence:0,loop:false,landingAt:null};g.lastDive=report;
  p.stance='prone';g.stanceChangedAt=g.time;p.grounded=false;p.velocityZ=Math.sqrt(2*c.gravity*c.jumpHeight)*(c.trajectoryMultiplier||1);
  g.sprinting=false;g.sprintStanceBlocked=true;g.sprintStartedAt=null;g.pendingFire=false;report.launchEvents++;emitDive(g,g.dive,'launch');g.emit('dive',{phase:'in',duration:g.weapon.definition.dtpInTime||.15});return true;
}
function emitDive(g,d,type,extra={}){g.emit('diveEvent',{id:d.id,session:g.movementSession,sequence:d.sequence++,type,at:g.time,position:g.player.position.slice(),character:g.character??0,config:d.config,launchSpeed:d.launchSpeed,...extra});}
function surface(g,p,normal){return g.events.contactSurface?.(p,normal)||'default';}
function collisionEvent(g,d,hit){if(g.time-(d.collisionAt??-Infinity)<.15)return;d.collisionAt=g.time;d.report.collisionEvents++;emitDive(g,d,'collision',{normal:hit.normal,surface:surface(g,g.player.position,hit.normal)});}
const flatDistance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// Remove the part of a horizontal velocity driving into a wall.
function clip(velocity,normal){const inward=velocity[0]*normal[0]+velocity[1]*normal[1];if(inward<0){velocity[0]-=normal[0]*inward;velocity[1]-=normal[1]*inward;}}
function land(g,d,at,normal,impactSpeed){
  const c=d.config,p=g.player;d.phase='slide';d.phaseAt=at;d.landingAt=at;d.surface=surface(g,p.position,normal);p.velocityZ=0;p.grounded=true;
  if(d.report.airborneSeconds===null){d.report.airborneSeconds=at-d.started;d.report.touchdownDistance=flatDistance(p.position,d.origin);}
  d.report.landingEvents++;g.diveRecovery={id:d.id,session:g.movementSession,due:at+(c.weaponRecoverySeconds??(g.weapon.definition.dtpOutTime||.25)),at,config:c,yaw:d.yaw,report:d.report};
  emitDive(g,d,'landing',{surface:d.surface,normal,landingAt:at});emitDive(g,d,'slideStart',{surface:d.surface,speed:Math.hypot(...d.velocity)});g.emit('dive',{phase:'out',duration:g.diveRecovery.due-at});
  // Dive fall damage: the height fallen (from the impact speed) between
  // dtp_fall_damage_min_height and _max_height scales 0-100% of health.
  const fallen=impactSpeed*impactSpeed/(2*c.gravity);
  if(fallen>c.fallDamageMinHeight)g.damagePlayer(Math.round(Math.min(1,(fallen-c.fallDamageMinHeight)/(c.fallDamageMaxHeight-c.fallDamageMinHeight))*(g.mapRules?.maxHealth||100)));
}
function endDive(g,d){d.report.finalStopDistance=flatDistance(g.player.position,d.origin);d.phase='pause';d.velocity=[0,0];g.diveEndedAt=g.time;}
// The landing slide: no ground friction for dtp_max_slide_duration, then the
// velocity is cleared. Walls clip it; running out of floor falls again.
function slide(g,d,from,to){
  const c=d.config,length=c.slideSeconds+c.slideAdditionSeconds,dt=Math.max(0,Math.min(to,d.phaseAt+length)-from);
  if(dt>0){
    const p=g.player,h=playerHull(g),delta=[d.velocity[0]*dt,d.velocity[1]*dt],center=[p.position[0],p.position[1],p.position[2]+h[2]],hit=g.collision.trace(center,[center[0]+delta[0],center[1]+delta[1],center[2]],h),moved=g.collision.step(p.position,[...delta,0],h),floor=g.groundBelow(moved.position);
    p.position=floor||moved.position;p.grounded=!!floor;if(floor)d.surface=surface(g,p.position,[0,0,1]);
    if(hit.fraction<1&&hit.normal[2]<.65){collisionEvent(g,d,hit);clip(d.velocity,hit.normal);}
    emitDive(g,d,'slideUpdate',{surface:d.surface,speed:Math.hypot(...d.velocity)});
    if(!floor){emitDive(g,d,'slideStop',{surface:d.surface});d.phase='air';d.phaseAt=g.time;p.velocityZ=0;return;}
  }
  const stopped=Math.hypot(...d.velocity)<=c.minSpeed;
  if(stopped||to-d.phaseAt>=length-1e-9){emitDive(g,d,'slideStop',{surface:d.surface});d.report.slideSeconds+=Math.min(length,to-d.phaseAt);endDive(g,d);d.phaseAt=g.time;}
}
export function updateDiveRecovery(g){const r=g.diveRecovery;if(r&&g.time>=r.due-1e-9){r.report.weaponReadySeconds=g.time-r.report.started;g.diveRecovery=null;}}
// The dive's height over one step: the launch rise, the apex hold at the jump
// height until dtp_max_apex_duration, then the fall. Returns the height
// change and where the last ballistic stretch began, for solving touchdown.
function verticalStep(d,c,p,t0,t1){
  const g=c.gravity,top=d.launchZ+c.jumpHeight,apexEnd=d.started+c.maxApexSeconds;
  let t=t0,z=p.position[2],v=p.velocityZ,at=t0,offset=0,base=z,from=v;
  for(let i=0;i<4&&t<t1;i++){
    if(d.holding){if(t1<=apexEnd){v=0;t=t1;break;}d.holding=false;t=Math.max(t,apexEnd);v=0;}
    if(!d.released&&v>0&&t<apexEnd){
      const rise=top-z,root=v*v-2*g*rise;
      if(rise<=0){z=top;d.holding=true;continue;}
      if(root>=0){const cross=(v-Math.sqrt(root))/g;if(t+cross<=t1&&t+cross<apexEnd){z=top;t+=cross;v=0;d.holding=true;continue;}}
    }
    if(t>=apexEnd)d.released=true;
    at=t;offset=z-base;from=v;const tau=t1-t;z+=v*tau-.5*g*tau*tau;v-=g*tau;t=t1;
    // After the apex timer the player only falls once at the jump height.
    if(d.released&&z>=top&&v>0)v=0;
  }
  p.velocityZ=v;return {dz:z-base,at,offset,v:from};
}
export function moveDive(g,dt,input={}){
  const d=g.dive;if(!d)return false;const p=g.player,w=g.weapon.definition,c=d.config,begin=g.time-dt;g.sprinting=false;g.moving=d.phase!=='pause';
  if(d.phase==='air'){
    if(!d.loop&&g.time-d.started>=(w.dtpInTime||.15)){d.loop=true;g.emit('dive',{phase:'loop'});}
    const fall=verticalStep(d,c,p,begin,g.time),h=playerHull(g);
    const delta=[d.velocity[0]*dt,d.velocity[1]*dt,fall.dz],from=[p.position[0],p.position[1],p.position[2]+h[2]],hit=g.collision.trace(from,from.map((v,i)=>v+delta[i]),h),moved=g.collision.move(p.position,delta,h);
    const start=p.position.slice();p.position=moved.position;p.grounded=moved.grounded;
    if(hit.fraction<1&&hit.normal[2]<.65){collisionEvent(g,d,hit);if(hit.normal[2]<-.65){p.velocityZ=Math.min(0,p.velocityZ);d.holding=false;}clip(d.velocity,hit.normal);}
    d.report.peakRise=Math.max(d.report.peakRise,p.position[2]-d.launchZ);
    // Only a walkable contact is landing. An all-solid/wall trace never plays
    // a landing grunt or starts the weapon-ready timer on its own. The
    // touchdown time is solved on the fall's own curve, so every frame rate
    // lands at the same moment and place.
    if(p.grounded&&p.velocityZ<=0){
      let at=g.time,normal=[0,0,1],impact=-p.velocityZ;
      if(hit.fraction<1&&hit.normal[2]>.65){
        // Traces stop .03 units short of a surface; solve for the surface itself.
        normal=hit.normal;const rise=p.position[2]-.03/normal[2]-(start[2]+fall.offset),root=fall.v*fall.v-2*c.gravity*rise;
        const tau=root>=0?Math.min(g.time-fall.at,Math.max(0,(fall.v+Math.sqrt(root))/c.gravity)):g.time-fall.at;
        at=fall.at+tau;impact=c.gravity*tau-fall.v;const back=g.time-at;
        const landed=g.collision.move(p.position,[-d.velocity[0]*back,-d.velocity[1]*back,0],h);if(!landed.allSolid)p.position=landed.position;
      }
      land(g,d,at,normal,Math.max(0,impact));slide(g,d,at,g.time);
    }
  }else if(d.phase==='slide')slide(g,d,begin,g.time);
  if(d.phase==='pause'&&g.time>=d.phaseAt+c.movementPauseSeconds-1e-9){d.report.movementReadySeconds=g.time-d.started;emitDive(g,d,'movementReady');g.dive=null;g.moving=false;}
  return true;
}
export function divePresentation(g,time=g.time){
  const d=g.dive,r=g.diveRecovery,report=d?.report||r?.report||g.lastDive,c=d?.config||r?.config||report?.configuration||g.diveConfig||normalizeDiveConfig();
  const start=report?.started??-Infinity,elapsed=Math.max(0,time-start),launch=d&&elapsed<c.bodyBlendSeconds?Math.sin(elapsed/c.bodyBlendSeconds*Math.PI):0,landing=d?.landingAt??r?.at,settle=landing!=null&&time>=landing?time-landing:Infinity,envelope=settle<c.settleSeconds?(1-settle/c.settleSeconds)**2:0;
  return {yaw:d?.yaw??r?.yaw??g.yaw,bodyBlend:d?Math.min(1,elapsed/c.bodyBlendSeconds):g.player.stance==='prone'?1:0,compressionMeters:c.bodyCompressionMeters*envelope,cameraOffsetUnits:envelope?-units(c.landingJoltMeters)*envelope:0,cameraPitchRadians:(-c.launchPitchDegrees*launch+c.landingPitchDegrees*envelope)*Math.PI/180,cameraRollRadians:c.cameraRollDegrees*Math.PI/180*launch,phase:d?.phase||(r?'recover':g.player.stance),airborne:d?.phase==='air',config:c};
}
export function stanceSpread(g){const d=g.weapon.definition,key=g.player.stance==='prone'?'Prone':g.player.stance==='crouch'?'Ducked':'Stand';return {min:d['hipSpread'+key+'Min']??d.hipSpreadStandMin??0,max:d['hipSpread'+key+'Max']??d.hipSpreadMax??6};}
