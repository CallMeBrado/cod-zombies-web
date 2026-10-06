import * as THREE from 'three';
import {model,cloneModel,originalAnimation,shadeModel} from './assets.js';

// Arthur uses his original T6 skeleton and animations, prepared before play.
export class BuriedView {
  constructor(scene,map,dynamic){this.scene=scene;this.map=map;this.dynamic=dynamic;this.root=new THREE.Group();this.actions=new Map();this.position=null;this.equipment=new Map();this.templates=new Map();this.projectiles=new Map();this.projectileTemplates=new Map();}
  async prepare(manifest){
    this.object=cloneModel(await model(manifest.map.arthurModel));shadeModel(this.object,[.4,.34,.26]);this.root.add(this.object);this.scene.add(this.root);
    this.mixer=new THREE.AnimationMixer(this.object);
    for(const name of manifest.map.arthurAnimations){const action=this.mixer.clipAction(await originalAnimation(name,this.object,true));this.actions.set(name,action);}
    this.root.position.fromArray(manifest.entities.find(e=>e.targetname==='sloth_idle_pos').origin.split(' ').map(Number));this.root.rotation.z=-Math.PI/2;
    this.manifest=manifest;
    for(const [kind,d]of Object.entries(manifest.equipment)){
      const object=cloneModel(await model(d.model));shadeModel(object,[.4,.34,.26]);
      const clips=new Map();for(const name of [d.animation,d.launchAnimation].filter(Boolean))clips.set(name,await originalAnimation(name,object,false));this.templates.set(kind,{object,clips});
    }
    for(const d of Object.values(manifest.weapons))if(d.weaponType==='projectile'&&d.projectileModel&&!this.projectileTemplates.has(d.projectileModel)){
      const object=cloneModel(await model(d.projectileModel));shadeModel(object,[1,1,1]);
      if(d.projectileModel==='tag_flash')object.add(new THREE.Mesh(new THREE.SphereGeometry(2,8,6),new THREE.MeshBasicMaterial({color:new THREE.Color(d.projectileRed,d.projectileGreen,d.projectileBlue)})));
      this.projectileTemplates.set(d.projectileModel,object);
    }
  }
  item({id,visible}){for(const v of this.dynamic.get(id)||[])v.object.visible=visible;}
  place(item){
    const template=this.templates.get(item.kind),object=cloneModel(template.object),root=new THREE.Group();root.add(object);root.position.fromArray(item.position);root.rotation.z=item.yaw;this.scene.add(root);
    const mixer=new THREE.AnimationMixer(object),actions=new Map([...template.clips].map(([name,clip])=>[name,mixer.clipAction(clip)]));const idle=this.manifest.equipment[item.kind].animation;actions.get(idle)?.play();this.equipment.set(item.id,{root,mixer,actions,item});
  }
  remove(id){const v=this.equipment.get(id);if(v){v.mixer.stopAllAction();this.scene.remove(v.root);this.equipment.delete(id);}}
  launch(item){const v=this.equipment.get(item.id),name=this.manifest.equipment[item.kind].launchAnimation;if(!v||!name)return;const a=v.actions.get(name);a.setLoop(THREE.LoopOnce,1).reset().play();}
  projectile(p){const d=this.manifest.weapons[p.weapon],root=cloneModel(this.projectileTemplates.get(d.projectileModel));root.position.fromArray(p.position);this.scene.add(root);this.projectiles.set(p.id,{root,p});}
  removeProjectile(id){const v=this.projectiles.get(id);v?.root.removeFromParent();this.projectiles.delete(id);}
  reset(){for(const id of this.equipment.keys())this.remove(id);for(const id of this.projectiles.keys())this.removeProjectile(id);this.rules=null;}
  update(game,dt){
    const rules=game.mapRules,p=rules.arthurPosition,moving=this.position&&Math.hypot(p[0]-this.position[0],p[1]-this.position[1])>.01;
    for(const items of this.dynamic.values())for(const v of items){
      if(v.entity.nativeItemTarget||v.entity.buriedPart)v.object.visible=(!v.entity.nativeItemTarget||rules.activeItems.has(v.entity.itemId))&&!rules.collected.has(v.entity.itemId)&&(v.entity.nativeItemTarget!=='keys_zm_p6_zm_bu_sloth_key'||!rules.arthurReleased);
      if(v.entity.nativeMaze)v.object.visible=!game.collision.disabled.has(v.entity.targetname);
      if(v.entity.chalkMark)v.object.visible=!rules.chalk.has(v.entity.targetname);
    }
    for(const v of this.equipment.values())v.mixer.update(dt);
    for(const {root,p}of this.projectiles.values()){const from=p.previousPosition||p.position,t=Math.min(1,game.accumulator*120);root.position.set(...p.position.map((x,k)=>from[k]+(x-from[k])*t));root.rotation.z=Math.atan2(p.velocity[1],p.velocity[0]);}
    if(moving)this.root.rotation.z=Math.atan2(p[1]-this.position[1],p[0]-this.position[0]);this.root.position.fromArray(p);this.position=p.slice();
    const name=!rules.arthurReleased?'ai_zombie_sloth_idle_jail':rules.arthurJob?'ai_zombie_sloth_run':moving?'ai_zombie_sloth_walk':'ai_zombie_sloth_idle';
    if(name!==this.current){this.actions.get(this.current)?.fadeOut(.15);this.actions.get(name)?.reset().fadeIn(.15).play();this.current=name;}
    this.mixer.update(dt);
    const c=this.map.illumination(p);this.object.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])m.color.setRGB(...c);});
  }
}
