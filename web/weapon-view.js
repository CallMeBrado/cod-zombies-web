import * as THREE from 'three';
import {model,cloneModel,originalAnimation,shadeModel,applyHideTags} from './assets.js';
const DIAL_AXIS=new THREE.Vector3(0,1,0);

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
    const object=cloneModel(hands),gun=cloneModel(template);applyHideTags(gun,weapon.definition.hideTags);
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
    this.flashFx=undefined;this.rigs.set(weapon.name,{root,object,mixer,clips,adsAction:this.adsAction,flash:this.flash,flashFx:undefined,knife});
  }
  play(name,duration=0,loop=false,hold=false,fade=.035) {
    const clip=this.clips.get(name);if(!clip)return;this.sprintAnim=null;
    let action=this.actions.get(name);if(!action){action=this.mixer.clipAction(clip);this.actions.set(name,action);}
    if(this.current&&this.current!==action)this.current.fadeOut(fade);
    action.reset().setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);action.clampWhenFinished=!loop;
    action.setEffectiveWeight(1).setEffectiveTimeScale(duration>0?clip.duration/duration:1).fadeIn(Math.min(fade,.025)).play();
    this.current=action;this.actionDue=loop?Infinity:(duration||clip.duration);this.actionElapsed=0;this.hold=hold;
    this.queue=(clip.userData?.notifies||[]).map(n=>({...n,due:n.time*this.actionDue}));
  }
  shot(ads) {
    if(!this.root)return;const d=this.weapon.definition;
    this.sprintBlend=0;this.root.position.set(0,0,0);this.root.rotation.set(0,0,0);this.root.scale.setScalar(1);
    // A looping fire cycle (the Paralyzer's spinning gears) keeps turning
    // while the shots continue instead of restarting on each one.
    const fire=ads>.8?(this.weapon.clip?d.adsFireAnim:d.adsLastShotAnim):(this.weapon.clip?d.fireAnim:d.lastShotAnim),clip=this.clips.get(fire);
    if(clip?.userData.loop&&this.current?.getClip()===clip&&this.current.isRunning())this.actionDue=this.actionElapsed+clip.duration;
    else{this.play(fire);if(clip?.userData.loop)this.current.setLoop(THREE.LoopRepeat,Infinity);}
    this.flashTime=.045;
    // The weapon's own muzzle flash effect (viewFlashEffect) on tag_flash,
    // made on the first shot once the effect textures are ready.
    if(this.flashFx===undefined&&this.effects?.ready){const name=d.viewFlashEffect,tag=this.object.getObjectByName('tag_flash');
      this.flashFx=name&&tag&&this.effects.has(name)?this.effects.create(name,0):null;if(this.flashFx){this.flashFx.visible=false;tag.add(this.flashFx);}
      const rig=this.rigs.get(this.weapon.name);if(rig)rig.flashFx=this.flashFx;}
    // A looping flash effect (fx_paralyzer_on_view) runs on through a burst.
    if(this.flashFx){const looping=this.flashFx.userData.fx.emitters.some(e=>e.e.looping);
      if(looping&&this.flashFx.visible&&(this.time||0)<this.flashFxDue)this.flashFxDue=Math.max(this.flashFxDue,(this.time||0)+Math.max(.15,d.fireTime*1.5));
      else{this.effects.restart(this.flashFx,this.time||0);this.flashFx.visible=true;this.flashFxDue=looping?(this.time||0)+Math.max(.15,d.fireTime*1.5):this.effects.endTime(this.flashFx);}
      this.flashTime=0;}
    this.rechamberAt=d.rechamberAnim&&this.weapon.clip>0?Math.max(.12,d.fireTime):0;
  }
  reload({empty,duration}){this.rechamberAt=0;this.play(empty?this.weapon.definition.reloadEmptyAnim:this.weapon.definition.reloadAnim,duration);}
  // The Paralyzer's counter: tag_control_dial_1-3 are its hundreds, tens and
  // ones wheels (6 5 4 3 2 1 0 9 8 7 around local Y, 0 at 125°), turned so
  // the heat reads through the window facing the eye (126°).
  showDial(value){
    if(this.dialObject!==this.object){this.dialObject=this.object;this.dialBones=[1,2,3].map(k=>this.object.getObjectByName('tag_control_dial_'+k)).filter(Boolean);}
    const n=Math.max(0,Math.min(999,Math.floor(value))),digits=[Math.floor(n/100),Math.floor(n/10)%10,n%10];
    this.dialBones.forEach((bone,k)=>bone.quaternion.setFromAxisAngle(DIAL_AXIS,THREE.MathUtils.degToRad(125-36*digits[k]-126)));
  }
  offhand(){this.rechamberAt=0;this.flashTime=0;this.play(this.weapon.clip?this.weapon.definition.idleAnim:this.weapon.definition.emptyIdleAnim,0,true);}
  melee({duration,charge=false}={}){const d=this.weapon.definition;this.rechamberAt=0;this.sprintBlend=0;this.meleeRemaining=duration||d.meleeTime||.5;this.knife.visible=true;this.play(charge&&this.clips.has(d.meleeChargeAnim)?d.meleeChargeAnim:d.meleeAnim,this.meleeRemaining);}
  dive({phase,duration=0}){const d=this.weapon.definition,empty=!this.weapon.clip,key=phase[0].toUpperCase()+phase.slice(1),anim=empty&&this.clips.has(d['dtp'+key+'EmptyAnim'])?d['dtp'+key+'EmptyAnim']:d['dtp'+key+'Anim'];this.rechamberAt=0;this.flashTime=0;this.meleeRemaining=0;this.play(anim||({in:d.sprintInAnim,loop:d.sprintLoopAnim,out:d.raiseAnim})[phase],duration,phase==='loop',phase==='in');}
  update(dt,{ads,moving,sprinting,stance='stand',time,reloading,offhand=0}) {
    if(!this.root)return;
    this.actionElapsed+=dt;
    while(this.queue.length&&this.queue[0].due<=this.actionElapsed){const n=this.queue.shift(),alias=n.name.startsWith('sndnt#')?n.name.slice(6):(this.weapon.definition.notetrackSoundMap||'').split('\n').find(l=>l.split(/\s+/)[0]===n.name)?.split(/\s+/)[1];if(alias)this.audio.play(alias);}
    if(this.rechamberAt>0){this.rechamberAt-=dt;if(this.rechamberAt<=0)this.play(ads>.8?this.weapon.definition.adsRechamberAnim:this.weapon.definition.rechamberAnim,this.weapon.definition.rechamberTime);}
    const d=this.weapon.definition,target=sprinting&&moving&&ads<.1&&!reloading&&!offhand&&this.meleeRemaining<=0?1:0;
    // Black Ops weapons sprint with their own clips (in, loop, out; empty
    // variants at zero ammo) instead of WaW's procedural sprint offsets.
    if(d.sprintLoopAnim&&this.clips.has(d.sprintLoopAnim)){
      const empty=!this.weapon.clip,clip=(full,emptyName)=>empty&&this.clips.has(emptyName)?emptyName:full;
      if(target&&(!this.sprintAnim||this.sprintAnim==='out')){this.play(clip(d.sprintInAnim,d.sprintInEmptyAnim),d.sprintInTime||.3,false,true);this.sprintAnim='in';}
      else if(target&&this.sprintAnim==='in'&&this.actionElapsed>=this.actionDue){this.play(clip(d.sprintLoopAnim,d.sprintLoopEmptyAnim),d.sprintLoopTime||0,true);this.sprintAnim='loop';}
      // Aiming blends the sprint pose straight back to idle under the rising
      // sights; the sprint-out clip beneath the aim pose swung the arms across the view.
      else if(!target&&ads>0&&this.sprintAnim){this.play(clip(d.idleAnim,d.emptyIdleAnim),0,true,false,.12);}
      else if(!target&&(this.sprintAnim==='in'||this.sprintAnim==='loop')){this.play(clip(d.sprintOutAnim,d.sprintOutEmptyAnim),d.sprintOutTime||.3);this.sprintAnim='out';}
    }
    const idle=this.weapon.clip?this.weapon.definition.idleAnim:this.weapon.definition.emptyIdleAnim,name=this.current?.getClip().name;
    // Physics can refill the magazine just after the rendered reload clip ends.
    // A looping empty idle must then change back to the loaded idle pose.
    if(this.actionElapsed>=this.actionDue&&!this.hold||(!reloading&&name!==idle&&[this.weapon.definition.idleAnim,this.weapon.definition.emptyIdleAnim].includes(name)))this.play(idle,0,true);
    this.meleeRemaining=Math.max(0,this.meleeRemaining-dt);this.knife.visible=this.meleeRemaining>0;
    if(this.adsAction){this.adsAction.time=this.adsAction.getClip().duration;this.adsAction.setEffectiveWeight(reloading||this.meleeRemaining>0?0:ads*(1-offhand));}
    this.mixer.update(dt);
    if(this.dialValue!=null)this.showDial(this.dialValue);
    this.sprintBlend=THREE.MathUtils.clamp(this.sprintBlend+(target?1:-1)*dt/(target?d.sprintInTime||.3:d.sprintOutTime||.3),0,1);
    const blend=this.sprintBlend*this.sprintBlend*(3-2*this.sprintBlend),phase=time*2*Math.PI/(d.sprintLoopTime||.65);
    const bob=moving?(1-ads*.85)*(stance==='prone'?.35:stance==='crouch'?.65:1):0,h=.12*(1-blend)+blend*(d.sprintBobH||6)*.08,v=.12*(1-blend)+blend*(d.sprintBobV||8)*.08;
    this.root.position.set(-(d.sprintOfsR||0)*blend+Math.sin(phase)*h*bob,(d.sprintOfsU||0)*blend+Math.cos(phase*2)*v*bob,-(d.sprintOfsF||0)*blend);
    // Native positive pitch points forward/down. In the view camera's -Z
    // forward, +Y up coordinates that is a negative rotation about X.
    this.root.rotation.set(-THREE.MathUtils.degToRad(d.sprintRotP||0)*blend,THREE.MathUtils.degToRad(d.sprintRotY||0)*blend,-THREE.MathUtils.degToRad(d.sprintRotR||0)*blend,'YXZ');
    this.root.scale.setScalar(1+((d.sprintScale||1)-1)*blend);
    this.root.position.y-=20*offhand;
    this.flashTime=Math.max(0,this.flashTime-dt);this.flash.visible=this.flashTime>0;this.flash.rotation.x=Math.random()*Math.PI;
    this.time=time;if(this.flashFx?.visible){if(time>this.flashFxDue)this.flashFx.visible=false;else this.effects.update(this.flashFx,time);}
  }
}
