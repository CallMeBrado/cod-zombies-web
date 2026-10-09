import * as THREE from 'three';
import {DDSLoader} from 'three/addons/loaders/DDSLoader.js';
import {get} from './assets.js';
import {BuriedView} from './bo2-view.js';
export class TownView extends BuriedView {
  async prepare(manifest,presentation){
    await super.prepare(manifest,presentation);
    const sky=new DDSLoader().parse(await get(manifest.map.skyTexture),true);
    if(!sky.isCubemap||sky.mipmaps.length!==6*sky.mipmapCount)throw new Error('Original Green Run sky is incomplete');
    this.skyTexture=new THREE.CompressedCubeTexture(Array.from({length:6},(_,i)=>({width:sky.width,height:sky.height,format:sky.format,mipmaps:sky.mipmaps.slice(i*sky.mipmapCount,(i+1)*sky.mipmapCount)})),sky.format);
    this.skyTexture.colorSpace=THREE.SRGBColorSpace;this.skyTexture.needsUpdate=true;this.scene.background=this.skyTexture;
  }
  update(game,dt){super.update(game,dt);this.scene.fog.color.setRGB(.22,.25,.24);this.scene.fog.density=.00038;}
}
