import * as THREE from 'three';
import {model,cloneModel,originalAnimation,shadeModel,restRelative,t6Clips} from './assets.js';
import {ZombieHitTrace} from './zombie-hit-trace.js';
import {SkeletonRagdoll} from './ragdoll.js';
import {SeveredHead} from './gore.js';

// Retarget shared clips before gameplay. Spawning only acquires a prepared rig.
export class ZombieActors {
  constructor(scene,map,presentation){this.scene=scene;this.map=map;this.presentation=presentation;this.pool=[];this.active=new Map();}
  async prepare(){
    const [bodyTemplate,headTemplate]=await Promise.all([model(this.presentation.actors?.body||'char_ger_honorgd_body1_1'),model(this.presentation.actors?.head||'char_ger_honorgd_zombiehead1_1')]);
    const body=cloneModel(bodyTemplate),head=cloneModel(headTemplate);head.userData.zombieHeadRoot=true;
    if(this.presentation.gore?.neckModel){const neck=cloneModel(await model(this.presentation.gore.neckModel));neck.userData.zombieNeckRoot=true;neck.traverse(n=>{if(n.isMesh)n.userData.goreOnly=true;});(this.presentation.gore.neckMount==='body'?body:body.getObjectByName('j_spine4')).add(neck);}
    head.traverse(n=>{if(n.isMesh)n.userData.zombieHead=true;});body.getObjectByName('j_spine4')?.add(head);shadeModel(body,[1,1,1]);
    await this.prepareRig(body,Object.fromEntries(Object.keys(this.presentation.animations).map(n=>[n,n])),32,this.pool);
    this.variantPools=new Map();
    for(const [kind,config]of Object.entries(this.presentation.actorVariants||{})){
      const object=cloneModel(await model(config.body));shadeModel(object,[1,1,1]);const pool=[];this.variantPools.set(kind,pool);await this.prepareRig(object,config.animations,config.count||8,pool);
    }
  }
  async prepareRig(body,names,count,pool){
    const clips=new Map(await Promise.all(Object.entries(names).map(async([alias,name])=>{const clip=await originalAnimation(name,body,true);if(t6Clips)restRelative(clip,body);clip.name=alias;return [alias,clip];})));
    for(let i=0;i<count;i++){
      const object=cloneModel(body),root=new THREE.Group();root.add(object);
      const materials=[];object.traverse(n=>{if(!n.isMesh)return;n.frustumCulled=false;
        const clone=m=>{const copy=m.clone();copy.onBeforeCompile=m.onBeforeCompile;materials.push(copy);return copy;};
        n.material=Array.isArray(n.material)?n.material.map(clone):clone(n.material);
      });
      const mixer=new THREE.AnimationMixer(object),actions=new Map([...clips].map(([name,clip])=>[name,mixer.clipAction(clip)]));
      for(const [name,action]of actions){const once=name.includes('death')||name.includes('tear')||name.includes('traverse')||name.includes('attack');action.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;}
      let headModel,neckModel;object.traverse(n=>{if(n.userData.zombieHeadRoot)headModel=n;if(n.userData.zombieNeckRoot)neckModel=n;});
      const headRoot=new THREE.Group(),headFragment=new SeveredHead(headRoot);
      pool.push({pool,root,object,mixer,actions,materials,current:null,enemy:null,started:null,trace:new ZombieHitTrace(root),ragdoll:new SkeletonRagdoll(root),headModel,neckModel,headMount:headModel?.parent,headFragment,headRest:headModel&&{position:headModel.position.clone(),quaternion:headModel.quaternion.clone(),scale:headModel.scale.clone()}});
    }
  }
  acquire(enemy){
    const pool=this.variantPools?.get(enemy.kind)||this.pool;
    if(!pool.length){const corpse=[...this.active.values()].find(v=>v.pool===pool&&v.enemy.dead);if(corpse)this.release(corpse.enemy.id);}
    const v=pool.pop();if(!v)throw new Error('Prepared zombie actor pool exhausted.');
    v.enemy=enemy;v.current=null;v.started=null;v.traceTick=-1;v.trace.tick=-1;v.root.name='Zombie '+enemy.id;v.root.position.fromArray(enemy.position);v.root.rotation.z=enemy.angle;
    v.mixer.stopAllAction();this.restoreHead(v);v.ragdoll.reset();this.active.set(enemy.id,v);this.updateOne(v,0,enemy.position);this.light(v);this.scene.add(v.root);return v;
  }
  play(v,name,started=null){
    if(v.current===name&&v.started===started)return;
    const action=v.actions.get(name);if(!action)return;
    v.actions.get(v.current)?.fadeOut(.12);action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);if(v.current)action.fadeIn(.12);action.play();
    v.current=name;v.started=started;
  }
  restoreHead(v){
    v.headFragment?.reset();if(v.headModel){v.headMount.add(v.headModel);v.headModel.position.copy(v.headRest.position);v.headModel.quaternion.copy(v.headRest.quaternion);v.headModel.scale.copy(v.headRest.scale);v.headModel.visible=true;}if(v.neckModel)v.neckModel.visible=false;
  }
  severHead(v,direction){
    if(!v.headModel||v.headFragment.active)return;
    v.root.updateWorldMatrix(true,true);const center=v.headModel.getObjectByName('j_head').getWorldPosition(new THREE.Vector3()),headRoot=v.headFragment.root;
    headRoot.position.copy(center);headRoot.quaternion.identity();this.scene.add(headRoot);headRoot.updateWorldMatrix(true,false);headRoot.attach(v.headModel);v.ragdoll.detachObject(v.headModel);
    v.headFragment.start(center.toArray(),direction,v.enemy.id);if(v.neckModel)v.neckModel.visible=true;
  }
  kill(enemy,direction=null,strength=60){
    const v=this.active.get(enemy.id);if(!v||v.ragdoll.active||!v.ragdoll.ready)return false;
    v.root.position.fromArray(enemy.position);v.root.rotation.z=enemy.angle;
    if(!v.ragdoll.start(enemy,direction,strength,this.collision))return false;
    v.mixer.stopAllAction();v.ragdoll.restoreFrozen();v.current=null;v.started=null;v.trace.tick=-1;v.traceTick=-1;if(enemy.deathHeadshot)this.severHead(v,direction);return true;
  }
  updateOne(v,dt,position){
    const e=v.enemy;
    if(e.dead&&v.ragdoll.ready){this.kill(e);v.ragdoll.update(dt,this.collision);v.headFragment?.update(dt,this.collision);v.trace.tick=-1;v.traceTick=-1;return;}
    v.root.position.fromArray(position);v.root.rotation.z=e.angle;
    if(e.stage==='rise'&&!e.riseAnim)v.root.position.z-=50*Math.max(0,(e.riseUntil-e.spawnTime-e.age)/(e.riseUntil-e.spawnTime));
    let name=v.actions.has(e.gait)?e.gait:'ai_zombie_walk_v1',started=null;
    if(e.dead)name='ai_zombie_death_v1';
    else if(e.stage==='traverse')name=e.traverseAnim;
    else if(e.stage==='rise'&&e.riseAnim&&v.actions.has(e.riseAnim)){name=e.riseAnim;started=e.spawnTime;}
    else if(e.stage==='barrier'){name=e.tear?.name||'ai_zombie_idle_v1';started=e.tear?.started??null;}
    else if(e.attack&&v.actions.has(e.attack.name)){name=e.attack.name;started=e.attack.started;}
    else if(e.attacking)name='ai_zombie_attack_v1';
    this.play(v,name,started);
    const action=v.actions.get(name);
    if(action){
      action.paused=!e.dead&&(!!e.tear||e.stage==='traverse');
      if(!e.dead&&e.tear)action.time=Math.min(action.getClip().duration,e.age-(e.tear.started-e.spawnTime));
      if(!e.dead&&e.stage==='traverse')action.time=e.traverseTime;
      // Movement speed comes from the gait clip's root motion; only an
      // actor without a gait (old tests) still stretches the default walk.
      if(name==='ai_zombie_walk_v1'&&!e.gait)action.setEffectiveTimeScale(e.speed/37.64);
    }
    v.mixer.update(dt);
    v.trace.tick=-1;v.traceTick=-1;
    if(action&&this.onNote)this.notes(v,name,action);
  }
  // The clip's "sndnt#<alias>" notes crossed since the last frame, including
  // across a loop; a newly started clip includes its first frame.
  notes(v,name,action){
    const clip=action.getClip(),duration=clip.duration||1,t=action.time/duration;
    if(v.noteClip!==name||v.noteStarted!==v.started){v.noteClip=name;v.noteStarted=v.started;v.noteTime=-1e-6;}
    const previous=v.noteTime;v.noteTime=t;if(t===previous)return;
    for(const n of clip.userData?.notifies||[]){
      if(!n.name.startsWith('sndnt#'))continue;
      if(t>previous?n.time>previous&&n.time<=t:n.time>previous||n.time<=t)this.onNote(v.enemy,n.name.slice(6));
    }
  }
  light(v){const color=this.map.illumination(v.enemy.position);for(const m of v.materials)if(!m.userData.fixedLight)m.color.setRGB(...color);}
  release(id){const v=this.active.get(id);if(!v)return;this.scene.remove(v.root);v.mixer.stopAllAction();this.restoreHead(v);v.ragdoll.reset();v.enemy=null;this.active.delete(id);(v.pool||this.pool).push(v);}
  reset(){for(const id of [...this.active.keys()])this.release(id);}
  warmObject(){return this.pool[0].root;}
  warmObjects(){return [this.warmObject(),...[...(this.variantPools?.values()||[])].map(pool=>pool[0].root)];}
}
