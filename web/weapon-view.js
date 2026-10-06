import * as THREE from 'three';
import {model,cloneModel,originalAnimation,shadeModel} from './assets.js';

export class WeaponView {
  constructor(scene,audio){this.scene=scene;this.audio=audio;this.version=0;this.root=null;this.actions=new Map();this.current=null;this.ads=0;this.queue=[];this.rigs=new Map();this.sprintBlend=0;}
  async prepare(weapons,light){for(const [name,definition]of Object.entries(weapons))await this.load({name,definition,clip:definition.clipSize},light);}
  activate(rig,weapon){
    if(this.root)this.scene.remove(this.root);
    Object.assign(this,rig);this.weapon=weapon;this.mixer.stopAllAction();this.actions=new Map();this.current=null;this.queue=[];this.sprintBlend=0;this.meleeRemaining=0;this.flashTime=0;this.rechamberAt=0;
    const torso=this.object.getObjectByName('tag_torso'),base=this.clips.get(weapon.definition.adsUpAnim);
    if(torso&&base)for(const track of base.tracks){if(track.name===torso.uuid+'.position')torso.position.fromArray(track.values);if(track.name===torso.uuid+'.quaternion')torso.quaternion.fromArray(track.values);}
    this.scene.add(this.root);this.play(weapon.definition.idleAnim,0,true);this.knife.visible=false;
    if(this.adsAction){this.adsAction.reset().play();this.adsAction.paused=true;this.adsAction.time=this.adsAction.getClip().duration;this.adsAction.setEffectiveWeight(0);}
    this.mixer.update(.03);
  }
  async load(weapon,light) {
    const version=++this.version;
    if(this.rigs.has(weapon.name)){this.activate(this.rigs.get(weapon.name),weapon);return;}
    // Perk bottles and the knuckle crack are viewmodel-only and carry no knife.
    const [hands,template,knifeTemplate]=await Promise.all([model(weapon.definition.handsModel||'viewmodel_hands'),model(weapon.definition.gunModel),weapon.definition.knifeModel?model(weapon.definition.knifeModel):null]);
    const object=cloneModel(hands),gun=cloneModel(template);
    // Attached weapon parts use XAnim translations relative to their model
    // bind positions; hand tracks use their authored local positions.
    gun.traverse(bone=>{if(bone.isBone)bone.userData.animationTranslationBase=bone.position.toArray();});
    object.getObjectByName('tag_weapon').add(gun);
    const knife=knifeTemplate?cloneModel(knifeTemplate):new THREE.Group();knife.name='Original Ka-Bar knife';(object.getObjectByName('tag_knife_attach')||object.getObjectByName('tag_weapon')).add(knife);knife.visible=false;
    const root=new THREE.Group(),orientation=new THREE.Group();
    orientation.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(0,-1,0,0,0,0,1,0,-1,0,0,0,0,0,0,1));orientation.add(object);root.add(orientation);
    shadeModel(object,light.map(c=>Math.max(.09,c*1.5)));
    const definition=weapon.definition,mixer=new THREE.AnimationMixer(object),clips=new Map();
    await Promise.all([...new Set(Object.entries(definition).filter(([k,v])=>k.endsWith('Anim')&&v&&!k.includes('Camera')).map(([,v])=>v))].map(async name=>{
      try{clips.set(name,await originalAnimation(name,object));}catch(error){console.warn(error.message);}
    }));
    if(version!==this.version)return;
    if(this.root){this.scene.remove(this.root);this.mixer.stopAllAction();}
    this.root=root;this.object=object;this.weapon=weapon;this.mixer=mixer;this.clips=clips;this.actions=new Map();this.current=null;this.queue=[];
    // The idle clip omits tag_torso. Its hip pose comes from the first frame of
    // ADS-up, rather than the generic hands model's unposed bind transform.
    const torso=object.getObjectByName('tag_torso'),adsBase=clips.get(definition.adsUpAnim);
    if(torso&&adsBase)for(const track of adsBase.tracks){
      if(track.name===torso.uuid+'.position')torso.position.fromArray(track.values);
      if(track.name===torso.uuid+'.quaternion')torso.quaternion.fromArray(track.values);
    }
    this.scene.add(root);this.play(definition.idleAnim,0,true);mixer.update(.03);
    // ADS clips are an additive torso transform, as in the original weapon rig.
    const adsClip=clips.get(definition.adsUpAnim)?.clone();
    if(adsClip){THREE.AnimationUtils.makeClipAdditive(adsClip,0,adsBase);this.adsAction=mixer.clipAction(adsClip);this.adsAction.setLoop(THREE.LoopOnce,1);this.adsAction.clampWhenFinished=true;this.adsAction.play();this.adsAction.paused=true;this.adsAction.time=adsClip.duration;this.adsAction.setEffectiveWeight(0);}else this.adsAction=null;
    this.flash=new THREE.Mesh(new THREE.ConeGeometry(1.4,5,5),new THREE.MeshBasicMaterial({color:0xffe8ba,transparent:true,opacity:.85,depthWrite:false}));
    this.flash.rotation.z=-Math.PI/2;this.flash.visible=false;object.getObjectByName('tag_flash')?.add(this.flash);
    this.knife=knife;this.meleeRemaining=0;this.sprintBlend=0;this.flashTime=0;this.rechamberAt=0;
    this.rigs.set(weapon.name,{root,object,mixer,clips,adsAction:this.adsAction,flash:this.flash,knife});
  }
  play(name,duration=0,loop=false,hold=false) {
    const clip=this.clips.get(name);if(!clip)return;
    let action=this.actions.get(name);if(!action){action=this.mixer.clipAction(clip);this.actions.set(name,action);}
    if(this.current&&this.current!==action)this.current.fadeOut(.035);
    action.reset().setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);action.clampWhenFinished=!loop;
    action.setEffectiveWeight(1).setEffectiveTimeScale(duration>0?clip.duration/duration:1).fadeIn(.025).play();
    this.current=action;this.actionDue=loop?Infinity:(duration||clip.duration);this.actionElapsed=0;this.hold=hold;
    this.queue=(clip.userData?.notifies||[]).map(n=>({...n,due:n.time*this.actionDue}));
  }
  shot(ads) {
    if(!this.root)return;const d=this.weapon.definition;
    this.sprintBlend=0;this.root.position.set(0,0,0);this.root.rotation.set(0,0,0);this.root.scale.setScalar(1);
    this.play(ads>.8?(this.weapon.clip?d.adsFireAnim:d.adsLastShotAnim):(this.weapon.clip?d.fireAnim:d.lastShotAnim));this.flashTime=.045;
    this.rechamberAt=d.rechamberAnim&&this.weapon.clip>0?Math.max(.12,d.fireTime):0;
  }
  reload({empty,duration}){this.rechamberAt=0;this.play(empty?this.weapon.definition.reloadEmptyAnim:this.weapon.definition.reloadAnim,duration);}
  offhand(){this.rechamberAt=0;this.flashTime=0;this.play(this.weapon.clip?this.weapon.definition.idleAnim:this.weapon.definition.emptyIdleAnim,0,true);}
  melee({duration,charge=false}={}){const d=this.weapon.definition;this.rechamberAt=0;this.sprintBlend=0;this.meleeRemaining=duration||d.meleeTime||.5;this.knife.visible=true;this.play(charge&&this.clips.has(d.meleeChargeAnim)?d.meleeChargeAnim:d.meleeAnim,this.meleeRemaining);}
  update(dt,{ads,moving,sprinting,time,reloading,offhand=0}) {
    if(!this.root)return;
    this.actionElapsed+=dt;
    while(this.queue.length&&this.queue[0].due<=this.actionElapsed){const n=this.queue.shift(),alias=(this.weapon.definition.notetrackSoundMap||'').split('\n').find(l=>l.split(/\s+/)[0]===n.name)?.split(/\s+/)[1];if(alias)this.audio.play(alias);}
    if(this.rechamberAt>0){this.rechamberAt-=dt;if(this.rechamberAt<=0)this.play(ads>.8?this.weapon.definition.adsRechamberAnim:this.weapon.definition.rechamberAnim,this.weapon.definition.rechamberTime);}
    const idle=this.weapon.clip?this.weapon.definition.idleAnim:this.weapon.definition.emptyIdleAnim,name=this.current?.getClip().name;
    // Physics can refill the magazine just after the rendered reload clip ends.
    // A looping empty idle must then change back to the loaded idle pose.
    if(this.actionElapsed>=this.actionDue&&!this.hold||(!reloading&&name!==idle&&[this.weapon.definition.idleAnim,this.weapon.definition.emptyIdleAnim].includes(name)))this.play(idle,0,true);
    this.meleeRemaining=Math.max(0,this.meleeRemaining-dt);this.knife.visible=this.meleeRemaining>0;
    if(this.adsAction){this.adsAction.time=this.adsAction.getClip().duration;this.adsAction.setEffectiveWeight(reloading||this.meleeRemaining>0?0:ads*(1-offhand));}
    this.mixer.update(dt);
    const d=this.weapon.definition,target=sprinting&&moving&&ads<.1&&!reloading&&!offhand&&this.meleeRemaining<=0?1:0;
    this.sprintBlend=THREE.MathUtils.clamp(this.sprintBlend+(target?1:-1)*dt/(target?d.sprintInTime||.3:d.sprintOutTime||.3),0,1);
    const blend=this.sprintBlend*this.sprintBlend*(3-2*this.sprintBlend),phase=time*2*Math.PI/(d.sprintLoopTime||.65);
    const bob=moving?(1-ads*.85):0,h=.12*(1-blend)+blend*(d.sprintBobH||6)*.08,v=.12*(1-blend)+blend*(d.sprintBobV||8)*.08;
    this.root.position.set(-(d.sprintOfsR||0)*blend+Math.sin(phase)*h*bob,(d.sprintOfsU||0)*blend+Math.cos(phase*2)*v*bob,-(d.sprintOfsF||0)*blend);
    // Native positive pitch points forward/down. In the view camera's -Z
    // forward, +Y up coordinates that is a negative rotation about X.
    this.root.rotation.set(-THREE.MathUtils.degToRad(d.sprintRotP||0)*blend,THREE.MathUtils.degToRad(d.sprintRotY||0)*blend,-THREE.MathUtils.degToRad(d.sprintRotR||0)*blend,'YXZ');
    this.root.scale.setScalar(1+((d.sprintScale||1)-1)*blend);
    this.root.position.y-=20*offhand;
    this.flashTime=Math.max(0,this.flashTime-dt);this.flash.visible=this.flashTime>0;this.flash.rotation.x=Math.random()*Math.PI;
  }
}
