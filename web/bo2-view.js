import * as THREE from 'three';
import {model,cloneModel,originalAnimation,shadeModel,restRelative} from './assets.js';
import {ARTHUR_LOOPS} from './bo2-arthur.js';

// A clip held at a time the game decides, so the picture follows the host's
// state (and its saves) instead of drifting on its own clock.
class Posed {
  constructor(object){this.object=object;this.mixer=new THREE.AnimationMixer(object);this.actions=new Map();this.current=null;}
  async add(name,shared=false){this.actions.set(name,this.mixer.clipAction(restRelative(await originalAnimation(name,this.object,shared),this.object)));}
  duration(name){return this.actions.get(name)?.getClip().duration||0;}
  pose(name,time){
    const action=this.actions.get(name);if(!action)return;
    if(this.current!==action){this.mixer.stopAllAction();action.reset().play();this.current=action;}
    action.time=Math.max(0,Math.min(time,action.getClip().duration));this.mixer.update(0);
  }
}
const SLOTH='ai_zombie_sloth_';

// Arthur, the cell door, the start area's fxanims and the mystery box's
// zbarrier pieces use their original T6 models and animations.
export class BuriedView {
  constructor(scene,map,dynamic,effects){this.scene=scene;this.map=map;this.dynamic=dynamic;this.effects=effects;this.root=new THREE.Group();this.actions=new Map();this.equipment=new Map();this.templates=new Map();this.projectiles=new Map();this.projectileTemplates=new Map();this.boxes=new Map();}
  async prepare(manifest,presentation={}){
    const m=manifest.map;this.manifest=manifest;this.boxSettings=presentation.box||{floatHeight:40};
    this.props={};this.fxanims={};
    if(m.arthurModel){
    this.object=cloneModel(await model(m.arthurModel));shadeModel(this.object,[.4,.34,.26]);this.root.add(this.object);this.scene.add(this.root);
    this.mixer=new THREE.AnimationMixer(this.object);
    for(const name of m.arthurAnimations){const action=this.mixer.clipAction(restRelative(await originalAnimation(name,this.object,true),this.object));const loop=ARTHUR_LOOPS.has(name.slice(SLOTH.length));
      action.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);action.clampWhenFinished=!loop;this.actions.set(name,action);}
    // The booze jug and candy bowl ride on his right hand (tag_weapon_right).
    this.props={};const hand=this.object.getObjectByName('tag_weapon_right')||this.object.getObjectByName('j_wrist_ri');
    for(const [kind,name]of Object.entries(m.arthurProps||{})){const prop=cloneModel(await model(name)),mount=new THREE.Group();shadeModel(prop,[.4,.34,.26]);prop.rotation.set(Math.PI/2,0,0);mount.add(prop);mount.visible=false;hand?.add(mount);this.props[kind]=mount;}
    this.root.position.fromArray(manifest.entities.find(e=>e.targetname==='sloth_idle_pos').origin.split(' ').map(Number));this.root.rotation.z=-Math.PI/2;
    const door=this.dynamic.get('sloth_cell_door')?.[0];
    if(door){this.door=new Posed(door.object);for(const name of Object.keys(m.doorClips||{}))await this.door.add(name);}
    this.fxanims={};
    for(const [key,modelName,clip]of [['catwalk','fxanim_zom_buried_catwalk_mod','fxanim_zom_buried_catwalk_anim'],['boards','fxanim_zom_buried_board_drop_start_mod','fxanim_zom_buried_board_drop_start_anim']]){
      const item=[...this.dynamic.values()].flat().find(v=>v.entity.model===modelName);if(!item)continue;
      const posed=new Posed(item.object);try{await posed.add(clip);posed.pose(clip,0);this.fxanims[key]={posed,clip};}catch(error){console.warn(error);}
    }
    }
    await this.prepareBoxes(manifest);
    for(const [kind,d]of Object.entries(manifest.equipment)){
      const object=cloneModel(await model(d.model));shadeModel(object,[.4,.34,.26]);
      const clips=new Map();for(const name of [d.animation,d.launchAnimation].filter(Boolean))clips.set(name,restRelative(await originalAnimation(name,object,false),object));this.templates.set(kind,{object,clips});
    }
    for(const d of Object.values(manifest.weapons))if(d.weaponType==='projectile'&&d.projectileModel&&!this.projectileTemplates.has(d.projectileModel)){
      const object=cloneModel(await model(d.projectileModel));shadeModel(object,[1,1,1]);
      if(d.projectileModel==='tag_flash')object.add(new THREE.Mesh(new THREE.SphereGeometry(2,8,6),new THREE.MeshBasicMaterial({color:new THREE.Color(d.projectileRed,d.projectileGreen,d.projectileBlue)})));
      this.projectileTemplates.set(d.projectileModel,object);
    }
  }
  // Each location has the box (open/close/leave/arrive) and, while the box is
  // elsewhere, its "away" piece (p6_anim_zm_magic_box_fake). The teddy bear
  // replaces the weapon when the box moves.
  async prepareBoxes(manifest){
    const fake=await model('p6_anim_zm_magic_box_fake').catch(()=>null),teddy=await model('zombie_teddybear').catch(()=>null);
    for(const e of manifest.entities.filter(e=>e.targetname==='treasure_chest_use')){
      const item=this.dynamic.get(e.target)?.[0];if(!item)continue;
      const posed=new Posed(item.object);for(const n of ['open','close','leave','arrive'])try{await posed.add('o_zombie_magic_box_'+n);}catch(error){console.warn(error);}
      const origin=item.entity.origin.split(/\s+/).map(Number),yaw=Number((item.entity.angles||'0 0 0').split(/\s+/)[1]);
      const light=this.map.illumination([origin[0],origin[1],origin[2]+20]);
      let away=null;if(fake){away=cloneModel(fake);shadeModel(away,light);away.position.fromArray(origin);away.rotation.set(0,0,THREE.MathUtils.degToRad(yaw));this.scene.add(away);}
      let bear=null;if(teddy){bear=cloneModel(teddy);shadeModel(bear,light);bear.visible=false;bear.rotation.set(0,0,THREE.MathUtils.degToRad(yaw+90));this.scene.add(bear);}
      this.boxes.set(e.target,{item,posed,away,bear,origin});
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
  reset(){for(const w of this.wallbuys||[])if(w.entity){w.root&&this.effects.dispose(w.root);w.root=null;w.drawn=undefined;}
    for(const id of this.equipment.keys())this.remove(id);for(const id of this.projectiles.keys())this.removeProjectile(id);this.current=null;}
  update(game,dt){
    const rules=game.mapRules,a=rules.arthur;
    for(const items of this.dynamic.values())for(const v of items){
      if(v.entity.nativeItemTarget||v.entity.buriedPart)v.object.visible=!this.chalkPieces?.has(v.entity.itemId)&&rules.itemVisible({...v.entity,itemId:v.entity.itemId});
      if(v.entity.nativeMaze)v.object.visible=!game.collision.disabled.has(v.entity.targetname);
      if(v.entity.chalkMark)v.object.visible=!rules.chalk.has(v.entity.targetname);
    }
    for(const v of this.equipment.values())v.mixer.update(dt);
    for(const {root,p}of this.projectiles.values()){const from=p.previousPosition||p.position,t=Math.min(1,game.accumulator*120);root.position.set(...p.position.map((x,k)=>from[k]+(x-from[k])*t));root.rotation.z=Math.atan2(p.velocity[1],p.velocity[0]);}
    if(a){this.updateArthur(game,a,dt);
      if(this.door){const d=a.door;if(d)this.door.pose(d.clip,game.time-d.started);}
      for(const [key,f]of Object.entries(this.fxanims)){const at=rules.fxanims[key];f.posed.pose(f.clip,at==null?0:game.time-at);}}
    this.updateBoxes(game);
    this.updateWallbuys(game);
  }
  // Wall buys are chalk outlines drawn by their effects, facing out from the
  // wall (playfx along the wall buy's forward and up). An undrawn chalk spot
  // shows the question mark until a weapon is drawn there.
  wallbuyRoot(name,e){
    if(!this.effects?.has(name))return null;const root=this.effects.create(name,0),a=(e.angles||'0 0 0').split(/\s+/).map(v=>Number(v)*Math.PI/180);
    root.position.fromArray(e.origin.split(/\s+/).map(Number));root.rotation.set(a[2],a[0],a[1],'ZYX');this.scene.add(root);return root;
  }
  updateWallbuys(game){
    const fx=this.manifest.map.wallbuyEffects;if(!fx||!this.effects)return;
    if(!this.wallbuys){
      this.wallbuys=[];
      for(const e of this.manifest.entities.filter(e=>e.targetname==='weapon_upgrade'))this.wallbuys.push({root:this.wallbuyRoot(fx[e.zombie_weapon_upgrade]||fx.m14_zm,e)});
      for(const e of this.manifest.entities.filter(e=>e.chalkMark))this.wallbuys.push({entity:e,drawn:null,root:this.wallbuyRoot(fx.question,e)});
      // Chalk pieces are drawn only by their chalk effect (piece_spawn_chalk_internal).
      const pieces=this.manifest.map.chalkPieceEffects||{};this.chalkPieces=new Map();
      for(const e of this.manifest.entities.filter(e=>e.nativeItemTarget?.includes('chalk'))){const root=this.wallbuyRoot(pieces[e.zombie_weapon_upgrade]||pieces.m14_zm,e);if(root)this.chalkPieces.set(e.itemId,{entity:e,root});}
    }
    for(const p of this.chalkPieces.values()){p.root.visible=game.mapRules.itemVisible(p.entity);if(p.root.visible)this.effects.update(p.root,game.time);}
    for(const w of this.wallbuys){
      if(w.entity){const drawn=game.mapRules.chalk.get(w.entity.targetname)||null;
        if(drawn!==w.drawn){w.root&&this.effects.dispose(w.root);w.drawn=drawn;w.root=this.wallbuyRoot(drawn?fx[drawn]||fx.m14_zm:fx.question,w.entity);}}
      if(w.root)this.effects.update(w.root,game.time);
    }
    this.dust=(this.dust||[]).filter(d=>{if(game.time>d.due){this.effects.dispose(d.root);return false;}this.effects.update(d.root,game.time);return true;});
  }
  // player_draw_chalk(): chalk dust off the wall while drawing.
  chalkDust(target,time){
    const e=this.manifest.entities.find(x=>x.targetname===target),name=this.manifest.map.wallbuyEffects?.drawing;if(!e||!this.effects?.has(name))return;
    const root=this.effects.create(name,time),a=(e.angles||'0 0 0').split(/\s+/).map(v=>Number(v)*Math.PI/180);root.position.fromArray(e.origin.split(/\s+/).map(Number));root.rotation.set(a[2],a[0],a[1],'ZYX');this.scene.add(root);
    (this.dust||=[]).push({root,due:time+1.5});
  }
  updateArthur(game,a,dt){
    this.root.position.fromArray(a.position);this.root.rotation.z=a.yaw;
    const name=SLOTH+a.clip,action=this.actions.get(name);
    if(action&&name!==this.current){
      const previous=this.actions.get(this.current);action.reset().setEffectiveWeight(1).play();
      if(previous)action.crossFadeFrom(previous,.2,false);this.current=name;
    }
    this.mixer.update(dt);
    // Keep the clip on the host's clock (a one-shot ends when the game says).
    if(action){const length=action.getClip().duration,age=game.time-a.clipStarted,want=ARTHUR_LOOPS.has(a.clip)?age%length:Math.min(age,length);if(Math.abs(action.time-want)>.15)action.time=want;}
    for(const [kind,mount]of Object.entries(this.props))mount.visible=a.prop===kind;
    const c=this.map.illumination(a.position);this.object.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])m.color.setRGB(...c);});
  }
  updateBoxes(game){
    const clips=this.manifest.map.boxClips||{},float=this.boxSettings.floatHeight||40;
    for(const [target,v]of this.boxes){
      const box=game.boxes.get(target),active=target===game.activeBox||!!game.powerup.fire_sale;let clip=null,time=0,shown=active||['cycling','offered','closing'].includes(box.phase);
      if(box.phase==='cycling'||box.phase==='offered'||box.phase==='teddy'){clip='o_zombie_magic_box_open';time=game.time-box.started;}
      else if(box.phase==='closing'){clip='o_zombie_magic_box_close';time=game.time-box.closedAt;}
      else if(box.phase==='leaving'){time=game.time-box.started;shown=time<(clips.leave||7.5);clip='o_zombie_magic_box_leave';}
      else if(box.phase==='arriving'){clip='o_zombie_magic_box_arrive';time=game.time-box.started;shown=true;}
      else if(active){clip='o_zombie_magic_box_close';time=99;}
      v.item.object.visible=shown;if(v.away)v.away.visible=!shown;
      if(shown&&clip)v.posed.pose(clip,time);
      // treasure_chest_move(): the bear flies 500 up over 4 s (3 s of it
      // accelerating) 2.5 s after it appears.
      if(v.bear){v.bear.visible=box.phase==='teddy';if(v.bear.visible){const s=game.time-box.offeredAt-2.5,a=500/7.5,rise=s<=0?0:s<3?.5*a*s*s:4.5*a+3*a*(s-3);v.bear.position.set(v.origin[0],v.origin[1],v.origin[2]+float+rise);}}
    }
  }
}
