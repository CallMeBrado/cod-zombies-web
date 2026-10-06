// T4 angles are pitch/yaw/roll; Z-up Three.js uses roll/-pitch/yaw.
// The authored switch is off. Its native script changes roll by -90 in 0.3 s.
export function powerSwitchRotation(angles,powered,time,startedAt){
  const [pitch,yaw,roll]=(angles||'0 0 0').split(/\s+/).map(Number);
  const fraction=powered?(startedAt==null?1:Math.max(0,Math.min(1,(time-startedAt)/.3))):0,r=Math.PI/180;
  return [(roll-90*fraction)*r,-pitch*r,yaw*r];
}
