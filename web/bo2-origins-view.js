import * as THREE from 'three';
import {DDSLoader} from 'three/addons/loaders/DDSLoader.js';
import {BuriedView} from './bo2-view.js';
import {originalAnimation,restRelative,get} from './assets.js';
export class OriginsView extends BuriedView {
  async prepare(manifest,presentation){
    await super.prepare(manifest,presentation);this.generators=[];
    // The native sky is one DDS containing six complete mip chains. Treating
    // it as a 2D model diffuse would silently drop five of those faces.
    const sky=new DDSLoader().parse(await get('/data/bo2-origins/images/skybox_zm_tomb_ft.dds'),true);
    if(!sky.isCubemap||sky.mipmaps.length!==6*sky.mipmapCount)throw new Error('Original Origins sky cubemap is incomplete.');
    const faces=Array.from({length:6},(_,i)=>({width:sky.width,height:sky.height,format:sky.format,mipmaps:sky.mipmaps.slice(i*sky.mipmapCount,(i+1)*sky.mipmapCount)}));
    this.skyTexture=new THREE.CompressedCubeTexture(faces,sky.format);this.skyTexture.colorSpace=THREE.SRGBColorSpace;this.skyTexture.needsUpdate=true;
    this.scene.background=this.skyTexture;
    // The vista's scrolling smoke shader needs a separate reconstruction.
    // Its additive proxy quads must not render as solid fog-colored panels.
    this.scene.traverse(n=>{if(n.isMesh)for(const material of Array.isArray(n.material)?n.material:[n.material])if(material.name==='mc/mtl_fxuse_smoke_pillar')material.visible=false;});
    this.scene.fog.color.set(0x42494c);this.scene.fog.density=.00009;
    for(const gen of manifest.map.generators){const item=this.dynamic.get(gen.name)?.[0];if(!item)continue;
      const mixer=new THREE.AnimationMixer(item.object),clips=new Map();
      for(const state of ['start','up_idle','down_idle','end']){const name='fxanim_zom_tomb_generator_'+state+'_anim';
        const clip=restRelative(await originalAnimation(name,item.object,false),item.object);clips.set(state,mixer.clipAction(clip));}
      this.generators.push({id:gen.id,mixer,clips,current:null});
    }
  }
  update(game,dt){
    super.update(game,dt);const r=game.mapRules;
    for(const rows of this.dynamic.values())for(const v of rows){const e=v.entity;
      if(e.originsItem)v.object.visible=r.visible(e);
      if(e.originsStaff)v.object.visible=r.crafted.has(e.originsStaff)&&!game.inventory.some(w=>w.name===e.originsStaff);
    }
    for(const v of this.generators){const s=r.generators[v.id],age=game.time-s.started;
      const name=s.phase==='off'?'down_idle':s.phase==='capturing'&&age<v.clips.get('start').getClip().duration?'start':'up_idle';
      const action=v.clips.get(name);if(v.current!==name){v.mixer.stopAllAction();action.reset().play();v.current=name;}
      action.time=name==='start'?age:game.time%Math.max(.01,action.getClip().duration);v.mixer.update(0);
    }
  }
}
