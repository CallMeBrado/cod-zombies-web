// Black Ops dive-to-prone, in world units (inches) and seconds. The physics
// values are BlackOps.exe's own: the dtp_* dvar defaults and the launch,
// apex and slide code in bg_pmove.
//  - Launch: the sprint's horizontal velocity is kept and the upward speed is
//    a normal 39-unit jump's, sqrt(2*gravity*39), times dtp_new_trajectory_multiplier (2).
//  - dtp_new_trajectory: once 39 units above the takeoff the player holds that
//    height until dtp_max_apex_duration (400 ms) after launch, then falls.
//  - Landing: no ground friction for dtp_max_slide_duration (300 ms), then the
//    velocity stops and movement waits dtp_post_move_pause (100 ms).
//  - A dive needs dtp_startup_delay (250 ms) of sprinting and
//    dtp_exhaustion_window (1500 ms) since the last dive ended.
// The camera and body values are presentation settings, not original data.
export const METERS_PER_UNIT=.0254;
export const units=meters=>meters/METERS_PER_UNIT;
export const meters=value=>value*METERS_PER_UNIT;
// cl_dtpHoldTime (200 ms) and cl_stanceHoldTime (300 ms) are the controller
// hold times for a dive and for ordinary prone.
export const BO1_INPUT_REFERENCE={sprintSeconds:.25,stanceHoldSeconds:.2,ordinaryHoldSeconds:.3};
export const DEFAULT_DIVE_CONFIG={
  jumpHeight:39,trajectoryMultiplier:2,maxApexSeconds:.4,gravity:800,slideSeconds:.3,slideAdditionSeconds:0,movementPauseSeconds:.1,
  startupSeconds:.25,exhaustionSeconds:1.5,minSpeed:3.16,fallDamageMinHeight:65,fallDamageMaxHeight:200,weaponRecoverySeconds:null,
  bodyBlendSeconds:.125,bodyClearanceMeters:.08,bodyChestRadiusMeters:.12,bodyCompressionMeters:.025,
  cameraTransitionSeconds:.25,launchPitchDegrees:1.5,landingJoltMeters:.03,landingPitchDegrees:3,settleSeconds:.15,cameraRollDegrees:0,
  lookYawLimitDegrees:180,lookPitchLimitDegrees:83,
  launchMix:.8,landingMix:.85,impactMix:.7,lowImpactMix:.22,slideMix:.4,collisionMix:.65,voiceProfile:'auto'
};
const limits={jumpHeight:[1,200],trajectoryMultiplier:[0,10],maxApexSeconds:[0,10],gravity:[50,3000],slideSeconds:[0,10],slideAdditionSeconds:[0,10],movementPauseSeconds:[0,1],
  startupSeconds:[0,10],exhaustionSeconds:[0,10],minSpeed:[0,1000],fallDamageMinHeight:[0,1000],fallDamageMaxHeight:[0,1000],weaponRecoverySeconds:[0,2],
  bodyBlendSeconds:[.02,.5],bodyClearanceMeters:[.01,.25],bodyChestRadiusMeters:[.02,.3],bodyCompressionMeters:[0,.08],cameraTransitionSeconds:[.05,.6],
  launchPitchDegrees:[0,8],landingJoltMeters:[0,.1],landingPitchDegrees:[0,12],settleSeconds:[.05,.5],cameraRollDegrees:[-5,5],lookYawLimitDegrees:[5,180],lookPitchLimitDegrees:[5,83]};
export function normalizeDiveConfig(input={}){
  const out={...DEFAULT_DIVE_CONFIG};
  for(const [key,value]of Object.entries(input||{})){
    if(!Object.hasOwn(out,key))continue;
    if(key==='voiceProfile'){if(typeof value==='string'&&/^[a-z0-9_-]{1,40}$/i.test(value))out[key]=value;continue;}
    if(key==='weaponRecoverySeconds'&&value===null){out[key]=null;continue;}
    if(!Number.isFinite(value))continue;const [min,max]=limits[key]||[0,1];out[key]=Math.max(min,Math.min(max,value));
  }
  out.fallDamageMaxHeight=Math.max(out.fallDamageMinHeight+1,out.fallDamageMaxHeight);return out;
}
export function configureDive(game,patch){game.diveConfig=normalizeDiveConfig({...game.diveConfig,...patch});return {...game.diveConfig};}
// Flat-ground path for a dive launched at `speed` units/s.
export function predictedDive(config=DEFAULT_DIVE_CONFIG,speed=285,outTime=.25){
  const c=normalizeDiveConfig(config),up=Math.sqrt(2*c.gravity*c.jumpHeight)*(c.trajectoryMultiplier||1);
  // Rise to the apex height (or the natural peak), hold until the apex timer, fall.
  const peak=up*up/(2*c.gravity),height=Math.min(c.jumpHeight,peak),rise=(up-Math.sqrt(Math.max(0,up*up-2*c.gravity*height)))/c.gravity;
  const airSeconds=peak>c.jumpHeight?rise+Math.max(0,c.maxApexSeconds-rise)+Math.sqrt(2*height/c.gravity):2*up/c.gravity,slideSeconds=c.slideSeconds+c.slideAdditionSeconds;
  return {upwardSpeed:up,apexHeight:height,airSeconds,airDistance:speed*airSeconds,slideDistance:speed*slideSeconds,totalDistance:speed*(airSeconds+slideSeconds),
    totalDistanceMeters:meters(speed*(airSeconds+slideSeconds)),movementReadySeconds:airSeconds+slideSeconds+c.movementPauseSeconds,weaponReadySeconds:airSeconds+(c.weaponRecoverySeconds??outTime)};
}
