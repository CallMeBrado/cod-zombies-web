import * as THREE from 'three';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {assetData,assetResponse} from './preload.js';
import {BakedLightSamples} from './baked-light.js';
import {selectedMap} from './maps.js';
import {BulletTrace} from './bullet-trace.js';
const mapChoice=selectedMap(),assetZones=[...new Set([mapChoice.zone,'common','nacht'])];

const dds=new DDSLoader(), textures=new Map(), models=new Map();
export async function get(url,json=false) {
  return assetData(url,json);
}
function decode(buffer) {
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
    const t=decode(await get(url));t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;
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
      transparent:old.transparent,depthWrite:old.depthWrite,opacity:old.opacity,alphaTest:foliage?.3:old.alphaTest,side:foliage?THREE.DoubleSide:old.side});mat.name=old.name;
      mat.userData.fixedLight=/zombie.*eye/.test(old.name);if(mat.userData.fixedLight)mat.color.setRGB(1,1,1);else mat.onBeforeCompile=film;return mat;};
    node.material=Array.isArray(node.material)?node.material.map(convert):convert(node.material);
  });
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
      const r=await assetResponse(`/data/${zone}/model_export/${encodeURIComponent(name)}_lod0.glb`);
      if(!r.ok)continue;
      const gltf=await loader.parseAsync(await r.arrayBuffer(),`/data/${zone}/model_export/`);
      // A model can reference a material owned by a different fastfile. OAT's
      // GLB then retains the material name but omits its image assignments.
      // Resolve those assignments from the original exported material records.
      const materials=new Set();gltf.scene.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])materials.add(m);});
      await Promise.all([...materials].map(async material=>{
        const original=await nativeMaterial(material.name);
        const color=original?.textures?.find(t=>t.semantic==='colorMap');
        if(!material.map&&color){material.map=await diffuse(color.image);material.color.setRGB(1,1,1);material.needsUpdate=true;}
        // GLB materials are all opaque. The T4 technique set carries the
        // blend: mc_l_sm_b* (glass, decals) alpha-blends and mc_l_sm_t*
        // alpha-tests at 128, so e.g. perk bottle glass shows the liquid.
        const technique=/^mc_l_sm_([a-z])\d/.exec(original?.techniqueSet||'')?.[1];
        if(technique==='b'){material.transparent=true;material.depthWrite=false;material.needsUpdate=true;}
        else if(technique==='t'){material.alphaTest=.5;material.needsUpdate=true;}
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
export async function loadMap(scene,progress) {
  const world=await get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.json',true);
  const bullets=new BulletTrace();
  const [vb,ib]=await Promise.all([get('/data/'+mapChoice.zone+'/web-world/'+world.vertices),get('/data/'+mapChoice.zone+'/web-world/'+world.indices)]);
  const view=new DataView(vb),idx=new Uint16Array(ib),positions=new Float32Array(world.vertexCount*3),uv=new Float32Array(world.vertexCount*2),uv1=new Float32Array(world.vertexCount*2),colors=new Float32Array(world.vertexCount*3);
  for(let i=0;i<world.vertexCount;i++) {
    for(let k=0;k<3;k++)positions[i*3+k]=view.getFloat32(i*32+k*4,true);
    uv[i*2]=view.getFloat32(i*32+12,true);uv[i*2+1]=view.getFloat32(i*32+16,true);
    uv1[i*2]=view.getFloat32(i*32+20,true);uv1[i*2+1]=view.getFloat32(i*32+24,true);
    for(let k=0;k<3;k++)colors[i*3+k]=view.getUint8(i*32+28+k)/255;
  }
  const lights=await get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.lights.json',true),lightmaps=[];
  for(const lm of world.lightmaps) {
    const load=async name=>{const t=decode(await get('/data/'+mapChoice.zone+'/images/'+encodeURIComponent(name.replace(/^\*/, '_'))+'.dds'));
      t.colorSpace=THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;t.channel=1;return t;};
    lightmaps.push({primary:await load(lm.primary),secondary:await load(lm.secondary)});
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
    maps.set(name,{map,normal,info});
  }));
  // World materials. With `arrays`, the diffuse/normal textures come from
  // texture arrays indexed per vertex, so many materials share one draw call.
  const buildMaterial=({key,map,normal,emissive,lm,vertexColors,alpha,arrays})=>{
    const mat=new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide,vertexColors,alphaTest:alpha?.2:0,lightMap:!emissive&&lm?lm.secondary:null});mat.name=key;
    const hasNormal=!!(arrays?arrays.normal:normal);
    mat.onBeforeCompile=shader=>{
      if(arrays){
        shader.uniforms.wawDiffuse={value:arrays.diffuse};if(arrays.normal)shader.uniforms.wawNormalArray={value:arrays.normal};
        shader.vertexShader='attribute float wawLayer; attribute float wawNormalLayer; flat varying float vWawLayer; flat varying float vWawNormalLayer;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n          vWawLayer=wawLayer; vWawNormalLayer=wawNormalLayer;');
        shader.fragmentShader='uniform mediump sampler2DArray wawDiffuse;'+(arrays.normal?' uniform mediump sampler2DArray wawNormalArray;':'')+' flat varying float vWawLayer; flat varying float vWawNormalLayer;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','diffuseColor*=texture(wawDiffuse,vec3(vMapUv,vWawLayer));');
      }
      if(lm&&!emissive){
        Object.assign(shader.uniforms,{wawPrimary:{value:lm.primary},wawNormal:{value:arrays?map:(normal||map)},wawHasNormal:{value:hasNormal},wawLights:{value:lightTexture}});
        shader.vertexShader='attribute float wawLight; varying vec3 wawWorldPos; varying vec3 wawWorldNormal; flat varying int wawLightIndex;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          wawWorldPos=(modelMatrix*vec4(position,1.)).xyz;
          wawWorldNormal=normalize(mat3(modelMatrix)*normal);
          wawLightIndex=int(wawLight+.5);`);
        shader.fragmentShader=`varying vec3 wawWorldPos; varying vec3 wawWorldNormal; flat varying int wawLightIndex;
          uniform sampler2D wawPrimary,wawNormal; uniform bool wawHasNormal; uniform highp sampler2D wawLights;\n`+shader.fragmentShader;
        const normalSample=arrays?.normal?'texture(wawNormalArray,vec3(vMapUv,vWawNormalLayer))':'texture2D(wawNormal,vMapUv)';
        shader.fragmentShader=shader.fragmentShader.replace('vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );',`
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
    mat.customProgramCacheKey=()=>[!!lm,!!emissive,hasNormal,vertexColors,alpha,arrays?'array':''].join('|');
    return mat;
  };
  const material=(s)=>{
    const key=[s.material,s.lightmap].join('|');if(mats.has(key))return key;
    const {map,normal,info}=maps.get(s.material);
    mats.set(key,buildMaterial({key,map,normal,emissive:info.emissive,lm:lightmaps[s.lightmap],vertexColors:!s.material.startsWith('*'),alpha:/foliage|chalk|puddle/.test(s.material)}));return key;
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
  // Compile-tool surfaces (shadow casters, shadow caulk, HDR portals, clips)
  // are invisible in the original renderer; drawing them showed their editor
  // placeholder textures as walls and added draw calls. Collision is separate.
  const toolMaterial=/^wc\/(shadowcaster|caulk|hdrportal|nodraw|clip|trigger|hint|skip|portal)/i;
  world.surfaces.forEach((s,i)=>{
    if(toolMaterial.test(s.material))return;
    const id=surfaceToModel.get(i)||0;
    if(id===0){
      const {map,normal,info}=maps.get(s.material),d=arrayLayer(map,'d'),n=normal?arrayLayer(normal,'n'):null;
      if(d&&(!normal||n)){
        const alpha=/foliage|chalk|puddle/.test(s.material),vertexColors=!s.material.startsWith('*'),key=[d.bucket.key,n?.bucket.key||'-',s.lightmap,!!info.emissive,alpha,vertexColors].join('|');
        if(!arrayGroups.has(key))arrayGroups.set(key,{indices:[],lights:[],layers:[],normalLayers:[],meta:{d:d.bucket,n:n?.bucket||null,lm:lightmaps[s.lightmap],emissive:!!info.emissive,alpha,vertexColors}});
        const g=arrayGroups.get(key),light=lightIndex(s);
        for(let k=0;k<s.triangleCount*3;k++){g.indices.push(s.firstVertex+idx[s.baseIndex+k]);g.lights.push(light);g.layers.push(d.layer);g.normalLayers.push(n?n.layer:0);}
        return;
      }
    }
    if(!grouped.has(id))grouped.set(id,new Map());const m=grouped.get(id);
    const base=material(s);let key=base;
    if(id===0){let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let v=s.firstVertex;v<s.firstVertex+s.vertexCount;v++)for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[v*3+k]);max[k]=Math.max(max[k],positions[v*3+k]);}key+='~'+min.map((v,k)=>Math.floor((v+max[k])/1024)).join(',');}
    baseMaterials.set(key,base);if(!m.has(key))m.set(key,{indices:[],lights:[]});const a=m.get(key),light=lightIndex(s);
    for(let k=0;k<s.triangleCount*3;k++){a.indices.push(s.firstVertex+idx[s.baseIndex+k]);a.lights.push(light);}
  });
  const brushMeshes=new Map();
  const compactGeometry=(indices,lightsOf,layers=null,normalLayers=null)=>{
    const remap=new Map(),unique=[],uniqueLights=[],uniqueLayers=[],uniqueNormalLayers=[],compact=[],V=world.vertexCount;
    indices.forEach((id,k)=>{const light=lightsOf[k],layer=layers?layers[k]:0,nl=normalLayers?normalLayers[k]:0,slot=id+V*(light+256*(layer+512*nl));
      if(!remap.has(slot)){remap.set(slot,unique.length);unique.push(id);uniqueLights.push(light);uniqueLayers.push(layer);uniqueNormalLayers.push(nl);}compact.push(remap.get(slot));});
    const geometry=new THREE.BufferGeometry();
    for(const [name,source,size]of [['position',positions,3],['uv',uv,2],['uv1',uv1,2],['color',colors,3]]){
      const values=new Float32Array(unique.length*size);unique.forEach((id,i)=>values.set(source.subarray(id*size,(id+1)*size),i*size));geometry.setAttribute(name,new THREE.BufferAttribute(values,size));
    }
    geometry.setAttribute('wawLight',new THREE.BufferAttribute(new Float32Array(uniqueLights),1));
    if(layers){geometry.setAttribute('wawLayer',new THREE.BufferAttribute(new Float32Array(uniqueLayers),1));geometry.setAttribute('wawNormalLayer',new THREE.BufferAttribute(new Float32Array(uniqueNormalLayers),1));}
    geometry.setIndex(compact);geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
  };
  let worldBatches=0;
  for(const [key,g]of arrayGroups){
    const m=g.meta,mat=buildMaterial({key:'array:'+key,map:arrayMap,normal:null,emissive:m.emissive,lm:m.lm,vertexColors:m.vertexColors,alpha:m.alpha,arrays:{diffuse:arrayTexture(m.d),normal:m.n?arrayTexture(m.n):null}});
    const mesh=new THREE.Mesh(compactGeometry(g.indices,g.lights,g.layers,g.normalLayers),mat);mesh.name='Original world section';mesh.matrixAutoUpdate=false;scene.add(mesh);bullets.addMesh(mesh,{layers:m.d.textures});worldBatches++;
  }
  for(const [id,groups]of grouped) {
    if(id===0){for(const [key,group]of groups){const mesh=new THREE.Mesh(compactGeometry(group.indices,group.lights),mats.get(baseMaterials.get(key)));mesh.name='Original world section';mesh.matrixAutoUpdate=false;scene.add(mesh);bullets.addMesh(mesh);worldBatches++;}}
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
  const texel=(t,u,v)=>{const {data,width,height}=t.image;const offset=(Math.min(height-1,Math.max(0,Math.floor(v*height)))*width+Math.min(width-1,Math.max(0,Math.floor(u*width))))*4;return Array.from(data.slice(offset,offset+4),x=>x/255);};
  const illumination=position=>{
    const best=lighting.nearest(position);
    if(!best)return [.08,.10,.13];const a=texel(best.lm.secondary,best.uv[0],best.uv[1]*.5),b=texel(best.lm.secondary,best.uv[0],best.uv[1]*.5+.5);
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
  for(const inst of world.staticModels){
    const a=inst.axis,p=inst.origin,s=inst.scale,matrix=new THREE.Matrix4().set(a[0][0]*s,a[1][0]*s,a[2][0]*s,p[0],a[0][1]*s,a[1][1]*s,a[2][1]*s,p[1],a[0][2]*s,a[1][2]*s,a[2][2]*s,p[2],0,0,0,1);
    const key=inst.model;
    if(!batches.has(key))batches.set(key,{name:inst.model,instances:[]});batches.get(key).instances.push({matrix,color:new THREE.Color(...illumination(p))});
  }
  let batchCount=0;const cullBatches=[],frustum=new THREE.Frustum(),projection=new THREE.Matrix4();let lastView=null;
  for(const batch of batches.values())for(const part of parts.get(batch.name)){
    const mesh=new THREE.InstancedMesh(part.geometry,part.material,batch.instances.length);mesh.name='Static batch '+batch.name;mesh.matrixAutoUpdate=false;
    part.geometry.computeBoundingSphere();
    const instances=batch.instances.map(inst=>{const matrix=inst.matrix.clone().multiply(part.matrix),sphere=part.geometry.boundingSphere.clone().applyMatrix4(matrix);sphere.radius+=32;return {matrix,color:inst.color,sphere};});
    bullets.addInstances(part.geometry,part.material,instances);
    instances.forEach((inst,i)=>{mesh.setMatrixAt(i,inst.matrix);mesh.setColorAt(i,inst.color);});
    mesh.frustumCulled=false;scene.add(mesh);batchCount++;cullBatches.push({mesh,instances,visible:null});
  }
  const updateVisibility=camera=>{
    camera.updateMatrixWorld();projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    if(lastView&&projection.elements.every((v,i)=>v===lastView[i]))return;lastView=projection.elements.slice();frustum.setFromProjectionMatrix(projection);
    for(const batch of cullBatches){const visible=[];batch.instances.forEach((inst,i)=>{if(frustum.intersectsSphere(inst.sphere))visible.push(i);});
      if(batch.visible&&visible.length===batch.visible.length&&visible.every((v,i)=>v===batch.visible[i]))continue;
      visible.forEach((id,i)=>{const inst=batch.instances[id];batch.mesh.setMatrixAt(i,inst.matrix);batch.mesh.setColorAt(i,inst.color);});
      batch.mesh.count=visible.length;batch.mesh.visible=visible.length>0;batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.instanceColor.needsUpdate=true;batch.visible=visible;
    }
  };
  return {world,bullets,brushMeshes,illumination,worldBatches,staticBatches:batchCount,staticPlacements:world.staticModels.length,lightmapCount:lightmaps.length,textures:()=>textures.size,
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
  const clip=new THREE.AnimationClip(name,Math.max(1/data.fps,data.frames/data.fps),tracks);clip.userData={notifies:data.notifies||[]};return clip;
}

export class OriginalAudio {
  constructor(sounds){
    this.sounds=sounds;this.context=null;this.buffers=new Map();this.loading=null;this._volume=.5;
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
      this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=this._volume;
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
    const entries=this.sounds[alias]||[],s=entries[Math.floor(Math.random()*entries.length)];if(!s)return;
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
