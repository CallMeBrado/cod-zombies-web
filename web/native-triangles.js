const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
// Native XModel collision stores a face plane plus two barycentric planes.
// n·p=plane.w, s·p=s.w+u, t·p=t.w+v for (u,v)=(0,0),(1,0),(0,1).
export function nativeCollisionTriangle([n,s,t]) {
  const columns=[cross(s,t),cross(t,n),cross(n,s)],det=n[0]*columns[0][0]+n[1]*columns[0][1]+n[2]*columns[0][2];
  if(Math.abs(det)<1e-12)return null;
  return [[0,0],[1,0],[0,1]].map(([u,v])=>[0,1,2].map(k=>(columns[0][k]*n[3]+columns[1][k]*(s[3]+u)+columns[2][k]*(t[3]+v))/det));
}
