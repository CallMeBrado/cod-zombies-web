// Player stances use the classic CoD view heights and body bounds. NPC
// navigation continues to use the standing hull, independently of these.
export const STANCES={stand:{view:60,half:[14,14,35],speed:1},crouch:{view:40,half:[14,14,25],speed:.65},prone:{view:11,half:[14,14,15],speed:.15}};
import {BO1_INPUT_REFERENCE,normalizeDiveConfig,units,meters} from './dive-config.js';
// Recorded input timings are independent; trajectory/presentation defaults
// are configurable reconstructions from the supplied implementation details.
export const DIVE={hold:BO1_INPUT_REFERENCE.stanceHoldSeconds,stanceHold:BO1_INPUT_REFERENCE.ordinaryHoldSeconds,startup:BO1_INPUT_REFERENCE.sprintSeconds};
const stance=g=>STANCES[g.player.stance]||STANCES.stand;
export const playerHull=g=>{if(!g.dive)return stance(g).half;const t=Math.min(1,Math.max(0,(g.time-g.dive.started)/g.dive.config.bodyBlendSeconds)),blend=t*t*(3-2*t);return [14,14,35+(15-35)*blend];};
export const playerView=g=>{const current=g.viewHeightCurrent??stance(g).view,previous=g.viewHeightPrevious??current;return previous+(current-previous)*Math.min(1,(g.accumulator??1/120)*120);};
export const playerSpeed=g=>stance(g).speed;
export const playerBusy=g=>!!g.dive||!!g.diveRecovery||g.time<(g.stanceReadyAt||0);
export function resetMovement(g){g.player.stance='stand';g.viewHeightCurrent=60;g.viewHeightPrevious=60;g.stanceReadyAt=0;g.stanceChangedAt=0;g.stanceHold=null;g.dive=null;g.diveRecovery=null;g.lastDive=null;g.nextDiveId=1;g.movementSession=(g.movementSession||0)+1;g.diveConfig??=normalizeDiveConfig(g.data.playerMovement?.dive);g.sprintStartedAt=null;g.groundedAt=undefined;g.jumpStanceBlocked=false;g.sprintStanceBlocked=false;g.lastMoveSpeed=0;g.horizontalVelocity=[0,0];}
export function restoreMovement(g,s){g.player.stance=Object.hasOwn(STANCES,s)?s:'stand';g.viewHeightCurrent=stance(g).view;g.viewHeightPrevious=g.viewHeightCurrent;g.dive=null;g.diveRecovery=null;g.stanceHold=null;}
function fits(g,name){
  const p=g.player.position,h=STANCES[name].half;
  const t=g.collision.trace([p[0],p[1],p[2]+h[2]+.03],[p[0],p[1],p[2]+h[2]+.03],[h[0]-.03,h[1]-.03,h[2]-.03]);return !t.allSolid;
}
export function changeStance(g,name,{toggle=true,dive=true}={}){
  if(!Object.hasOwn(STANCES,name)||['ready','dead'].includes(g.phase)||g.dive||g.mods?.noclip||g.mapRules?.reviveDue)return false;
  if(toggle&&g.player.stance===name)name='stand';
  if(name==='prone'&&dive&&g.data.game==='black-ops'&&g.sprinting&&startDive(g))return true;
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
    const sprintHold=hold.sprint&&g.data.game==='black-ops';
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
export function startDive(g){
  const config=normalizeDiveConfig(g.diveConfig);
  if(g.data.game!=='black-ops'||g.player.health<=0||g.dive||g.diveRecovery||g.player.stance!=='stand'||!g.player.grounded||!g.sprinting||g.sprintStartedAt===null||g.time-g.sprintStartedAt<DIVE.startup-1e-9||meters(g.lastMoveSpeed)<config.minimumSprintSpeedMps||g.gesture||g.switching||g.pendingGrenade||g.reloadEnd||g.pendingMelee)return false;
  const direction=(g.horizontalVelocity||[Math.cos(g.yaw),Math.sin(g.yaw)]).slice(),length=Math.hypot(...direction);if(!length)return false;for(let i=0;i<2;i++)direction[i]/=length;
  const speed=units(config.launchSpeedMps),p=g.player,id=g.nextDiveId++;
  const report={id,session:g.movementSession,takeoffPosition:p.position.slice(),started:g.time,peakRootRiseMeters:0,touchdownDistanceMeters:null,finalStopDistanceMeters:null,airborneSeconds:null,slideSeconds:0,movementReadySeconds:null,weaponReadySeconds:null,launchEvents:0,landingEvents:0,collisionEvents:0,configuration:{...config},calibrated:false};
  g.dive={id,phase:'air',started:g.time,phaseAt:g.time,origin:p.position.slice(),direction,yaw:Math.atan2(direction[1],direction[0]),velocity:direction.map(v=>v*speed),config,report,startView:playerView(g),sequence:0,loop:false,landingAt:null};g.lastDive=report;
  p.stance='prone';g.stanceChangedAt=g.time;p.grounded=false;p.velocityZ=units(Math.sqrt(2*config.gravityMps2*config.rootRiseMeters));
  g.sprinting=false;g.sprintStanceBlocked=true;g.sprintStartedAt=null;g.pendingFire=false;report.launchEvents++;emitDive(g,g.dive,'launch');g.emit('dive',{phase:'in',duration:g.weapon.definition.dtpInTime||.08});return true;
}
function emitDive(g,d,type,extra={}){g.emit('diveEvent',{id:d.id,session:g.movementSession,sequence:d.sequence++,type,at:g.time,position:g.player.position.slice(),character:g.character??0,config:d.config,...extra});}
function surface(g,p,normal){return g.events.contactSurface?.(p,normal)||'default';}
function collisionEvent(g,d,hit){if(g.time-(d.collisionAt??-Infinity)<.15)return;d.collisionAt=g.time;d.report.collisionEvents++;emitDive(g,d,'collision',{normal:hit.normal,surface:surface(g,g.player.position,hit.normal)});}
function land(g,d,at,normal){
  const c=d.config,p=g.player;d.phase='slide';d.phaseAt=at;d.landingAt=at;d.surface=surface(g,p.position,normal);d.slideVelocity=d.velocity.map(v=>v*c.touchdownRetention);d.velocity=d.slideVelocity.slice();p.velocityZ=0;p.grounded=true;
  if(d.report.airborneSeconds===null){d.report.airborneSeconds=at-d.started;d.report.touchdownDistanceMeters=meters(Math.hypot(p.position[0]-d.origin[0],p.position[1]-d.origin[1]));}
  d.report.landingEvents++;g.diveRecovery={id:d.id,session:g.movementSession,due:at+c.weaponRecoverySeconds,at,config:c,yaw:d.yaw,report:d.report};
  emitDive(g,d,'landing',{surface:d.surface,normal,landingAt:at});emitDive(g,d,'slideStart',{surface:d.surface,speedMps:meters(Math.hypot(...d.velocity))});g.emit('dive',{phase:'out',duration:c.weaponRecoverySeconds});
  const drop=meters(d.origin[2]-p.position[2]);if(drop>c.fallDamageMinMeters)g.damagePlayer(Math.min(100,(drop-c.fallDamageMinMeters)/(c.fallDamageMaxMeters-c.fallDamageMinMeters)*100));
}
function slide(g,d,from,to){
  if(to<=from)return;const c=d.config,t0=Math.max(0,from-d.phaseAt),t1=Math.min(c.slideSeconds,to-d.phaseAt),a=Math.min(1,t0/c.slideSeconds),b=Math.min(1,t1/c.slideSeconds),dt=Math.max(0,t1-t0);
  const delta=d.slideVelocity.map(v=>v*(1-(a+b)/2)*dt),p=g.player,h=playerHull(g),center=[p.position[0],p.position[1],p.position[2]+h[2]],hit=g.collision.trace(center,[center[0]+delta[0],center[1]+delta[1],center[2]],h),moved=g.collision.step(p.position,[...delta,0],h),floor=g.groundBelow(moved.position);p.position=floor||moved.position;p.grounded=!!floor;
  if(floor)d.surface=surface(g,p.position,[0,0,1]);
  if(hit.fraction<1&&hit.normal[2]<.65){collisionEvent(g,d,hit);const inward=d.slideVelocity[0]*hit.normal[0]+d.slideVelocity[1]*hit.normal[1];if(inward<0){d.slideVelocity[0]-=hit.normal[0]*inward;d.slideVelocity[1]-=hit.normal[1]*inward;}}
  d.velocity=d.slideVelocity.map(v=>v*(1-b));emitDive(g,d,'slideUpdate',{surface:d.surface,speedMps:meters(Math.hypot(...d.velocity))});
  if(!floor){emitDive(g,d,'slideStop',{surface:d.surface});d.phase='air';d.phaseAt=g.time;p.velocityZ=0;return;}
  if(to-d.phaseAt>=c.slideSeconds-1e-9){emitDive(g,d,'slideStop',{surface:d.surface});d.report.slideSeconds+=c.slideSeconds;d.report.finalStopDistanceMeters=meters(Math.hypot(p.position[0]-d.origin[0],p.position[1]-d.origin[1]));d.phase='pause';d.phaseAt+=c.slideSeconds;d.velocity=[0,0];}
}
export function updateDiveRecovery(g){const r=g.diveRecovery;if(r&&g.time>=r.due-1e-9){r.report.weaponReadySeconds=g.time-r.report.started;g.diveRecovery=null;}}
export function moveDive(g,dt,input={}){
  const d=g.dive;if(!d)return false;const p=g.player,w=g.weapon.definition,c=d.config,begin=g.time-dt;g.sprinting=false;g.moving=d.phase!=='pause';
  if(d.phase==='air'){
    if(!d.loop&&g.time-d.started>=(w.dtpInTime||.08)){d.loop=true;g.emit('dive',{phase:'loop'});}
    if(c.airSteeringMps2){const forward=input.forward||0,side=input.side||0,a=units(c.airSteeringMps2)*dt;d.velocity[0]+=(Math.cos(g.yaw)*forward+Math.sin(g.yaw)*side)*a;d.velocity[1]+=(Math.sin(g.yaw)*forward-Math.cos(g.yaw)*side)*a;}
    const gravity=units(c.gravityMps2),dz=p.velocityZ*dt-.5*gravity*dt*dt;p.velocityZ-=gravity*dt;
    const delta=[d.velocity[0]*dt,d.velocity[1]*dt,dz],h=playerHull(g),from=[p.position[0],p.position[1],p.position[2]+h[2]],hit=g.collision.trace(from,from.map((v,i)=>v+delta[i]),h),moved=g.collision.move(p.position,delta,h);p.position=moved.position;p.grounded=moved.grounded;
    d.report.peakRootRiseMeters=Math.max(d.report.peakRootRiseMeters,meters(p.position[2]-d.origin[2]));
    if(hit.fraction<1&&hit.normal[2]<.65){collisionEvent(g,d,hit);if(hit.normal[2]<-.65)p.velocityZ=Math.min(0,p.velocityZ);const inward=d.velocity[0]*hit.normal[0]+d.velocity[1]*hit.normal[1];if(inward<0){d.velocity[0]-=hit.normal[0]*inward;d.velocity[1]-=hit.normal[1]*inward;}}
    // Only a walkable contact is landing. An all-solid/wall trace never plays
    // a landing grunt or starts the weapon-ready timer on its own.
    if(p.grounded){let at=g.time,normal=hit.normal;if(hit.fraction<1&&normal[2]>.65){at=begin+dt*hit.fraction;p.position=[hit.end[0],hit.end[1],hit.end[2]-h[2]];}else normal=[0,0,1];land(g,d,at,normal);slide(g,d,at,g.time);}
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
