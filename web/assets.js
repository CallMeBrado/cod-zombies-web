import * as THREE from 'three';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {assetData,assetResponse} from './preload.js';
import {BakedLightSamples} from './baked-light.js';
import {selectedMap} from './maps.js';
import {BulletTrace} from './bullet-trace.js';
import {decodeKinoLightmap} from './bo1-lighting.js';
import {decodeBC5} from './bo2-textures.js';
import {nativeDiffuse} from './native-material.js';
const mapChoice=selectedMap(),assetZones=mapChoice.assetZones||[...new Set([mapChoice.zone,'common','nacht'])];

const dds=new DDSLoader(), textures=new Map(), models=new Map();
export async function get(url,json=false) {
  return assetData(url,json);
}
function decode(buffer) {
  const bc5=decodeBC5(buffer);if(bc5){const t=new THREE.DataTexture(bc5.pixels,bc5.width,bc5.height);t.minFilter=THREE.LinearFilter;return t;}
  const h=new DataView(buffer),flags=h.getUint32(80,true);
  if(flags&4) {
    const p=dds.parse(buffer,true);if(!p.width||!p.mipmaps?.length)throw new Error('Unsupported DDS');
    const t=new THREE.CompressedTexture(p.mipmaps,p.width,p.height,p.format);t.minFilter=p.mipmaps.length>1?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;return t;
  }
  const w=h.getUint32(16,true),height=h.getUint32(12,true),bits=h.getUint32(88,true),bytes=bits/8;
  if(![8,16,24,32].includes(bits)||buffer.byteLength<128+w*height*bytes)throw new Error('Invalid DDS');
  const masks=[92,96,100,104].map(o=>h.getUint32(o,true));
  const channel=(v,m,f)=>{if(!m)return f;let s=0;while(((m>>>s)&1)===0)s++;return Math.round(((v&m)>>>s)*255/(m>>>s));};
  const pixels=new Uint8Array(w*height*4);
  for(let i=0;i<w*height;i++) {
    let v=0;for(let b=0;b<bytes;b++)v|=h.getUint8(128+i*bytes+b)<<(b*8);
    const lum=flags&0x20000?channel(v,masks[0]||255,0):null;
    for(let c=0;c<3;c++)pixels[i*4+c]=lum??channel(v,masks[c],255);
    pixels[i*4+3]=channel(v,masks[3]||((flags&2)?255:0),255);
  }
  const t=new THREE.DataTexture(pixels,w,height);t.minFilter=THREE.LinearFilter;return t;
}
async function textureUrl(url) {
  url=url.replace('/images/,','/images/');
  if(!textures.has(url))textures.set(url,(async()=>{
    if(/\/\$identitynormalmap\.dds$/i.test(url)){
      const t=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1);t.colorSpace=THREE.NoColorSpace;t.needsUpdate=true;return t;
    }
    const t=decode(await get(url));t.name=decodeURIComponent(url);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;
  })().catch(error=>{textures.delete(url);throw error;}));
  return textures.get(url);
}
export const originalTexture=textureUrl;
async function diffuse(name) {
  if(!name)return null;
  for(const zone of assetZones)try{return await textureUrl(`/data/${zone}/images/${encodeURIComponent(name.replace(/^,/,''))}.dds`);}catch{}
  throw new Error('Original texture unavailable: '+name);
}
function film(shader) {
  if(mapChoice.game==='black-ops-2'){
    shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',`
      float luma=dot(outgoingLight,vec3(.2126,.7152,.0722));
      outgoingLight=mix(vec3(luma),outgoingLight,.90)*vec3(1.035,1.,.94);
      gl_FragColor.rgb=outgoingLight;
      #include <tonemapping_fragment>`);return;
  }
  if(mapChoice.game==='black-ops'){
    // Kino's own zombie_theater.vision saturation, contrast and tint values.
    shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',`
      float luma=dot(outgoingLight,vec3(.2126,.7152,.0722));
      outgoingLight=mix(vec3(luma),outgoingLight,vec3(.6737,.7509,.6105));
      outgoingLight=mix(vec3(.8843,.9473,1.0106),vec3(.9996,.9996,1.0101),smoothstep(.182469,.463125,luma))*outgoingLight;
      outgoingLight=max(vec3(0.),(outgoingLight-.18)*1.0176+.18)*.5;
      gl_FragColor.rgb=outgoingLight;
      #include <tonemapping_fragment>`);return;
  }
  // Recovered zombie.vision: 40% desaturation, cool shadows, light tint 2.
  shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',`
    float luma=dot(outgoingLight,vec3(.2126,.7152,.0722));
    outgoingLight=mix(outgoingLight,vec3(luma),.4)*mix(vec3(.84,.92,1.10),vec3(2.),clamp(luma,0.,1.))*.65;
    gl_FragColor.rgb=outgoingLight;
    #include <tonemapping_fragment>`);
}
export function shadeModel(object,color) {
  object.traverse(node=>{if(!node.isMesh)return;
    const convert=old=>{const foliage=/tree|pine|foliage|grass/i.test(old.name);const mat=new THREE.MeshBasicMaterial({map:old.map,color:new THREE.Color(...color),vertexColors:!!node.geometry.attributes.color,
      transparent:old.transparent,depthWrite:old.depthWrite,opacity:old.opacity,alphaTest:foliage?.3:old.alphaTest,side:foliage?THREE.DoubleSide:old.side,
      blending:old.blending,blendSrc:old.blendSrc,blendDst:old.blendDst,visible:old.visible});mat.name=old.name;
      mat.userData.fixedLight=/zombie.*eye/.test(old.name);if(mat.userData.fixedLight)mat.color.setRGB(1,1,1);
      else if(old.userData.heatGlow)heatGlowing(mat,old.userData.heatGlow);
      else if(old.userData.glowMap)glowing(mat,old.userData.glowMap,old.userData.glowAmount);else mat.onBeforeCompile=film;return mat;};
    node.material=Array.isArray(node.material)?node.material.map(convert):convert(node.material);
  });
}
// T6 phong_emissive surfaces (the cell key, lamps, sconces, lit windows) add
// their Glow_Map, scaled by the material's hdrAmount and Emissive_Push, on top
// of the lit diffuse; it is not dimmed by the surrounding light.
function glowing(mat,map,amount){
  mat.userData.glow={map,amount};mat.customProgramCacheKey=()=>'t6-glow';
  mat.onBeforeCompile=shader=>{
    shader.uniforms.t6Glow={value:map};shader.uniforms.t6GlowAmount={value:amount};
    shader.fragmentShader='uniform sampler2D t6Glow; uniform float t6GlowAmount;\n'+shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight+=texture2D(t6Glow,vMapUv).rgb*t6GlowAmount;\n#include <opaque_fragment>');
    film(shader);
  };
}
// T6 ember-glow weapon materials (the Paralyzer, Ray Gun Mark II): the lines
// of EmberGlow_Reveal_Map glow in Cold_Color, shifting toward Hot_Color as the
// weapon heats (weaponHeat, 0-1, set each frame from the held weapon). Its
// authored HDR strength (Emissiver_Amount 20) blooms in the game; here the
// colour is normalised so the lines stay bright without washing out white.
export const weaponHeat={value:0};
function heatGlowing(mat,{map,cold,hot,amount}){
  mat.customProgramCacheKey=()=>'t6-heat-glow';
  mat.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{t6Glow:{value:map},t6Cold:{value:new THREE.Vector3(...cold)},t6Hot:{value:new THREE.Vector3(...hot)},t6Heat:weaponHeat,t6GlowAmount:{value:amount}});mat.userData.t6Uniforms=shader.uniforms;
    shader.fragmentShader='uniform sampler2D t6Glow; uniform vec3 t6Cold,t6Hot; uniform float t6Heat,t6GlowAmount;\n'+shader.fragmentShader.replace('#include <opaque_fragment>','vec3 t6c=mix(t6Cold,t6Hot,clamp(t6Heat,0.,1.));outgoingLight+=texture2D(t6Glow,vMapUv).rgb*t6c/max(max(t6c.r,t6c.g),max(t6c.b,.001))*t6GlowAmount;\n#include <opaque_fragment>');
    film(shader);
  };
}
const nativeMaterials=new Map();
function nativeMaterial(name){
  name=name.replace(/^,/, '');
  if(!nativeMaterials.has(name))nativeMaterials.set(name,(async()=>{
    for(const source of assetZones)try{return await get(`/data/${source}/materials/${name}.json`,true);}catch{}
    return null;
  })());
  return nativeMaterials.get(name);
}
export async function model(name) {
  name=name.replace(/^,/, '');
  if(!models.has(name))models.set(name,(async()=>{
    const manager=new THREE.LoadingManager();
    manager.addHandler(/\.dds$/i,{load(url,loaded,progress,error){textureUrl(url).catch(()=>diffuse(decodeURIComponent(url.split('/images/').pop()).replace(/\.dds$/i,''))).then(loaded,error);}});
    manager.setURLModifier(url=>url.replace('/images/,','/images/'));
    const loader=new GLTFLoader(manager);
    for(const zone of assetZones) {
      const r=await assetResponse(`/data/${zone}/model_export/${name.split('/').map(encodeURIComponent).join('/')}_lod0.glb`);
      if(!r.ok)continue;
      const gltf=await loader.parseAsync(await r.arrayBuffer(),`/data/${zone}/model_export/`);
      // A model can reference a material owned by a different fastfile. OAT's
      // GLB then retains the material name but omits its image assignments.
      // Resolve those assignments from the original exported material records.
      const materials=new Set();gltf.scene.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])materials.add(m);});
      await Promise.all([...materials].map(async material=>{
        const original=await nativeMaterial(material.name);
        const color=nativeDiffuse(original);
        // OAT can also take the first listed image (e.g. the dissolve
        // shaders' mask01 color0Map) as the base color; use the colorMap.
        const mapName=decodeURIComponent(material.map?.name||'').split('/').pop().replace(/\.dds$/i,'');
        const misassigned=!!material.map&&!!color&&mapName!==color.image&&original.textures.some(t=>t.image===mapName);
        if((!material.map||misassigned)&&color){material.map=await diffuse(color.image);material.color.setRGB(1,1,1);material.needsUpdate=true;}
        // GLB materials are all opaque. The T4 technique set carries the
        // blend: mc_l_sm_b* (glass, decals) alpha-blends and mc_l_sm_t*
        // alpha-tests at 128, so e.g. perk bottle glass shows the liquid.
        const technique=/^mc_l_sm_([a-z])\d/.exec(original?.techniqueSet||'')?.[1];
        if(technique==='b'){material.transparent=true;material.depthWrite=false;material.needsUpdate=true;}
        else if(technique==='t'){material.alphaTest=.5;material.needsUpdate=true;}
        if(original?._game==='t6'){
          const pass=original.stateBits?.find(s=>s.colorWriteRgb&&s.depthTest==='less_equal'&&!s.polymodeLine);
          if(pass?.alphaTest&&pass.alphaTest!=='disabled'){material.alphaTest=.5;material.needsUpdate=true;}
          // Blended passes: glass and decals (srcalpha/invsrcalpha),
          // premultiplied, additive and multiply.
          if(pass?.blendOpRgb==='add'){
            material.transparent=true;material.depthWrite=!!pass.depthWrite;material.needsUpdate=true;
            const factors={premultiplied:[THREE.OneFactor,THREE.OneMinusSrcAlphaFactor],add:[THREE.OneFactor,THREE.OneFactor],multiply:[THREE.ZeroFactor,THREE.SrcColorFactor]};
            const kind=pass.srcBlendRgb==='one'&&pass.dstBlendRgb==='invsrcalpha'?'premultiplied':pass.srcBlendRgb==='one'&&pass.dstBlendRgb==='one'?'add':pass.srcBlendRgb==='zero'&&pass.dstBlendRgb==='srccolor'?'multiply':null;
            if(kind){material.blending=THREE.CustomBlending;[material.blendSrc,material.blendDst]=factors[kind];}
          }
          if(pass?.cullFace==='none')material.side=THREE.DoubleSide;
          // The cornea shader only adds wet highlights over the painted eye;
          // its Mask image (a white disc) drawn as color made eyes glow.
          if(/eye_cornea/.test(original.techniqueSet||''))material.visible=false;
          const glow=original.textures?.find(t=>t.name==='Glow_Map'),constant=name=>original.constants?.find(c=>c.name===name)?.literal[0];
          const amount=(constant('hdrAmount')??1)*(constant('Emissive_Push')??1);
          if(glow&&amount>0&&material.map){material.userData.glowMap=await diffuse(glow.image);material.userData.glowAmount=amount;}
          const reveal=original.textures?.find(t=>t.name==='EmberGlow_Reveal_Map'),literal=name=>original.constants?.find(c=>c.name===name)?.literal;
          if(reveal&&material.map&&literal('Cold_Color'))material.userData.heatGlow={map:await diffuse(reveal.image),cold:literal('Cold_Color').slice(0,3),hot:(literal('Hot_Color')||literal('Cold_Color')).slice(0,3),amount:8};
        }
      }));
      // OAT converts model geometry and root bones to Y up. Restore T4's Z up.
      const group=new THREE.Group();group.rotation.x=Math.PI/2;group.add(gltf.scene);
      group.updateMatrixWorld(true);return group;
    }
    throw new Error('Original model unavailable: '+name);
  })());
  return models.get(name);
}
export function cloneModel(template){return clone(template);}
// A weapon file's hideTags: attachment parts (scopes, suppressors, grips,
// extended magazines...) are modelled into the gun and skinned to these tag
// bones; the engine skips them unless the weapon variant uses them. Drop each
// triangle whose vertices are bound to a hidden tag or one of its children.
export function applyHideTags(root,tags){
  const hide=new Set(String(tags||'').split(/\s+/).filter(Boolean).map(t=>t.toLowerCase()));if(!hide.size)return 0;let removed=0;
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const hidden=mesh.skeleton.bones.map(bone=>{for(let n=bone;n;n=n.parent)if(hide.has((n.name||'').toLowerCase()))return true;return false;});
    if(!hidden.some(Boolean))return;
    const g=mesh.geometry,si=g.getAttribute('skinIndex'),sw=g.getAttribute('skinWeight');if(!si||!sw)return;
    const bound=v=>{let best=0,weight=-1;for(let k=0;k<si.itemSize;k++){const w=sw.getComponent(v,k);if(w>weight){weight=w;best=si.getComponent(v,k);}}return hidden[best];};
    const index=g.index?Array.from(g.index.array):Array.from({length:g.attributes.position.count},(_,i)=>i),keep=[];
    for(let i=0;i<index.length;i+=3)if(!bound(index[i])&&!bound(index[i+1])&&!bound(index[i+2]))keep.push(index[i],index[i+1],index[i+2]);
    if(keep.length===index.length)return;removed+=(index.length-keep.length)/3;
    if(!keep.length){mesh.visible=false;return;}
    const filtered=g.clone();filtered.setIndex(keep);mesh.geometry=filtered;
  });
  return removed;
}
export async function loadMap(scene,progress) {
  const world=await get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.json',true);
  const bullets=new BulletTrace();
  const [vb,ib]=await Promise.all([get('/data/'+mapChoice.zone+'/web-world/'+world.vertices),get('/data/'+mapChoice.zone+'/web-world/'+world.indices)]);
  const view=new DataView(vb),idx=new Uint16Array(ib),positions=new Float32Array(world.vertexCount*3),uv=new Float32Array(world.vertexCount*2),uv1=new Float32Array(world.vertexCount*2),colorSize=mapChoice.game==='black-ops-2'?4:3,colors=new Float32Array(world.vertexCount*colorSize);
  for(let i=0;i<world.vertexCount;i++) {
    for(let k=0;k<3;k++)positions[i*3+k]=view.getFloat32(i*32+k*4,true);
    uv[i*2]=view.getFloat32(i*32+12,true);uv[i*2+1]=view.getFloat32(i*32+16,true);
    uv1[i*2]=view.getFloat32(i*32+20,true);uv1[i*2+1]=view.getFloat32(i*32+24,true);
    // T6 blend overlays fade by vertex alpha, so Buried keeps all four bytes.
    for(let k=0;k<colorSize;k++)colors[i*colorSize+k]=view.getUint8(i*32+28+k)/255;
  }
  const lights=await get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.lights.json',true),lightmaps=[];
  for(const [index,lm] of world.lightmaps.entries()) {
    const load=async name=>{const t=decode(await get('/data/'+mapChoice.zone+'/images/'+encodeURIComponent(name.replace(/^\*/, '_'))+'.dds'));
      t.colorSpace=THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;t.channel=1;return t;};
    if(mapChoice.game==='black-ops'){
      const native=world.nativeLightmaps[index],folder='/data/'+mapChoice.zone+'/web-world/';
      const [a,b]=await Promise.all([get(folder+native.secondary.file),get(folder+native.secondaryB.file)]);
      const secondary=new THREE.DataTexture(decodeKinoLightmap(a,b,native.secondary.width,native.secondary.height),native.secondary.width,native.secondary.height,THREE.RGBAFormat,THREE.FloatType);
      secondary.colorSpace=THREE.NoColorSpace;secondary.minFilter=secondary.magFilter=THREE.LinearFilter;secondary.channel=1;secondary.needsUpdate=true;
      lightmaps.push({primary:await load(lm.primary),secondary});
    }else if(mapChoice.game==='black-ops-2'){
      const primary=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);primary.needsUpdate=true;
      lightmaps.push({primary,secondary:await load(lm.secondary)});
    }else lightmaps.push({primary:await load(lm.primary),secondary:await load(lm.secondary)});
  }
  // Every primary light's parameters in one float texture (4 RGBA texels per
  // light), looked up per vertex. Per-light uniforms used to split each
  // material into a separate draw call for every light touching it.
  const lightData=new Float32Array(Math.max(1,lights.length)*16);
  lights.forEach((l,i)=>lightData.set([...l.color,l.radius,...l.direction,l.type,...l.origin,l.outer,l.inner,0,0,0],i*16));
  const lightTexture=new THREE.DataTexture(lightData,4,Math.max(1,lights.length),THREE.RGBAFormat,THREE.FloatType);
  lightTexture.minFilter=lightTexture.magFilter=THREE.NearestFilter;lightTexture.needsUpdate=true;
  const lightIndex=s=>lights[s.primaryLight]?s.primaryLight:0;
  const maps=new Map(),mats=new Map();
  progress('Loading original map textures…');
  await Promise.all(Object.entries(world.materials).map(async([name,info])=>{
    const map=await diffuse(info.diffuse);
    let normal=null;if(info.normal&&!info.normal.includes('$identity'))try{normal=await diffuse(info.normal);normal.colorSpace=THREE.NoColorSpace;}catch{}
    let layer=null;if(info.layer)try{layer=await diffuse(info.layer.diffuse);}catch{}
    maps.set(name,{map,normal,layer,info});
  }));
  // World materials. With `arrays`, the diffuse/normal textures come from
  // texture arrays indexed per vertex, so many materials share one draw call.
  // T6 compiled blend materials: a second color layer over the base, blended
  // by its alpha, multiplied (stains) or alpha-tested, and where the material
  // reads vertex color ("v1") revealed by the painted green weight through
  // alphaRevealParms1. The layer index and its parameters ride on each vertex.
  const layerShader=(shader,sample)=>{
    shader.vertexShader='attribute float wawLayer1; attribute vec4 wawLayerInfo; attribute float wawWeight; flat varying float vWawLayer1; flat varying vec4 vWawLayerInfo; varying float vWawWeight;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n          vWawLayer1=wawLayer1; vWawLayerInfo=wawLayerInfo; vWawWeight=wawWeight;');
    shader.fragmentShader='flat varying float vWawLayer1; flat varying vec4 vWawLayerInfo; varying float vWawWeight;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
          if(vWawLayer1>-.5){
            vec4 layer=${sample};float amount=layer.a;
            if(vWawLayerInfo.y>.5){float w=clamp(vWawWeight,0.,1.),soft=max(vWawLayerInfo.z,.02);amount=smoothstep(1.-w-soft,1.-w+soft,layer.a)*min(1.,w*4.);}
            int mode=int(vWawLayerInfo.x+.5);
            if(mode==1)diffuseColor.rgb*=mix(vec3(1.),layer.rgb,amount);
            else if(mode==2){if(amount>.5)diffuseColor.rgb=layer.rgb;}
            else diffuseColor.rgb=mix(diffuseColor.rgb,layer.rgb,amount);
          }`);
  };
  // T6 world materials carry their native blend state (prepare_bo2_world):
  // alpha-tested grates and railings, alpha-blended decals and glass,
  // additive chalk and multiply stains; decals draw with a depth offset.
  const blendState=(mat,blend,decal)=>{
    if(blend==='test')mat.alphaTest=.5;
    else if(blend&&blend!=='opaque'){
      mat.transparent=true;mat.depthWrite=false;
      if(blend!=='alpha'){mat.blending=THREE.CustomBlending;mat.blendEquation=THREE.AddEquation;
        [mat.blendSrc,mat.blendDst]={premultiplied:[THREE.OneFactor,THREE.OneMinusSrcAlphaFactor],add:[THREE.OneFactor,THREE.OneFactor],multiply:[THREE.ZeroFactor,THREE.SrcColorFactor]}[blend]||[THREE.SrcAlphaFactor,THREE.OneMinusSrcAlphaFactor];}
    }
    if(decal){mat.polygonOffset=true;mat.polygonOffsetFactor=-1;mat.polygonOffsetUnits=-4;}
  };
  const buildMaterial=({key,map,normal,emissive,lm,vertexColors,alpha,arrays,layer,blend,decal})=>{
    const mat=new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide,vertexColors,alphaTest:alpha?.2:0,lightMap:!emissive&&lm?lm.secondary:null});mat.name=key;blendState(mat,blend,decal);
    const hasNormal=!!(arrays?arrays.normal:normal),layered=!!(arrays?arrays.layer:layer);
    mat.onBeforeCompile=shader=>{
      if(arrays?.layer){shader.uniforms.wawLayerArray={value:arrays.layer};shader.fragmentShader='uniform mediump sampler2DArray wawLayerArray;\n'+shader.fragmentShader;layerShader(shader,'texture(wawLayerArray,vec3(vMapUv,vWawLayer1))');}
      else if(layer){shader.uniforms.wawLayerMap={value:layer};shader.fragmentShader='uniform sampler2D wawLayerMap;\n'+shader.fragmentShader;layerShader(shader,'texture2D(wawLayerMap,vMapUv)');}
      if(arrays){
        shader.uniforms.wawDiffuse={value:arrays.diffuse};if(arrays.normal)shader.uniforms.wawNormalArray={value:arrays.normal};
        shader.vertexShader='attribute float wawLayer; attribute float wawNormalLayer; flat varying float vWawLayer; flat varying float vWawNormalLayer;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n          vWawLayer=wawLayer; vWawNormalLayer=wawNormalLayer;');
        shader.fragmentShader='uniform mediump sampler2DArray wawDiffuse;'+(arrays.normal?' uniform mediump sampler2DArray wawNormalArray;':'')+' flat varying float vWawLayer; flat varying float vWawNormalLayer;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','diffuseColor*=texture(wawDiffuse,vec3(vMapUv,vWawLayer));');
      }
      if(lm&&!emissive){
        Object.assign(shader.uniforms,{wawPrimary:{value:lm.primary},wawNormal:{value:arrays?map:(normal||map)},wawHasNormal:{value:hasNormal},wawLights:{value:lightTexture}});
        shader.vertexShader='attribute float wawLight; varying vec2 wawSurfaceUv; varying vec3 wawWorldPos; varying vec3 wawWorldNormal; flat varying int wawLightIndex;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          wawSurfaceUv=uv;wawWorldPos=(modelMatrix*vec4(position,1.)).xyz;
          wawWorldNormal=normalize(mat3(modelMatrix)*normal);
          wawLightIndex=int(wawLight+.5);`);
        shader.fragmentShader=`varying vec2 wawSurfaceUv; varying vec3 wawWorldPos; varying vec3 wawWorldNormal; flat varying int wawLightIndex;
          uniform sampler2D wawPrimary,wawNormal; uniform bool wawHasNormal; uniform highp sampler2D wawLights;\n`+shader.fragmentShader;
        const normalSample=arrays?.normal?'texture(wawNormalArray,vec3(wawSurfaceUv,vWawNormalLayer))':'texture2D(wawNormal,wawSurfaceUv)';
        shader.fragmentShader=shader.fragmentShader.replace('vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );',mapChoice.game==='black-ops-2'?`
          // T6 stores ambient, directional intensity and direction in three
          // stacked images. Alpha is the intensity divisor, not normal XY.
          vec2 uvT6=vec2(vLightMapUv.x,vLightMapUv.y/3.);
          vec4 a=texture2D(lightMap,uvT6),b=texture2D(lightMap,uvT6+vec2(0.,1./3.));
          vec3 direction=texture2D(lightMap,uvT6+vec2(0.,2./3.)).rgb*2.-1.;
          vec3 N=normalize(wawWorldNormal);
          if(wawHasNormal){vec2 xy=${normalSample}.rg*4.015748-2.015748;
            vec3 dp1=dFdx(wawWorldPos),dp2=dFdy(wawWorldPos);vec2 du1=dFdx(wawSurfaceUv),du2=dFdy(wawSurfaceUv);
            vec3 T=dp1*du2.y-dp2*du1.y,B=dp2*du1.x-dp1*du2.x;
            float scale=inversesqrt(max(max(dot(T,T),dot(B,B)),.000001));
            N=normalize(T*scale*xy.x+B*scale*xy.y+N*sqrt(max(0.,1.-dot(xy,xy))));}
          vec3 baked=a.rgb/(a.a+.000001)+b.rgb/(b.a+.000001)*max(0.,dot(direction,N));
          vec4 lightMapTexel=vec4(baked*PI,1.);`:`
          // The recovered T4 shader samples ambient RGB in the upper half and
          // directional RGB in the lower half; their alpha channels encode XY.
          vec4 a=texture2D(lightMap,vec2(vLightMapUv.x,vLightMapUv.y*.5));
          vec4 b=texture2D(lightMap,vec2(vLightMapUv.x,vLightMapUv.y*.5+.5));
          vec2 d=vec2(a.a*4.08-2.08,b.a*4.064516-2.064516);
          vec2 n=vec2(0.);if(wawHasNormal){vec4 t=${normalSample};n=vec2(t.a*4.08-2.08,t.g*4.064516-2.064516);}
          float nf=.6*exp2(-dot(n,n))+.4,df=.6*exp2(-dot(d,d))+.4;
          vec3 baked=a.rgb*nf+b.rgb*clamp((dot(d,n)+1.)*df*nf,0.,1.);
          vec4 l0=texelFetch(wawLights,ivec2(0,wawLightIndex),0),l1=texelFetch(wawLights,ivec2(1,wawLightIndex),0),l2=texelFetch(wawLights,ivec2(2,wawLightIndex),0),l3=texelFetch(wawLights,ivec2(3,wawLightIndex),0);
          vec3 wawLightColor=l0.rgb,wawLightDir=l1.xyz,wawLightOrigin=l2.xyz;float wawLightRadius=l0.a;int wawLightType=int(l1.w+.5);vec2 wawCone=vec2(l2.w,l3.x);
          vec3 L=wawLightDir;float attenuation=1.;
          if(wawLightType>1){vec3 delta=wawLightOrigin-wawWorldPos;float dist=length(delta);L=delta/max(dist,.01);
            attenuation=max(0.,1.-dist/max(wawLightRadius,.01));
            if(wawLightType==2)attenuation*=smoothstep(wawCone.x,wawCone.y,dot(L,wawLightDir));}
          float primary=texture2D(wawPrimary,vLightMapUv).r;
          baked+=primary*wawLightColor*max(0.,dot(normalize(wawWorldNormal),L))*attenuation;
          vec4 lightMapTexel=vec4(baked*PI,1.);`);
      }
      film(shader);
    };
    mat.customProgramCacheKey=()=>[!!lm,!!emissive,hasNormal,vertexColors,alpha,arrays?'array':'',layered].join('|');
    return mat;
  };
  const material=(s)=>{
    const key=[s.material,s.lightmap].join('|');if(mats.has(key))return key;
    const {map,normal,layer,info}=maps.get(s.material);
    mats.set(key,buildMaterial({key,map,normal,emissive:info.emissive,lm:lightmaps[s.lightmap],vertexColors:!s.material.startsWith('*'),alpha:!info.blend&&/foliage|chalk|puddle/.test(s.material),layer,blend:info.blend,decal:info.decal}));return key;
  };
  // Texture arrays: compressed textures of one role, format, size and mip count
  // share a GPU array; each world vertex carries its layer. ?arrays=0 disables.
  const useArrays=!/[?&]arrays=0\b/.test(location.search),arrayBuckets=new Map(),arrayTextures=[];
  const arrayLayer=(texture,role)=>{
    if(!useArrays||!texture?.isCompressedTexture||!texture.mipmaps?.length)return null;
    const key=[role,texture.format,texture.image.width,texture.image.height,texture.mipmaps.length].join('x');
    if(!arrayBuckets.has(key))arrayBuckets.set(key,{key,textures:[],layers:new Map(),texture:null});
    const bucket=arrayBuckets.get(key);if(!bucket.layers.has(texture)){bucket.layers.set(texture,bucket.textures.length);bucket.textures.push(texture);}
    return {bucket,layer:bucket.layers.get(texture)};
  };
  const arrayTexture=bucket=>{
    if(bucket.texture)return bucket.texture;
    const first=bucket.textures[0],depth=bucket.textures.length;
    const mipmaps=first.mipmaps.map((level,i)=>{const size=level.data.length,data=new Uint8Array(size*depth);bucket.textures.forEach((t,layer)=>data.set(t.mipmaps[i].data,layer*size));return {data,width:level.width,height:level.height};});
    const t=new THREE.CompressedArrayTexture(mipmaps,first.image.width,first.image.height,depth,first.format);
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=first.colorSpace;t.minFilter=mipmaps.length>1?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;t.needsUpdate=true;
    bucket.texture=t;arrayTextures.push(t);return t;
  };
  const arrayMap=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);arrayMap.needsUpdate=true;
  const arrayGroups=new Map();
  const surfaceToModel=new Map();
  for(let i=1;i<world.brushModels.length;i++) {
    const m=world.brushModels[i];for(let s=m.firstSurface;s<m.firstSurface+m.surfaceCount;s++)surfaceToModel.set(s,i);
  }
  const grouped=new Map(),baseMaterials=new Map();
  const V=world.vertexCount,layerIndex=new Float32Array(V).fill(-1),layerInfo=new Float32Array(V*4),layerWeight=new Float32Array(V);
  // The painted reveal weight is the vertex color's green channel (ivy climbs
  // from the ground up the mansion's walls).
  for(let i=0;i<V;i++)layerWeight[i]=colors[i*colorSize+1];
  const markLayer=(s,info,index)=>{const l=info.layer,mode={b:0,m:1,t:2}[l.mode]??0;
    for(let v=s.firstVertex;v<s.firstVertex+s.vertexCount;v++){layerIndex[v]=index;layerInfo.set([mode,l.vertex?1:0,l.reveal[0],l.reveal[1]],v*4);}};
  // DPVS cells (world.dpvs): each world surface lies in one cell.
  const dpvs=world.dpvs?.cells?.length&&!/[?&]cells=0\b/.test(location.search)?world.dpvs:null,surfaceCell=new Int16Array(world.surfaces.length).fill(-1);
  dpvs?.cells.forEach((cell,c)=>{for(const i of cell.surfaces)surfaceCell[i]=c;});
  // Compile-tool surfaces (shadow casters, shadow caulk, HDR portals, clips)
  // are invisible in the original renderer; drawing them showed their editor
  // placeholder textures as walls and added draw calls. Collision is separate.
  const toolMaterial=/^w(?:p)?c\/(shadowcaster|caulk|hdrportal|nodraw|clip|trigger|hint|skip|portal)/i;
  world.surfaces.forEach((s,i)=>{
    if(toolMaterial.test(s.material))return;
    const id=surfaceToModel.get(i)||0;
    if(id===0){
      const {map,normal,layer,info}=maps.get(s.material),d=arrayLayer(map,'d'),n=normal?arrayLayer(normal,'n'):null,l=layer?arrayLayer(layer,'d'):null;
      if(d&&(!normal||n)&&(!layer||l)){
        const alpha=!info.blend&&/foliage|chalk|puddle/.test(s.material),vertexColors=!s.material.startsWith('*'),key=[d.bucket.key,n?.bucket.key||'-',l?.bucket.key||'-',s.lightmap,!!info.emissive,alpha,vertexColors,info.blend||'',!!info.decal].join('|');
        if(l)markLayer(s,info,l.layer);
        if(!arrayGroups.has(key))arrayGroups.set(key,{indices:[],lights:[],layers:[],normalLayers:[],cells:[],meta:{d:d.bucket,n:n?.bucket||null,l:l?.bucket||null,lm:lightmaps[s.lightmap],emissive:!!info.emissive,alpha,vertexColors,blend:info.blend,decal:!!info.decal}});
        const g=arrayGroups.get(key),light=lightIndex(s);
        for(let k=0;k<s.triangleCount*3;k++){g.indices.push(s.firstVertex+idx[s.baseIndex+k]);g.lights.push(light);g.layers.push(d.layer);g.normalLayers.push(n?n.layer:0);}
        for(let k=0;k<s.triangleCount;k++)g.cells.push(surfaceCell[i]);
        return;
      }
    }
    {const {layer,info}=maps.get(s.material);if(layer)markLayer(s,info,0);}
    if(!grouped.has(id))grouped.set(id,new Map());const m=grouped.get(id);
    const base=material(s);let key=base;
    if(id===0){let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let v=s.firstVertex;v<s.firstVertex+s.vertexCount;v++)for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[v*3+k]);max[k]=Math.max(max[k],positions[v*3+k]);}key+='~'+min.map((v,k)=>Math.floor((v+max[k])/1024)).join(',');}
    baseMaterials.set(key,base);if(!m.has(key))m.set(key,{indices:[],lights:[],cells:[]});const a=m.get(key),light=lightIndex(s);
    for(let k=0;k<s.triangleCount*3;k++){a.indices.push(s.firstVertex+idx[s.baseIndex+k]);a.lights.push(light);}
    for(let k=0;k<s.triangleCount;k++)a.cells.push(surfaceCell[i]);
  });
  const brushMeshes=new Map();
  const compactGeometry=(indices,lightsOf,layers=null,normalLayers=null)=>{
    const remap=new Map(),unique=[],uniqueLights=[],uniqueLayers=[],uniqueNormalLayers=[],compact=[],V=world.vertexCount;
    indices.forEach((id,k)=>{const light=lightsOf[k],layer=layers?layers[k]:0,nl=normalLayers?normalLayers[k]:0,slot=id+V*(light+256*(layer+512*nl));
      if(!remap.has(slot)){remap.set(slot,unique.length);unique.push(id);uniqueLights.push(light);uniqueLayers.push(layer);uniqueNormalLayers.push(nl);}compact.push(remap.get(slot));});
    const geometry=new THREE.BufferGeometry();
    for(const [name,source,size]of [['position',positions,3],['uv',uv,2],['uv1',uv1,2],['color',colors,colorSize]]){
      const values=new Float32Array(unique.length*size);unique.forEach((id,i)=>values.set(source.subarray(id*size,(id+1)*size),i*size));geometry.setAttribute(name,new THREE.BufferAttribute(values,size));
    }
    geometry.setAttribute('wawLight',new THREE.BufferAttribute(new Float32Array(uniqueLights),1));
    geometry.setAttribute('wawLayer1',new THREE.BufferAttribute(Float32Array.from(unique,id=>layerIndex[id]),1));
    geometry.setAttribute('wawWeight',new THREE.BufferAttribute(Float32Array.from(unique,id=>layerWeight[id]),1));
    {const info=new Float32Array(unique.length*4);unique.forEach((id,i)=>info.set(layerInfo.subarray(id*4,id*4+4),i*4));geometry.setAttribute('wawLayerInfo',new THREE.BufferAttribute(info,4));}
    if(layers){geometry.setAttribute('wawLayer',new THREE.BufferAttribute(new Float32Array(uniqueLayers),1));geometry.setAttribute('wawNormalLayer',new THREE.BufferAttribute(new Float32Array(uniqueNormalLayers),1));}
    geometry.setIndex(compact);geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
  };
  let worldBatches=0;const cellMeshes=[];
  // Reorder a batch's per-vertex arrays so triangles of one cell are adjacent.
  const byCell=(group,fields)=>{
    const order=group.cells.map((c,t)=>t).sort((a,b)=>group.cells[a]-group.cells[b]||a-b),out={},ranges=[];
    for(const f of fields)if(group[f]){const src=group[f],dst=new Array(src.length);order.forEach((t,i)=>{dst[i*3]=src[t*3];dst[i*3+1]=src[t*3+1];dst[i*3+2]=src[t*3+2];});out[f]=dst;}
    order.forEach((t,i)=>{const c=group.cells[t],last=ranges.at(-1);if(last&&last.cell===c)last.count+=3;else ranges.push({cell:c,start:i*3,count:3});});
    return {...out,ranges};
  };
  // Bullet traces keep the complete geometry; the drawn copy shares its vertex
  // buffers with a rewritable index of the visible cells only.
  const cellCulled=(mesh,ranges)=>{
    if(!dpvs)return mesh;const full=mesh.geometry,draw=new THREE.BufferGeometry();
    for(const [name,attribute]of Object.entries(full.attributes))draw.setAttribute(name,attribute);
    const source=Uint32Array.from(full.index.array),index=new THREE.BufferAttribute(new Uint32Array(source.length),1);index.setUsage(THREE.DynamicDrawUsage);index.array.set(source);
    draw.setIndex(index);draw.boundingSphere=full.boundingSphere;draw.boundingBox=full.boundingBox;mesh.geometry=draw;cellMeshes.push({mesh,source,ranges,index});return mesh;
  };
  for(const [key,g]of arrayGroups){
    const m=g.meta,mat=buildMaterial({key:'array:'+key,map:arrayMap,normal:null,emissive:m.emissive,lm:m.lm,vertexColors:m.vertexColors,alpha:m.alpha,blend:m.blend,decal:m.decal,arrays:{diffuse:arrayTexture(m.d),normal:m.n?arrayTexture(m.n):null,layer:m.l?arrayTexture(m.l):null}});
    const sorted=byCell(g,['indices','lights','layers','normalLayers']);
    const mesh=new THREE.Mesh(compactGeometry(sorted.indices,sorted.lights,sorted.layers,sorted.normalLayers),mat);mesh.name='Original world section';mesh.matrixAutoUpdate=false;scene.add(mesh);bullets.addMesh(mesh,{layers:m.d.textures});cellCulled(mesh,sorted.ranges);worldBatches++;
  }
  for(const [id,groups]of grouped) {
    if(id===0){for(const [key,group]of groups){const sorted=byCell(group,['indices','lights']);const mesh=new THREE.Mesh(compactGeometry(sorted.indices,sorted.lights),mats.get(baseMaterials.get(key)));mesh.name='Original world section';mesh.matrixAutoUpdate=false;scene.add(mesh);bullets.addMesh(mesh);cellCulled(mesh,sorted.ranges);worldBatches++;}}
    else{
      const indices=[],lightsOf=[],materials=[],ranges=[];
      for(const [key,group]of groups){ranges.push([indices.length,group.indices.length,materials.length]);indices.push(...group.indices);lightsOf.push(...group.lights);materials.push(mats.get(baseMaterials.get(key)));}
      const geometry=compactGeometry(indices,lightsOf);for(const range of ranges)geometry.addGroup(...range);
      const mesh=new THREE.Mesh(geometry,materials);mesh.matrixAutoUpdate=false;brushMeshes.set(id,mesh);
    }
  }
  // Spatial lookup of baked illumination keeps props, actors and hands in the
  // same lighting as the bunker, instead of an unrestricted ambient lamp.
  const samples=[],sampled=new Set();
  for(const s of world.surfaces){if(!lightmaps[s.lightmap])continue;for(let i=s.firstVertex;i<s.firstVertex+s.vertexCount;i+=3){
    // Surface records share vertex ranges: Nacht otherwise inserted the same
    // lightmap/vertex 8.68 million times. Preserve its first occurrence.
    const id=s.lightmap*world.vertexCount+i;if(sampled.has(id))continue;sampled.add(id);
    const p=Array.from(positions.slice(i*3,i*3+3));
    samples.push({p,uv:[uv1[i*2],uv1[i*2+1]],lm:lightmaps[s.lightmap]});
  }}
  const lighting=new BakedLightSamples(samples);
  const texel=(t,u,v)=>{const {data,width,height}=t.image;const offset=(Math.min(height-1,Math.max(0,Math.floor(v*height)))*width+Math.min(width-1,Math.max(0,Math.floor(u*width))))*4;return Array.from(data.slice(offset,offset+4),x=>x/(t.type===THREE.FloatType?1:255));};
  const illumination=position=>{
    const best=lighting.nearest(position);
    if(!best)return [.08,.10,.13];
    if(mapChoice.game==='black-ops-2'){const a=texel(best.lm.secondary,best.uv[0],best.uv[1]/3),b=texel(best.lm.secondary,best.uv[0],best.uv[1]/3+1/3);return a.slice(0,3).map((v,k)=>Math.max(.018,Math.min(4,v/(a[3]+.000001)+b[k]/(b[3]+.000001)*.5)));}
    const a=texel(best.lm.secondary,best.uv[0],best.uv[1]*.5),b=texel(best.lm.secondary,best.uv[0],best.uv[1]*.5+.5);
    return a.slice(0,3).map((v,i)=>Math.max(.018,v+b[i]));
  };
  progress('Loading original bunker props…');
  const unique=[...new Set(world.staticModels.map(x=>x.model))];
  for(let i=0;i<unique.length;i+=6)await Promise.all(unique.slice(i,i+6).map(model));
  // Repeated map props share geometry and materials. Spatial batches retain
  // culling and each placement's original transform and baked illumination.
  const batches=new Map(),parts=new Map();
  for(const name of unique){
    const object=cloneModel(await model(name));shadeModel(object,[1,1,1]);object.updateMatrixWorld(true);
    const meshes=[];object.traverse(mesh=>{if(!mesh.isMesh)return;
      let geometry=mesh.geometry;
      if(mesh.isSkinnedMesh){
        geometry=geometry.clone();const attribute=geometry.getAttribute('position'),v=new THREE.Vector3();mesh.skeleton.update();
        for(let i=0;i<attribute.count;i++){mesh.getVertexPosition(i,v);attribute.setXYZ(i,v.x,v.y,v.z);}geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');geometry.computeVertexNormals();geometry.computeBoundingSphere();
      }
      meshes.push({geometry,material:mesh.material,matrix:mesh.matrixWorld.clone()});
    });parts.set(name,meshes);
  }
  const smodelCells=new Map();dpvs?.cells.forEach((cell,c)=>{for(const i of cell.smodels){if(!smodelCells.has(i))smodelCells.set(i,[]);smodelCells.get(i).push(c);}});
  world.staticModels.forEach((inst,placement)=>{inst.placement=placement;});
  for(const inst of world.staticModels){
    const a=inst.axis,p=inst.origin,s=inst.scale,matrix=new THREE.Matrix4().set(a[0][0]*s,a[1][0]*s,a[2][0]*s,p[0],a[0][1]*s,a[1][1]*s,a[2][1]*s,p[1],a[0][2]*s,a[1][2]*s,a[2][2]*s,p[2],0,0,0,1);
    const key=inst.model;
    if(!batches.has(key))batches.set(key,{name:inst.model,instances:[]});batches.get(key).instances.push({matrix,color:new THREE.Color(...illumination(p)),origin:new THREE.Vector3(...p),cull:inst.cullDist>0?inst.cullDist**2:Infinity,cells:smodelCells.get(inst.placement)||null});
  }
  let batchCount=0;const cullBatches=[],frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),viewOrigin=new THREE.Vector3();let lastView=null;
  for(const batch of batches.values())for(const part of parts.get(batch.name)){
    const mesh=new THREE.InstancedMesh(part.geometry,part.material,batch.instances.length);mesh.name='Static batch '+batch.name;mesh.matrixAutoUpdate=false;
    part.geometry.computeBoundingSphere();
    const instances=batch.instances.map(inst=>{const matrix=inst.matrix.clone().multiply(part.matrix),sphere=part.geometry.boundingSphere.clone().applyMatrix4(matrix);sphere.radius+=32;return {matrix,color:inst.color,sphere,origin:inst.origin,cull:inst.cull,cells:inst.cells};});
    bullets.addInstances(part.geometry,part.material,instances);
    instances.forEach((inst,i)=>{mesh.setMatrixAt(i,inst.matrix);mesh.setColorAt(i,inst.color);});
    mesh.frustumCulled=false;scene.add(mesh);batchCount++;cullBatches.push({mesh,instances,visible:null});
  }
  // The DPVS BSP: interior nodes are (plane + cellCount + 1, right offset);
  // a leaf is (cell + 1). The front side continues at the next pair.
  const cellFor=o=>{
    if(!dpvs)return -1;const nodes=dpvs.nodes,count=dpvs.cellCount;let at=0;
    for(let guard=0;guard<4096;guard++){const v=nodes[at];if(v===undefined)return -1;if(v<count+1)return v-1;const p=dpvs.planes[v-count-1];at=p[0]*o[0]+p[1]*o[1]+p[2]*o[2]-p[3]>0?at+2:at+nodes[at+1];}
    return -1;
  };
  const clip=[];
  const portalRect=(portal,m)=>{
    // Clip the portal to the near plane in clip space, then bound it in NDC.
    const e=m.elements;let points=portal.vertices.map(v=>[e[0]*v[0]+e[4]*v[1]+e[8]*v[2]+e[12],e[1]*v[0]+e[5]*v[1]+e[9]*v[2]+e[13],e[3]*v[0]+e[7]*v[1]+e[11]*v[2]+e[15],e[2]*v[0]+e[6]*v[1]+e[10]*v[2]+e[14]]);
    clip.length=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],da=a[2]+a[3]-1e-3,db=b[2]+b[3]-1e-3;
      if(da>=0)clip.push(a);if(da>=0!==db>=0){const t=da/(da-db);clip.push(a.map((v,k)=>v+(b[k]-v)*t));}}
    if(clip.length<3)return null;let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const q of clip){const w=Math.max(q[2],1e-6),x=q[0]/w,y=q[1]/w;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    return [x0-.01,y0-.01,x1+.01,y1+.01];
  };
  let visibleCells=null,lastCells='';
  const floodCells=(eye,m)=>{
    const start=cellFor([eye.x,eye.y,eye.z]);if(start<0)return null;
    const mask=new Uint8Array(dpvs.cellCount),rects=new Array(dpvs.cellCount),queue=[start];rects[start]=[-1,-1,1,1];mask[start]=1;
    for(let steps=0;queue.length&&steps<4096;steps++){
      const c=queue.pop(),r=rects[c];
      for(const portal of dpvs.cells[c].portals){
        const t=portal.cell,pl=portal.plane,side=pl[0]*eye.x+pl[1]*eye.y+pl[2]*eye.z+pl[3];if(t<0||side>.5)continue;
        let pr=side>-1?r.slice():portalRect(portal,m);if(!pr)continue;
        pr=[Math.max(pr[0],r[0]),Math.max(pr[1],r[1]),Math.min(pr[2],r[2]),Math.min(pr[3],r[3])];if(pr[0]>=pr[2]||pr[1]>=pr[3])continue;
        const old=rects[t];if(old&&old[0]<=pr[0]&&old[1]<=pr[1]&&old[2]>=pr[2]&&old[3]>=pr[3])continue;
        rects[t]=old?[Math.min(old[0],pr[0]),Math.min(old[1],pr[1]),Math.max(old[2],pr[2]),Math.max(old[3],pr[3])]:pr;mask[t]=1;queue.push(t);
      }
    }
    return mask;
  };
  const updateVisibility=camera=>{
    camera.updateMatrixWorld();projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    if(lastView&&projection.elements.every((v,i)=>v===lastView[i]))return;lastView=projection.elements.slice();frustum.setFromProjectionMatrix(projection);
    // Each placement's original cullDist (GfxStaticModelDrawInst): the game
    // stops drawing a prop beyond it, measured from the view to its origin.
    const eye=camera.getWorldPosition(viewOrigin);
    if(dpvs){
      visibleCells=floodCells(eye,projection);const key=visibleCells?visibleCells.join(''):'all';
      if(key!==lastCells){lastCells=key;
        for(const w of cellMeshes){let count=0;const out=w.index.array;
          for(const r of w.ranges)if(!visibleCells||r.cell<0||visibleCells[r.cell]){out.set(w.source.subarray(r.start,r.start+r.count),count);count+=r.count;}
          w.mesh.geometry.setDrawRange(0,count);w.mesh.visible=count>0;w.index.clearUpdateRanges();w.index.addUpdateRange(0,count);w.index.needsUpdate=true;}
      }
    }
    const cellVisible=cells=>!visibleCells||!cells||cells.some(c=>visibleCells[c]);
    for(const batch of cullBatches){const visible=[];batch.instances.forEach((inst,i)=>{if(inst.origin.distanceToSquared(eye)<=inst.cull&&cellVisible(inst.cells)&&frustum.intersectsSphere(inst.sphere))visible.push(i);});
      if(batch.visible&&visible.length===batch.visible.length&&visible.every((v,i)=>v===batch.visible[i]))continue;
      visible.forEach((id,i)=>{const inst=batch.instances[id];batch.mesh.setMatrixAt(i,inst.matrix);batch.mesh.setColorAt(i,inst.color);});
      batch.mesh.count=visible.length;batch.mesh.visible=visible.length>0;batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.instanceColor.needsUpdate=true;batch.visible=visible;
    }
  };
  return {world,bullets,brushMeshes,illumination,worldBatches,cellFor,get visibleCells(){return visibleCells;},cellCount:dpvs?.cellCount||0,staticBatches:batchCount,staticPlacements:world.staticModels.length,lightmapCount:lightmaps.length,textures:()=>textures.size,
    // Lightmaps and the light table are decoded here rather than through the
    // texture cache; upload them before play too, or each one uploads (a
    // 20-70 ms hitch) the first time its area comes into view.
    updateVisibility,uploadTextures:async renderer=>{
      // Textures copied into an array upload as the array; any other user of
      // them uploads in main.js's full-scene warm render.
      const inArrays=new Set([...arrayBuckets.values()].flatMap(b=>b.texture?b.textures:[]));
      await Promise.all([...textures.values()].map(async promise=>{const t=await promise;if(!inArrays.has(t))renderer.initTexture(t);}));
      for(const lm of lightmaps){renderer.initTexture(lm.primary);renderer.initTexture(lm.secondary);}renderer.initTexture(lightTexture);
      for(const t of arrayTextures)renderer.initTexture(t);}};
}

