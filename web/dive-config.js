// Reconstruction settings from the supplied implementation specification.
// These are calibration parameters, not claims about measured BO1 physics.
// The existing world uses inches: 800 units/s² equals 20.32 m/s².
export const METERS_PER_UNIT=.0254;
export const units=meters=>meters/METERS_PER_UNIT;
export const meters=value=>value*METERS_PER_UNIT;
export const BO1_INPUT_REFERENCE={sprintSeconds:.25,stanceHoldSeconds:.2,ordinaryHoldSeconds:.3,maxApexSeconds:.4};
export const DEFAULT_DIVE_CONFIG={
  launchSpeedMps:6.5,rootRiseMeters:.45,gravityMps2:20.32,touchdownRetention:.7,slideSeconds:.25,movementPauseSeconds:.1,weaponRecoverySeconds:.5,
  airSteeringMps2:0,minimumSprintSpeedMps:.5,bodyBlendSeconds:.125,bodyClearanceMeters:.08,bodyChestRadiusMeters:.12,bodyCompressionMeters:.025,
  cameraTransitionSeconds:.25,launchPitchDegrees:1.5,landingJoltMeters:.03,landingPitchDegrees:3,settleSeconds:.15,cameraRollDegrees:0,
  lookYawLimitDegrees:180,lookPitchLimitDegrees:83,fallDamageMinMeters:1.651,fallDamageMaxMeters:5.08,
  launchMix:.8,landingMix:.85,impactMix:.7,lowImpactMix:.22,slideMix:.4,collisionMix:.65,voiceProfile:'auto'
};
const limits={launchSpeedMps:[1,15],rootRiseMeters:[.05,1.5],gravityMps2:[1,60],touchdownRetention:[0,1],slideSeconds:[.02,1],movementPauseSeconds:[0,1],weaponRecoverySeconds:[0,2],airSteeringMps2:[0,15],minimumSprintSpeedMps:[.1,5],bodyBlendSeconds:[.02,.5],bodyClearanceMeters:[.01,.25],bodyChestRadiusMeters:[.02,.3],bodyCompressionMeters:[0,.08],cameraTransitionSeconds:[.05,.6],launchPitchDegrees:[0,8],landingJoltMeters:[0,.1],landingPitchDegrees:[0,12],settleSeconds:[.05,.5],cameraRollDegrees:[-5,5],lookYawLimitDegrees:[5,180],lookPitchLimitDegrees:[5,83],fallDamageMinMeters:[.5,10],fallDamageMaxMeters:[1,20]};
export function normalizeDiveConfig(input={}){
  const out={...DEFAULT_DIVE_CONFIG};for(const [key,value]of Object.entries(input||{})){if(!Object.hasOwn(out,key))continue;if(key==='voiceProfile'){if(typeof value==='string'&&/^[a-z0-9_-]{1,40}$/i.test(value))out[key]=value;continue;}if(!Number.isFinite(value))continue;const [min,max]=limits[key]||[0,1];out[key]=Math.max(min,Math.min(max,value));}
  out.fallDamageMaxMeters=Math.max(out.fallDamageMinMeters+.1,out.fallDamageMaxMeters);return out;
}
export function configureDive(game,patch){game.diveConfig=normalizeDiveConfig({...game.diveConfig,...patch});return {...game.diveConfig};}
export function predictedDive(config=DEFAULT_DIVE_CONFIG){const velocity=Math.sqrt(2*config.gravityMps2*config.rootRiseMeters),airSeconds=2*velocity/config.gravityMps2,airDistance=config.launchSpeedMps*airSeconds,slideDistance=.5*config.launchSpeedMps*config.touchdownRetention*config.slideSeconds;return {upwardMps:velocity,airSeconds,airDistanceMeters:airDistance,slideDistanceMeters:slideDistance,totalDistanceMeters:airDistance+slideDistance,movementReadySeconds:airSeconds+config.slideSeconds+config.movementPauseSeconds,weaponReadySeconds:airSeconds+config.weaponRecoverySeconds};}
