import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Load owned native geometry/skeletons for CPU checks without fetching images.
export async function nativeActor(map,presentation){
  const load=async name=>{
    let source;for(const zone of map.assetZones||[map.zone,'common','nacht'])try{source=await readFile(new URL('../local-data/'+zone+'/model_export/'+name+'_lod0.glb',import.meta.url));break;}catch{}
    if(!source)throw new Error('Missing native actor model '+name);
    const length=source.readUInt32LE(12),data=JSON.parse(source.toString('utf8',20,20+length)),bin=source.subarray(28+length);
    data.images=[];data.textures=[];data.materials=data.materials.map(m=>({name:m.name,doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1}}));
    const raw=JSON.stringify(data),json=Buffer.from(raw.padEnd(Math.ceil(Buffer.byteLength(raw)/4)*4,' ')),buffer=Buffer.alloc(28+json.length+bin.length);
    buffer.writeUInt32LE(0x46546c67,0);buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8);buffer.writeUInt32LE(json.length,12);buffer.writeUInt32LE(0x4e4f534a,16);json.copy(buffer,20);buffer.writeUInt32LE(bin.length,20+json.length);buffer.writeUInt32LE(0x004e4942,24+json.length);bin.copy(buffer,28+json.length);
    const gltf=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');const group=new THREE.Group();group.rotation.x=Math.PI/2;group.add(gltf.scene);return group;
  };
  const object=await load(presentation.actors?.body||'char_ger_honorgd_body1_1'),headModel=await load(presentation.actors?.head||'char_ger_honorgd_zombiehead1_1'),headMount=object.getObjectByName('j_spine4');
  headModel.userData.zombieHeadRoot=true;headModel.traverse(n=>{if(n.isMesh)n.userData.zombieHead=true;});headMount.add(headModel);
  const neckModel=await load(presentation.gore.neckModel);neckModel.traverse(n=>{if(n.isMesh)n.userData.goreOnly=true;});(presentation.gore.neckMount==='body'?object:headMount).add(neckModel);
  const root=new THREE.Group();root.add(object);root.updateMatrixWorld(true);
  return {root,object,headModel,neckModel,headMount,headRest:{position:headModel.position.clone(),quaternion:headModel.quaternion.clone(),scale:headModel.scale.clone()}};
}
