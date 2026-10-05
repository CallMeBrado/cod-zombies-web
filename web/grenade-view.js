import * as THREE from 'three';
import {model,cloneModel,originalAnimation,shadeModel} from './assets.js';

// An offhand rig: the native grenade clips animate the same hands as firearms.
export class GrenadeView {
 constructor(scene,definition){this.scene=scene;this.definition=definition;this.sequence=null;this.root=null;this.phase='idle';}
 async prepare(light){
  const [hands,grenade]=await Promise.all([model('viewmodel_hands'),model(this.definition.gunModel)]);
  this.object=cloneModel(hands);this.held=cloneModel(grenade);this.object.getObjectByName('tag_weapon').add(this.held);shadeModel(this.object,light.map(c=>Math.max(.09,c*1.5)));
  // Offhand clips omit tag_torso. The engine supplies a neutral torso pose;
  // retaining the generic hands' bind offset pushes the throw offscreen.
  const torso=this.object.getObjectByName('tag_torso');torso.position.set(0,0,0);torso.quaternion.identity();
  this.root=new THREE.Group();const orientation=new THREE.Group();orientation.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(0,-1,0,0,0,0,1,0,-1,0,0,0,0,0,0,1));orientation.add(this.object);this.root.add(orientation);this.root.visible=false;this.scene.add(this.root);
  this.mixer=new THREE.AnimationMixer(this.object);this.actions=new Map();
  for(const name of [this.definition.idleAnim,this.definition.holdFireAnim,this.definition.fireAnim,this.definition.altRaiseAnim].filter(Boolean)){const clip=await originalAnimation(name,this.object);this.actions.set(name,this.mixer.clipAction(clip));}
  const idle=this.actions.get(this.definition.idleAnim);idle.play();idle.paused=true;idle.time=0;this.mixer.update(0);
  this.base=[];this.object.traverse(n=>{if(n.isBone)this.base.push({bone:n,position:n.position.clone(),rotation:n.quaternion.clone()});});this.mixer.stopAllAction();
 }
 start(sequence){this.sequence=sequence;this.phase='lower';this.current=null;this.mixer.stopAllAction();for(const b of this.base){b.bone.position.copy(b.position);b.bone.quaternion.copy(b.rotation);}this.held.visible=true;}
 reset(){this.sequence=null;this.phase='idle';if(this.root){this.root.visible=false;this.root.position.y=0;}this.mixer?.stopAllAction();}
 update(time,visible=true){
  const s=this.sequence,d=this.definition;if(!s)return 0;if(time>=s.end){this.reset();return 0;}
  const throwing=time>=s.throwAt,pulling=time>=s.pullAt,raiseAt=s.throwAt+d.fireTime;
  this.phase=time>=raiseAt?'raise':throwing?'throw':pulling?(s.rethrow?'pickup':s.cooking&&time>=s.holdEnd?'cook':'pullpin'):'lower';this.root.visible=visible&&pulling&&time<raiseAt;
  // Keep the low reaching gesture inside the browser view and blend back
  // before the native throw starts. The clip's bone motion remains intact.
  this.root.position.y=s.rethrow?6*THREE.MathUtils.smoothstep(time,s.started,s.pullAt+.12)*(1-THREE.MathUtils.smoothstep(time,s.throwAt-.15,s.throwAt)):0;
  if(pulling){const name=throwing?d.fireAnim:s.rethrow&&d.altRaiseAnim?d.altRaiseAnim:d.holdFireAnim,action=this.actions.get(name),duration=throwing?d.fireTime:(s.holdEnd??s.throwAt)-s.pullAt;
   if(this.current!==action){this.mixer.stopAllAction();action.reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;this.current=action;}
   action.time=Math.min(action.getClip().duration,(time-(throwing?s.throwAt:s.pullAt))/duration*action.getClip().duration);this.mixer.update(0);
  }
  this.held.visible=time<s.releaseAt;
  const blend=time<s.pullAt?(time-s.started)/(s.pullAt-s.started):time<raiseAt?1:1-(time-raiseAt)/d.raiseTime;
  return THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(blend,0,1),0,1);
 }
 diagnostics(){return {phase:this.phase,active:!!this.sequence,visible:!!this.root?.visible,held:!!this.held?.visible,animation:this.current?.getClip().name,sequence:this.sequence};}
}
