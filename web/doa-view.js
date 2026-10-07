import * as THREE from 'three';
import {model,cloneModel,originalAnimation,shadeModel,applyHideTags} from './assets.js';
import {SkeletonRagdoll} from './ragdoll.js';

// Original T5 world and actor assets under an overhead camera. Reuse actors,
// bullets and pickup objects so longer rounds do not accumulate GPU objects.
export class DeadOpsView {
  constructor(scene,map,manifest,effects){this.scene=scene;this.map=map;this.data=manifest;this.effects=effects;this.templates=new Map();this.pools=new Map();this.active=new Map();this.dropPools=new Map();this.drops=new Map();this.exits=[];this.support=new Map();}
  async prepare(){
    const m=this.data;await Promise.all([...new Set([...Object.values(m.models),...Object.values(m.actorHeads||{}),...Object.values(m.pickups),...Object.values(m.weapons).map(w=>w.worldModel)])].map(async name=>this.templates.set(name,await model(name))));
    for(const [kind,name]of Object.entries(m.models)){
      if(kind==='head')continue;const pool=[];this.pools.set(kind,pool);
      for(let i=0;i<(kind==='zombie'?64:kind==='player'?1:4);i++)pool.push(await this.actor(kind,name));
    }
    this.player=this.pools.get('player').pop();this.player.root.visible=true;
    this.weaponObjects=new Map();const hand=this.player.object.getObjectByName('tag_weapon_right')||this.player.object.getObjectByName('j_wrist_ri');
    for(const [name,d]of Object.entries(m.weapons)){const gun=cloneModel(this.templates.get(d.worldModel));applyHideTags(gun,d.hideTags);shadeModel(gun,[.7,.7,.7]);const object=new THREE.Group(),inner=gun.children[0]||gun;inner.removeFromParent();inner.rotation.set(Math.PI/2,0,0);object.add(inner);object.visible=false;hand?.add(object);this.weaponObjects.set(name,object);}
    const kinds={...m.pickups,...Object.fromEntries(Object.entries(m.weapons).map(([k,w])=>[k,w.worldModel]))};
    for(const [kind,name]of Object.entries(kinds)){
      const pool=[];for(let i=0;i<(kind==='gold'?100:8);i++){const root=new THREE.Group(),object=cloneModel(this.templates.get(name));shadeModel(object,[.75,.75,.75]);root.add(object);
        const effect=['gold','silver','ruby','diamond'].includes(kind)?'misc/fx_zombie_powerup_on_silver_zt':'misc/fx_zombie_powerup_on_zt';if(this.effects?.has(effect)){root.userData.glow=this.effects.create(effect,0);root.add(root.userData.glow);}root.visible=false;this.scene.add(root);pool.push(root);}this.dropPools.set(kind,pool);
    }
    this.bullets=new THREE.InstancedMesh(new THREE.BoxGeometry(14,2,2),new THREE.MeshBasicMaterial({color:0xffe48c}),512);this.bullets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.bullets.frustumCulled=false;this.bullets.count=0;this.scene.add(this.bullets);
    this.matrix=new THREE.Matrix4();this.q=new THREE.Quaternion();this.axis=new THREE.Vector3(0,0,1);this.v=new THREE.Vector3();this.scale=new THREE.Vector3(1,1,1);
    this.blasts=Array.from({length:8},()=>{const mesh=new THREE.Mesh(new THREE.RingGeometry(.6,1,40),new THREE.MeshBasicMaterial({color:0xffc070,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));mesh.visible=false;this.scene.add(mesh);return {mesh,until:0,started:0,radius:0};});
    for(const b of this.blasts)if(this.effects?.has('explosions/fx_grenadeexp_concrete')){b.fx=this.effects.create('explosions/fx_grenadeexp_concrete',0);b.fx.rotation.y=-Math.PI/2;b.fx.visible=false;this.scene.add(b.fx);}
    this.splats=Array.from({length:64},()=>{const mesh=new THREE.Mesh(new THREE.CircleGeometry(18,10),new THREE.MeshBasicMaterial({color:0x640b09,transparent:true,opacity:.7,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));mesh.visible=false;this.scene.add(mesh);return mesh;});this.nextSplat=0;
    // The authored exit brush doors are removed by the arcade's round logic.
    const exits=new Set(m.arenas.flatMap(a=>a.exits.map(e=>e.target)));
    for(const e of m.entities){
      if(!e.origin||!e.model||e.script_noteworthy==='clip'||exits.has(e.targetname)||!['script_model','script_brushmodel'].includes(e.classname))continue;
      let object;if(e.model.startsWith('*'))object=this.map.brushMeshes.get(Number(e.model.slice(1)))?.clone();else {try{object=cloneModel(await model(e.model));shadeModel(object,this.map.illumination(e.origin.split(/\s+/).map(Number)));}catch{continue;}}
      if(!object)continue;object.matrixAutoUpdate=true;const root=new THREE.Group();root.add(object);root.position.fromArray(e.origin.split(/\s+/).map(Number));const a=(e.angles||'0 0 0').split(/\s+/).map(v=>Number(v)*Math.PI/180);root.rotation.set(a[2],-a[0],a[1],'ZYX');this.scene.add(root);
    }
  }
  async actor(kind,name){
    const root=new THREE.Group(),object=cloneModel(this.templates.get(name));shadeModel(object,[.65,.65,.65]);root.add(object);root.visible=false;this.scene.add(root);
    const headName=kind==='zombie'?this.data.models.head:this.data.actorHeads?.[kind];if(headName){
      const head=cloneModel(this.templates.get(headName)),tag=object.getObjectByName('j_spine4');shadeModel(head,[.65,.65,.65]);if(tag)tag.add(head);
    }
    const mixer=new THREE.AnimationMixer(object),actions=new Map();let names=kind==='player'?['playerIdle','playerRun']:kind==='ape'?['apeIdle','apeRun','apeAttack']:['walk','run','death','attack'];
    for(const key of names){const sourceKey=kind==='quad'?({walk:'quadRun',run:'quadRun',attack:'quadAttack',death:'quadDeath'}[key]||key):kind==='dog'?({walk:'dogRun',run:'dogRun',death:'dogDeath'}[key]||key):key;const name=this.data.animations[sourceKey];if(name){const clip=await originalAnimation(name,object);
      // T5 player locomotion translations are offsets from the bind pose.
      if(kind==='player'){clip.tracks=clip.tracks.filter(t=>!/^j_(jaw|lip|mouth|brow|cheek|eye)/.test(t.name));for(const t of clip.tracks){const [bone,property]=t.name.split('.'),rest=object.getObjectByName(bone)?.position;if(property!=='position'||bone==='j_mainroot'||!rest)continue;for(let k=0;k<t.values.length;k+=3){t.values[k]+=rest.x;t.values[k+1]+=rest.y;t.values[k+2]+=rest.z;}}}
      actions.set(key,mixer.clipAction(clip));}}
    object.traverse(n=>{if(n.isMesh)n.frustumCulled=false;});return {root,object,mixer,actions,kind,current:null,ragdoll:new SkeletonRagdoll(root)};
  }
  play(v,key,once=false){const action=v.actions.get(key);if(!action||v.current===action)return;v.current?.fadeOut(.12);action.reset().setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;action.fadeIn(.12).play();v.current=action;}
  reset(){for(const [id,v]of this.active){v.root.visible=false;v.current=null;v.mixer.stopAllAction();v.ragdoll.reset();this.pools.get(v.kind).push(v);}this.active.clear();for(const [id,v]of this.drops){v.root.visible=false;this.dropPools.get(v.kind)?.push(v.root);}this.drops.clear();for(const b of this.blasts){b.mesh.visible=false;if(b.fx)b.fx.visible=false;}for(const b of this.splats)b.visible=false;this.bullets.count=0;}
  blast({position,radius,nuke},time){const v=this.blasts.find(v=>!v.mesh.visible&&!v.fx?.visible)||this.blasts[0];v.started=time;v.until=time+(nuke?.9:.5);v.radius=radius;v.mesh.position.set(position[0],position[1],position[2]+3);v.mesh.visible=!!nuke||!v.fx;v.mesh.material.color.setHex(nuke?0xffffff:0xffb047);if(v.fx){v.fx.position.fromArray(position);v.fx.visible=true;this.effects.restart(v.fx,time);v.fxUntil=this.effects.endTime(v.fx);}}
  kill(enemy){const b=this.splats[this.nextSplat++%this.splats.length];b.position.set(enemy.position[0],enemy.position[1],enemy.position[2]+.8);b.visible=true;}
  arena(arena){for(const e of this.exits)this.scene.remove(e.root);this.exits=[];
    for(const e of arena.exits){const root=new THREE.Group(),arrow=new THREE.Mesh(new THREE.ConeGeometry(18,45,3),new THREE.MeshBasicMaterial({color:0xffd52c,depthTest:false,transparent:true,opacity:.85}));arrow.rotation.set(Math.PI/2,0,0);root.add(arrow);const [x,y,z]=e.position;root.position.set(x,y,z+50);this.scene.add(root);root.visible=false;this.exits.push({root,arrow,side:e.side});}
  }
  update(game,dt){
    const p=this.player;p.root.position.fromArray(game.renderPosition(game.player));p.root.rotation.z=game.player.angle;p.root.visible=game.phase!=='dead'&&(game.time>=game.deathUntil);this.play(p,game.moving?'playerRun':'playerIdle');p.mixer.update(dt);
    if(this.weapon!==game.weapon){this.weapon=game.weapon;for(const [name,obj]of this.weaponObjects)obj.visible=name===game.weapon;}
    p.object.traverse(n=>{if(n.isMesh&&n.material?.color)n.material.color.setRGB(game.time<game.invulnerableUntil?.6:.7,game.time<game.invulnerableUntil?.85:.7,.7);});
    const ids=new Set();for(const enemy of game.enemies){ids.add(enemy.id);let v=this.active.get(enemy.id);if(!v){v=this.pools.get(enemy.kind)?.pop();if(!v)continue;v.root.visible=true;v.current=null;this.active.set(enemy.id,v);}v.root.position.fromArray(game.renderPosition(enemy));v.root.rotation.z=enemy.angle;
      if(enemy.dead&&v.ragdoll.ready){if(!v.ragdoll.active){v.ragdoll.start(enemy,[Math.cos(game.player.angle),Math.sin(game.player.angle),.25],70,game.collision);v.mixer.stopAllAction();}v.ragdoll.update(dt,game.collision);}
      else {if(enemy.dead){this.play(v,'death',true);if(!v.actions.has('death'))v.root.rotation.y=Math.min(Math.PI/2,(game.time-enemy.died)*3);}else this.play(v,enemy.kind==='ape'?'apeRun':enemy.speed>55?'run':'walk');v.mixer.update(dt);}
    }
    for(const [id,v]of this.active)if(!ids.has(id)){v.root.visible=false;v.root.rotation.y=0;v.mixer.stopAllAction();v.current=null;v.ragdoll.reset();this.pools.get(v.kind).push(v);this.active.delete(id);}
    this.bullets.count=Math.min(512,game.shots.length);game.shots.slice(0,512).forEach((s,i)=>{this.v.fromArray(game.renderPosition(s));this.q.setFromAxisAngle(this.axis,s.angle);this.scale.set(s.weapon==='m2_flamethrower_zt'?2:1,s.weapon==='m2_flamethrower_zt'?12:1,1);this.matrix.compose(this.v,this.q,this.scale);this.bullets.setMatrixAt(i,this.matrix);this.bullets.setColorAt(i,new THREE.Color(s.weapon==='ray_gun_zt'?0x72ff55:s.weapon==='m2_flamethrower_zt'?0xff6500:0xffe38a));});this.bullets.instanceMatrix.needsUpdate=true;if(this.bullets.instanceColor)this.bullets.instanceColor.needsUpdate=true;
    const dropIds=new Set();for(const d of game.drops){dropIds.add(d.id);let v=this.drops.get(d.id);if(!v){const root=this.dropPools.get(d.kind)?.pop();if(!root)continue;v={root,kind:d.kind};this.drops.set(d.id,v);if(root.userData.glow)this.effects.restart(root.userData.glow,game.time);}v.root.visible=true;v.root.position.set(d.position[0],d.position[1],d.position[2]+18+Math.sin(game.time*3+d.id)*4);v.root.rotation.z=game.time*1.7;if(v.root.userData.glow)this.effects.update(v.root.userData.glow,game.time);}
    for(const [id,v]of this.drops)if(!dropIds.has(id)){v.root.visible=false;this.dropPools.get(v.kind).push(v.root);this.drops.delete(id);}
    for(const b of this.blasts)if(b.mesh.visible){const f=(game.time-b.started)/(b.until-b.started);if(f>=1)b.mesh.visible=false;else{b.mesh.scale.setScalar(Math.max(1,b.radius*f));b.mesh.material.opacity=(1-f)*.9;}}
    for(const b of this.blasts)if(b.fx?.visible){if(game.time>b.fxUntil)b.fx.visible=false;else this.effects.update(b.fx,game.time);}
    for(const e of this.exits){e.root.visible=game.phase==='exit'&&game.exitOpen.some(exit=>exit.side===e.side);e.arrow.position.z=Math.sin(game.time*4)*12;}
    for(const kind of ['chicken','tank','heli','turret','monkey','barrel','tesla','teddy']){
      let obj=this.support.get(kind);if(!obj){obj=cloneModel(this.templates.get(this.data.pickups[kind]));shadeModel(obj,[.8,.8,.8]);this.scene.add(obj);this.support.set(kind,obj);}obj.visible=game.effects[kind]>game.time||kind==='chicken'&&game.fate==='friendship';if(!obj.visible)continue;
      const pos=game.effects[kind+'Position']||game.player.position;obj.position.set(pos[0]+(kind==='chicken'?55:0),pos[1],pos[2]+(kind==='heli'?140:0));obj.rotation.z=game.player.angle;if(kind==='barrel'||kind==='tesla'||kind==='teddy'){obj.position.x+=Math.cos(game.time*5)*70;obj.position.y+=Math.sin(game.time*5)*70;}
    }
  }
}
