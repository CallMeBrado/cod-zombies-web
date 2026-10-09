import * as THREE from 'three';
// Buried's lighting polish: a small set of dynamic point lights (muzzle
// flashes, the Paralyzer, impacts, flickering lamps) that the lightmapped
// world and the models both read, plus per-surface specular response.
// Every lit surface reads the same uniform objects, so one update per frame
// reaches all of them.
export const DYNAMIC_LIGHTS=8;
export const polishLight={
  enabled:false,
  uniforms:{
    wawDynPos:{value:Array.from({length:DYNAMIC_LIGHTS},()=>new THREE.Vector4(0,0,0,1))},
    wawDynColor:{value:Array.from({length:DYNAMIC_LIGHTS},()=>new THREE.Vector3())},
    wawDynCount:{value:0},
  },
};
export const DYNAMIC_GLSL=`
uniform vec4 wawDynPos[${DYNAMIC_LIGHTS}];uniform vec3 wawDynColor[${DYNAMIC_LIGHTS}];uniform int wawDynCount;
vec3 wawDynamic(vec3 P,vec3 N){
  vec3 sum=vec3(0.);
  for(int i=0;i<${DYNAMIC_LIGHTS};i++){
    if(i>=wawDynCount)break;
    vec3 d=wawDynPos[i].xyz-P;float r=wawDynPos[i].w,dist=length(d),f=clamp(1.-dist*dist/(r*r),0.,1.);
    sum+=wawDynColor[i]*f*f*clamp(dot(N,d/max(dist,.001))*.8+.2,0.,1.);
  }
  return sum;
}`;
// Specular strength, Blinn exponent and metalness (specular tinted by the
// albedo) by what a surface is made of: dry wood and rough stone barely
// shine, metal and glass do.
export function surfaceSpec(name=''){
  const n=name.toLowerCase();
  if(/glass|window|bottle|jar|mirror/.test(n))return [.55,90,0];
  if(/water|puddle|wet|slime|oil/.test(n))return [.45,70,0];
  if(/metal|iron|steel|tin_|_tin|rust|chain|pipe|rail|brass|copper|girder|corrugated|grate|bolt|vending|machine|bell|anvil|cannon|gear|wheel_med|lantern|lamp|sconce|stove|safe/.test(n))return [.4,42,1];
  if(/wood|plank|board|crate|barrel|log|timber|shingle|bark|beam|floor|porch|fence|stair|door|wagon|sign/.test(n))return [.03,7,0];
  if(/rock|stone|brick|concrete|cave|cliff|gravel|dirt|mud|sand|ground|plaster|mortar|mine|tunnel|wall/.test(n))return [.02,4,0];
  return [.04,10,0];
}
// A one-row lookup of surfaceSpec per texture-array layer.
export function specTable(specs){
  const data=new Float32Array(Math.max(1,specs.length)*4);specs.forEach((s,i)=>data.set([...(s||surfaceSpec()),0],i*4));
  const t=new THREE.DataTexture(data,Math.max(1,specs.length),1,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.needsUpdate=true;return t;
}
// Buried's grade: a soft shoulder keeps lamp-lit wood and lantern glass
// detailed instead of clipping, shadows lean cool and highlights warm.
export const POLISH_GRADE=`
  {float luma=dot(outgoingLight,vec3(.2126,.7152,.0722));
  outgoingLight=mix(vec3(luma),outgoingLight,.88);
  vec3 over=max(outgoingLight-.62,0.);outgoingLight=min(outgoingLight,.62)+over/(1.+over*2.1);
  outgoingLight*=mix(vec3(.93,.97,1.05),vec3(1.05,1.,.9),smoothstep(.04,.55,luma));}`;
// Shade a set of polished materials from a baked probe: ambient (plus a
// little of the dominant light) as the material color, the dominant light
// by the surface normal, and a rim scaled up where the place is dark.
// `scale` brightens (the viewmodel's 1.5) and `dir` may be given in another
// space (the viewmodel's camera space).
// Each material's own lighting uniforms. Material.clone() copies userData
// as plain JSON, so a cloned rig material gets fresh uniform objects here.
export function polishUniforms(m){
  const u=m.userData.polish;if(u?.wawProbeDir?.value?.isVector3)return u;
  return m.userData.polish={wawProbeDir:{value:new THREE.Vector3(0,0,1)},wawProbeColor:{value:new THREE.Color(0,0,0)},wawRim:{value:0},wawFx:{value:new THREE.Vector4(0,0,0,0)},wawFxColor:{value:new THREE.Color(0,0,0)}};
}
export function applyProbe(materials,probe,{rim=0,scale=1,dir=probe.direction,floor=0}={}){
  const a=probe.ambient,b=probe.directional,luma=.2126*(a[0]+b[0]*.5)+.7152*(a[1]+b[1]*.5)+.0722*(a[2]+b[2]*.5);
  const r=rim?rim*THREE.MathUtils.clamp(1.15-luma*1.8,.2,1):0;
  for(const m of materials){if(m.userData.fixedLight||!m.color)continue;
    m.color.setRGB(Math.max(floor,(a[0]+b[0]*.3)*scale),Math.max(floor,(a[1]+b[1]*.3)*scale),Math.max(floor,(a[2]+b[2]*.3)*scale));
    const u=m.userData.polish?polishUniforms(m):null;if(u){u.wawProbeDir.value.set(dir[0],dir[1],dir[2]);u.wawProbeColor.value.setRGB(b[0]*.45*scale,b[1]*.45*scale,b[2]*.45*scale);u.wawRim.value=r;}}
}
