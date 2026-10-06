const number=(value,fallback)=>value!==''&&value!=null&&Number.isFinite(Number(value))?Number(value):fallback;
export function damageAtRange(definition,distance){
  distance=Math.max(0,number(distance,0));
  const high=Math.max(0,number(definition.damage,0)),low=Math.max(0,number(definition.minDamage,high));
  const near=Math.max(0,number(definition.maxDamageRange,1000)),far=Math.max(near,number(definition.minDamageRange,4000));
  if(distance<=near)return high;if(far===near)return low;
  const t=Math.max(0,Math.min(1,(distance-near)/(far-near)));
  return high+(low-high)*t;
}
export function hitDamage(definition,distance,head,retention=1){
  const multiplier=Math.max(0,number(head?definition.locHead:definition.locTorsoUpper,1));
  const damage=damageAtRange(definition,distance)*multiplier*retention;
  return damage>0?Math.max(1,Math.floor(damage)):0;
}
export function fleshPenetration(definition){
  if(definition.weaponType&&definition.weaponType!=='bullet')return {count:1,retention:1};
  // Native penetration tiers drive this approximation for zombie flesh.
  return {none:{count:1,retention:1},small:{count:4,retention:.85},medium:{count:6,retention:.9},large:{count:8,retention:1}}[definition.penetrateType]||{count:4,retention:.85};
}
export function pelletAngles(count,spread,yaw,pitch,random=Math.random){
  const result=[],rotation=count>1?random()*Math.PI*2:0;
  for(let i=0;i<count;i++){
    // A centered pellet plus distributed inner/outer pellets avoids a whole
    // close blast randomly missing the crosshair. Keep the native cone width.
    const radius=count>1?(i===0?0:(i-.5)/(count-1))*spread:Math.sqrt(random())*spread;
    const angle=count>1?rotation+i*2.399963229728653:random()*Math.PI*2;
    result.push([yaw+Math.cos(angle)*radius/Math.max(.2,Math.cos(pitch)),pitch+Math.sin(angle)*radius]);
  }
  return result;
}

export function raySphere(origin,dir,center,radius,max=Infinity){
  const q=origin.map((v,k)=>v-center[k]),b=q.reduce((n,v,k)=>n+v*dir[k],0),c=q.reduce((n,v)=>n+v*v,0)-radius*radius;
  if(c<=0)return max>0?0:null;const discriminant=b*b-c;if(discriminant<0)return null;
  const t=-b-Math.sqrt(discriminant);return t>=0&&t<max?t:null;
}
export function rayCapsule(origin,dir,a,b,radius,max=Infinity){
  const axis=b.map((v,k)=>v-a[k]),length=Math.hypot(...axis);if(length<1e-6)return raySphere(origin,dir,a,radius,max);
  const u=axis.map(v=>v/length),q=origin.map((v,k)=>v-a[k]),dot=(x,y)=>x.reduce((n,v,k)=>n+v*y[k],0),du=dot(dir,u),qu=dot(q,u);
  const A=1-du*du,B=dot(q,dir)-qu*du,C=dot(q,q)-qu*qu-radius*radius;
  let best=null;
  if(C<=0&&qu>=0&&qu<=length&&max>0)best=0;
  const disc=B*B-A*C;
  if(A>1e-8&&disc>=0)for(const t of [(-B-Math.sqrt(disc))/A,(-B+Math.sqrt(disc))/A]){
    const along=qu+t*du;if(t>=0&&t<max&&along>=0&&along<=length&&(best===null||t<best))best=t;
  }
  for(const point of [a,b]){const t=raySphere(origin,dir,point,radius,max);if(t!==null&&(best===null||t<best))best=t;}
  return best;
}