// T6 character clips store bone translations below the root as offsets from
// the rest pose (lip and brow tracks move a fraction of a unit). Read as
// absolute positions they fold faces and shoulders, and pile a prop's parts
// (the start room's floor boards) at its origin. Character tags keep their
// rest place; a prop's tag_animate root still moves.
export const t6Clips=mapChoice.game==='black-ops-2';
// World at War's effect element types run 2 tail, 3 line, 4 trail; Black
// Ops (T5/T6) insert a rotated sprite before them.
export const t4Effects=!['black-ops','black-ops-2'].includes(mapChoice.game);
export function restRelative(clip,root){
  const rest=new Map();root.traverse(b=>{if(b.isBone&&!rest.has(b.name))rest.set(b.name,b.position.clone());});
  clip.tracks=clip.tracks.filter(t=>{const [bone,property]=t.name.split('.');return property!=='position'||!bone.startsWith('tag_')||bone==='tag_animate';});
  for(const t of clip.tracks){const [bone,property]=t.name.split('.'),r=rest.get(bone);if(property!=='position'||bone==='j_mainroot'||!r)continue;
    for(let k=0;k<t.values.length;k+=3){t.values[k]+=r.x;t.values[k+1]+=r.y;t.values[k+2]+=r.z;}}
  return clip;
}
export async function originalAnimation(name,root,shared=false) {
  let data;
  for(const zone of assetZones)try{data=await get(`/data/${zone}/web-anims/${name}.json`,true);break;}catch{}
  if(!data)throw new Error('Original animation unavailable: '+name);
  const tracks=[];
  for(const t of data.tracks) {
    const bone=root.getObjectByName(t.bone);if(!bone?.isBone)continue;
    if(t.quaternions.length) {
      const times=t.quaternions.map((_,i)=>(t.rotationIndices[i]||0)/data.fps);
      const values=t.quaternions.flatMap(a=>{const q=new THREE.Quaternion(...a.map(x=>x/32767)).normalize();
        if(!bone.parent?.isBone)q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));return q.toArray();});
      tracks.push(new THREE.QuaternionKeyframeTrack((shared?bone.name:bone.uuid)+'.quaternion',times,values));
    }
    if(t.translationType!==8) {
      const frames=t.translations.length?t.translations.map(a=>a.map((x,k)=>t.mins[k]+x*t.size[k])):[t.constant];
      const times=frames.map((_,i)=>(t.translationIndices[i]||0)/data.fps);
      // The actor's animated root is an offset from its model root. Limb and
      // first-person tracks contain local transforms, including constant tracks.
      const values=frames.flatMap(a=>{
        const v=new THREE.Vector3(...a);
        if(t.bone==='j_mainroot')v.add(bone.position);
        if(!bone.parent?.isBone)v.set(v.x,v.z,-v.y);
        if(bone.userData.animationTranslationBase)v.add(new THREE.Vector3(...bone.userData.animationTranslationBase));
        return v.toArray();
      });
      tracks.push(new THREE.VectorKeyframeTrack((shared?bone.name:bone.uuid)+'.position',times,values));
    }
  }
  const clip=new THREE.AnimationClip(name,Math.max(1/data.fps,data.frames/data.fps),tracks);
  // Root motion (tag_origin delta), e.g. where a barrier board ends up.
  const d=data.delta,last=d?.values?.length?d.values.at(-1).map((v,k)=>d.mins[k]+v*d.size[k]):d?.constant||null;
  clip.userData={notifies:data.notifies||[],rootEnd:last};return clip;
}

