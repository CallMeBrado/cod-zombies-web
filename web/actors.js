import * as THREE from 'three';
import {model,cloneModel,originalAnimation,shadeModel} from './assets.js';
import {PosedTrace} from './posed-trace.js';

// Retarget shared clips before gameplay. Spawning only acquires a prepared rig.
export class ZombieActors {
  constructor(scene,map,presentation){this.scene=scene;this.map=map;this.presentation=presentation;this.pool=[];this.active=new Map();}
  async prepare(){
    const [bodyTemplate,headTemplate]=await Promise.all([model('char_ger_honorgd_body1_1'),model('char_ger_honorgd_zombiehead1_1')]);
    const body=cloneModel(bodyTemplate),head=cloneModel(headTemplate);
    head.traverse(n=>{if(n.isMesh)n.userData.zombieHead=true;});body.getObjectByName('j_spine4')?.add(head);shadeModel(body,[1,1,1]);
    const clips=new Map(await Promise.all(Object.keys(this.presentation.animations).map(async name=>[name,await originalAnimation(name,body,true)])));
    for(let i=0;i<32;i++){
      const object=cloneModel(body),root=new THREE.Group();root.add(object);
      const materials=[];object.traverse(n=>{if(!n.isMesh)return;n.frustumCulled=false;
        const clone=m=>{const copy=m.clone();copy.onBeforeCompile=m.onBeforeCompile;materials.push(copy);return copy;};
        n.material=Array.isArray(n.material)?n.material.map(clone):clone(n.material);
      });
      const mixer=new THREE.AnimationMixer(object),actions=new Map([...clips].map(([name,clip])=>[name,mixer.clipAction(clip)]));
      for(const [name,action]of actions){const once=name.includes('death')||name.includes('tear')||name.includes('traverse');action.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;}
      this.pool.push({root,object,mixer,actions,materials,current:null,enemy:null,started:null,trace:new PosedTrace(root)});
    }
  }
  acquire(enemy){
    if(!this.pool.length){const corpse=[...this.active.values()].find(v=>v.enemy.dead);if(corpse)this.release(corpse.enemy.id);}
    const v=this.pool.pop();if(!v)throw new Error('Prepared zombie actor pool exhausted.');
    v.enemy=enemy;v.current=null;v.started=null;v.traceTick=-1;v.trace.tick=-1;v.root.name='Zombie '+enemy.id;v.root.position.fromArray(enemy.position);v.root.rotation.z=enemy.angle;
    v.mixer.stopAllAction();this.active.set(enemy.id,v);this.updateOne(v,0,enemy.position);this.light(v);this.scene.add(v.root);return v;
  }
  play(v,name,started=null){
    if(v.current===name&&v.started===started)return;
    const action=v.actions.get(name);if(!action)return;
    v.actions.get(v.current)?.fadeOut(.12);action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);if(v.current)action.fadeIn(.12);action.play();
    v.current=name;v.started=started;
  }
  updateOne(v,dt,position){
    const e=v.enemy;v.root.position.fromArray(position);v.root.rotation.z=e.angle;
    let name=v.actions.has(e.gait)?e.gait:'ai_zombie_walk_v1',started=null;
    if(e.dead)name='ai_zombie_death_v1';
    else if(e.stage==='traverse')name=e.traverseAnim;
    else if(e.stage==='barrier'){name=e.tear?.name||'ai_zombie_idle_v1';started=e.tear?.started??null;}
    else if(e.attacking)name='ai_zombie_attack_v1';
    this.play(v,name,started);
    const action=v.actions.get(name);
    if(action){
      action.paused=!!e.tear||e.stage==='traverse';
      if(e.tear)action.time=Math.min(action.getClip().duration,e.age-(e.tear.started-e.spawnTime));
      if(e.stage==='traverse')action.time=e.traverseTime;
      // Movement speed comes from the gait clip's root motion; only an
      // actor without a gait (old tests) still stretches the default walk.
      if(name==='ai_zombie_walk_v1'&&!e.gait)action.setEffectiveTimeScale(e.speed/37.64);
    }
    v.mixer.update(dt);
  }
  light(v){const color=this.map.illumination(v.enemy.position);for(const m of v.materials)if(!m.userData.fixedLight)m.color.setRGB(...color);}
  release(id){const v=this.active.get(id);if(!v)return;this.scene.remove(v.root);v.mixer.stopAllAction();v.enemy=null;this.active.delete(id);this.pool.push(v);}
  reset(){for(const id of [...this.active.keys()])this.release(id);}
  warmObject(){return this.pool[0].root;}
}
