export const INTERACTION_REACH=60;
export const REPAIR_REACH=60;
export function useDistance(position,target){return Math.hypot(target[0]-position[0],target[1]-position[1],target[2]-(position[2]+35));}
export function facingUse(position,target,yaw=0){const dx=target[0]-position[0],dy=target[1]-position[1],length=Math.hypot(dx,dy);return length<12||(dx*Math.cos(yaw)+dy*Math.sin(yaw))/length>.25;}
export function canReachUse(position,target,yaw){return useDistance(position,target)<INTERACTION_REACH&&facingUse(position,target,yaw);}
export function repairPoint(window){
  if(window.repairPoint)return window.repairPoint;
  const points=window.boardEntities?.filter(e=>e.origin).map(e=>e.origin.split(/\s+/).map(Number))||[];
  return window.repairPoint=points.length?[0,1,2].map(k=>points.reduce((sum,p)=>sum+p[k],0)/points.length):[...window.entry.slice(0,2),window.entry[2]+35];
}
