import * as THREE from 'three';
import {model,cloneModel,applyHideTags} from './assets.js';
// T6 WeaponDef's authored attachViewModel/attachWorldModel slots. Staff
// tips, crystals and reload mechanisms are separate animated models.
export async function attachWeaponModels(root,definition,kind='View'){
  for(let i=0;i<16;i++){
    const prefix='attach'+kind+'Model',name=definition[prefix+i];if(!name)continue;
    const object=cloneModel(await model(name));applyHideTags(object,definition.hideTags);
    object.traverse(b=>{if(b.isBone)b.userData.animationTranslationBase=b.position.toArray();});
    const mount=new THREE.Group(),tag=definition[prefix+'Tag'+i];
    mount.position.set(...['X','Y','Z'].map(axis=>Number(definition[prefix+'Offset'+axis+i])||0));
    mount.add(object);(tag?root.getObjectByName(tag)||root:root).add(mount);
  }
}