export class OriginalAudio {
  constructor(sounds,unlockedContext=null){
    this.sounds=sounds;this.context=null;this.unlockedContext=unlockedContext;this.buffers=new Map();this.loading=null;this._volume=.5;
    this.sources=new Set();this.history=[];this.session=null;
  }
  get volume(){return this._volume;}
  set volume(value){this._volume=Math.max(0,Math.min(1,value));if(this.master)this.master.gain.value=this._volume;}
  preload() {
    this.loading??=(async()=>{
      // Decode before enabling Play without requiring or unlocking live audio.
      const decoder=new OfflineAudioContext(2,1,48000);
      const urls=[...new Set(Object.values(this.sounds).flat().map(s=>s.url))];
      await Promise.all(urls.map(async url=>{
        try{this.buffers.set(url,await decoder.decodeAudioData(await get(url)));}
        catch(e){console.warn('Original audio decode failed',url,e.message);}
      }));
      for(const alias of ['mx_splash_screen','mx_zombie_wave_1','chalk']) {
        if(!this.sounds[alias]?.some(s=>this.buffers.has(s.url)))throw new Error(`Missing original startup audio: ${alias}`);
      }
    })();
    return this.loading;
  }
  async start() {
    if(!this.context){
      this.context=this.unlockedContext||new AudioContext();this.master=this.context.createGain();this.master.gain.value=this._volume;
      this.meter=this.context.createAnalyser();this.meter.fftSize=512;this.samples=new Float32Array(512);
      this.master.connect(this.meter);this.meter.connect(this.context.destination);
    }
    // Called synchronously from the Play click so browser audio permission is unlocked.
    await Promise.all([this.context.resume(),this.preload()]);
  }
  suspend(){this.context?.suspend().catch(console.warn);}
  stopSession(keepOneShots=false) {
    for(const source of this.sources){if(keepOneShots&&!source.loop&&source.startAt<=this.context.currentTime)continue;source.node.onended=null;try{source.node.stop();}catch{}source.node.disconnect();source.gain.disconnect();source.panner?.disconnect();if(source.record)source.record.ended=true;this.sources.delete(source);}
    this.session=null;
  }
  startSession() {
    this.stopSession();
    if(mapChoice.game==='black-ops'){
      const startAt=this.context.currentTime+.1;this.play('mx_splash_screen',1,{when:startAt});
      this.play('mx_zombie_wave_1',.35,{when:startAt+11.1,loop:true});
      this.session={introStartsAt:startAt};return;
    }
    // Nacht requests SPLASH_SCREEN after one second and WAVE_1 immediately
    // afterwards, but its musicWaitTillDone keeps the intro playing to completion.
    const startAt=this.context.currentTime+1;
    const intro=this.play('mx_splash_screen',1,{when:startAt});
    const musicAt=startAt+(intro?.duration||0);
    this.play('mx_zombie_wave_1',1,{when:musicAt,loop:true});
    this.session={introStartsAt:startAt,musicStartsAt:musicAt};
  }
  play(alias,volume=1,options={}) {
    if(!this.context||this.context.state!=='running')return;
    // One instance per key, like the GSC level.*_jingle flags shared by a
    // machine's purchase sting and its idle jingle.
    if(options.exclusive&&[...this.sources].some(s=>s.exclusive===options.exclusive))return;
    const entries=this.sounds[alias]||[],s=entries[Number.isInteger(options.variant)&&options.variant>=0&&options.variant<entries.length?options.variant:Math.floor(Math.random()*entries.length)];if(!s)return;
    const buffer=this.buffers.get(s.url);if(!buffer)return;
    const node=this.context.createBufferSource(),gain=this.context.createGain();node.buffer=buffer;
    const pitch=s.pitch>0?s.pitch:1,when=Math.max(this.context.currentTime,options.when??this.context.currentTime);
    gain.gain.value=volume*(s.volume??1);node.playbackRate.value=pitch;node.loop=!!options.loop;
    node.connect(gain);
    // World sounds stay at their source (game units, Z up) and fade linearly
    // from `near` to silence at `far`; others play on the listener.
    let panner=null;
    if(options.position){
      panner=this.context.createPanner();panner.panningModel='HRTF';panner.distanceModel='linear';
      panner.refDistance=options.near??100;panner.maxDistance=options.far??1200;panner.rolloffFactor=1;
      const [x,y,z]=options.position;
      if(panner.positionX){panner.positionX.value=x;panner.positionY.value=y;panner.positionZ.value=z;}else panner.setPosition(x,y,z);
      gain.connect(panner);panner.connect(this.master);
    }else gain.connect(this.master);
    const record={alias,startAt:when,duration:buffer.duration/pitch,loop:node.loop,volume:gain.gain.value,pitch,position:options.position||null};
    const source={...record,node,gain,panner,exclusive:options.exclusive};this.sources.add(source);this.history.push(record);if(this.history.length>24)this.history.shift();
    source.record=record;
    const release=()=>{record.ended=true;this.sources.delete(source);node.disconnect();gain.disconnect();panner?.disconnect();};
    node.onended=release;node.start(when);
    record.stop=(fade=.05)=>{if(!this.sources.has(source))return;const now=this.context.currentTime;gain.gain.setValueAtTime(gain.gain.value,now);gain.gain.linearRampToValueAtTime(0,now+fade);try{node.stop(now+fade);}catch{release();}};
    record.setVolume=value=>{if(!this.sources.has(source))return;gain.gain.setTargetAtTime(Math.max(0,value)*(s.volume??1),this.context.currentTime,.025);record.volume=Math.max(0,value)*(s.volume??1);};
    return record;
  }
  // Character voice lines are decoded when first spoken (a character has
  // ~340), keeping the most recent few dozen decoded.
  async playVoice(alias,entries){
    const entry=entries?.[0];if(!entry||!this.context)return null;
    this.voiceCache??=new Map();let buffer=this.voiceCache.get(entry.url);
    if(!buffer){
      try{buffer=await this.context.decodeAudioData(await get(entry.url));}catch(e){console.warn('Voice decode failed',alias,e.message);return null;}
      this.voiceCache.set(entry.url,buffer);if(this.voiceCache.size>40)this.voiceCache.delete(this.voiceCache.keys().next().value);
    }
    this.sounds[alias]=entries;this.buffers.set(entry.url,buffer);
    // The playing node holds the buffer; only the bounded cache keeps it after.
    const record=this.play(alias,1);this.buffers.delete(entry.url);
    return record;
  }
  listen(position,forward){
    const l=this.context?.listener;if(!l)return;
    const [x,y,z]=position,[fx,fy,fz]=forward;
    if(l.positionX){l.positionX.value=x;l.positionY.value=y;l.positionZ.value=z;l.forwardX.value=fx;l.forwardY.value=fy;l.forwardZ.value=fz;l.upX.value=0;l.upY.value=0;l.upZ.value=1;}
    else{l.setPosition(x,y,z);l.setOrientation(fx,fy,fz,0,0,1);}
  }
  diagnostics() {
    this.meter?.getFloatTimeDomainData(this.samples);
    return {state:this.context?.state||'not-started',buffers:this.buffers.size,volume:this.volume,session:this.session,
      outputRms:this.samples?Math.sqrt(this.samples.reduce((sum,v)=>sum+v*v,0)/this.samples.length):0,
      time:this.context?.currentTime||0,history:this.history,
      sources:[...this.sources].map(({alias,startAt,duration,loop})=>({alias,startAt,duration,loop}))};
  }
}
