import * as THREE from 'three';
import {DDSLoader} from 'three/addons/loaders/DDSLoader.js';
import {BuriedView} from './bo2-view.js';
import {model,cloneModel,shadeModel,originalAnimation,restRelative,get} from './assets.js';
export class MobView extends BuriedView {
  async prepare(manifest,presentation){
    await super.prepare(manifest,presentation);this.corpses=[];this.panels=[];
    const sky=new DDSLoader().parse(await get('/data/bo2-mob/images/skybox_zm_alcatraz_ft.dds'),true);
    if(!sky.isCubemap||sky.mipmaps.length!==6*sky.mipmapCount)throw new Error('Original Alcatraz sky is incomplete');
    this.skyTexture=new THREE.CompressedCubeTexture(Array.from({length:6},(_,i)=>({width:sky.width,height:sky.height,format:sky.format,mipmaps:sky.mipmaps.slice(i*sky.mipmapCount,(i+1)*sky.mipmapCount)})),sky.format);
    this.skyTexture.colorSpace=THREE.SRGBColorSpace;this.skyTexture.needsUpdate=true;this.scene.background=this.skyTexture;
    this.scene.fog.color.set(0x212a2e);this.scene.fog.density=.000045;
    for(const body of manifest.playerBodies){
      const object=cloneModel(await model(body.body));shadeModel(object,[.6,.6,.6]);const root=new THREE.Group();root.add(object);root.visible=false;this.scene.add(root);
      const name='pb_laststand_idle',clip=restRelative(await originalAnimation(name,object,false),object),mixer=new THREE.AnimationMixer(object);mixer.clipAction(clip).play();mixer.update(.1);root.rotation.y=Math.PI/2;root.updateMatrixWorld(true);const low=new THREE.Box3().setFromObject(root).min.z;this.corpses.push({root,mixer,low});
    }
    const image=await createImageBitmap(new Blob([await get('/data/gameplay/bo2-mob/hud/waypoint_revive_afterlife.png')],{type:'image/png'}));
    const markerTexture=new THREE.Texture(image);markerTexture.colorSpace=THREE.SRGBColorSpace;markerTexture.needsUpdate=true;
    this.marker=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture,transparent:true,depthTest:false,depthWrite:false}));this.marker.scale.set(30,30,1);this.marker.visible=false;this.scene.add(this.marker);
    const on=await model('p6_zm_al_shock_box_on');
    for(const rows of this.dynamic.values())for(const v of rows)if(v.entity.mobPanel){
      const object=cloneModel(on);shadeModel(object,this.map.illumination(v.object.position.toArray()));object.position.copy(v.object.position);object.rotation.copy(v.object.rotation);object.visible=false;this.scene.add(object);this.panels.push({off:v.object,on:object,entity:v.entity});
    }
    this.overlay=document.createElement('div');this.overlay.id='mob-afterlife';this.overlay.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:4;background:radial-gradient(ellipse at center,transparent 25%,#005f9855 80%,#001a4c99);mix-blend-mode:screen;display:none';document.body.append(this.overlay);
    this.scene.traverse(n=>{if(n.isMesh)for(const material of Array.isArray(n.material)?n.material:[n.material])if(/mc\/mtl_fxuse_smoke_pillar/.test(material.name))material.visible=false;});
  }
  update(game,dt){
    super.update(game,dt);const r=game.mapRules;this.overlay.style.display=r.afterlife?'block':'none';
    this.marker.visible=!!r.afterlife;if(r.afterlife)this.marker.position.set(...r.afterlife.body.map((v,k)=>v+(k===2?50:0)));
    for(const [i,c]of this.corpses.entries()){c.root.visible=!!r.afterlife&&i===game.character;if(c.root.visible){c.root.position.fromArray(r.afterlife.body);c.root.position.z-=c.low;c.mixer.update(dt);}}
    for(const p of this.panels){const on=r.powered.has(p.entity.mobPanelId);p.off.visible=!on;p.on.visible=on;}
    for(const e of game.enemies)if(e.kind==='brutus'){const helmet=this.scene.getObjectByName('Zombie '+e.id)?.getObjectByName('c_zom_cellbreaker_helmet');if(helmet)helmet.visible=e.helmet>0;}
    for(const rows of this.dynamic.values())for(const v of rows){if(v.entity.mobItem)v.object.visible=r.visible(v.entity);if(v.entity.mobPlane)v.object.visible=r.planeBuilt;}
  }
}
