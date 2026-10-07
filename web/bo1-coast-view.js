import * as THREE from 'three';
import {model,cloneModel,shadeModel} from './assets.js';
const vec=s=>String(s||'0 0 0').split(/\s+/).map(Number),rad=THREE.MathUtils.degToRad;

// Original moving machine, box locations, frost overlay and projectile art.
export class CoastView {
  constructor(scene,map,dynamic){this.scene=scene;this.map=map;this.dynamic=dynamic;this.projectiles=new Map();this.templates=new Map();}
  async prepare(manifest,presentation){
    this.manifest=manifest;const entities=manifest.entities,find=name=>entities.find(e=>e.targetname===name);
    const trigger=find('zombie_vending_upgrade'),machine=find(trigger.target),targets=new Set([trigger.target,machine.target]);
    this.pap=[...targets].flatMap(t=>this.dynamic.get(t)||[]);
    this.chests=entities.filter(e=>e.targetname==='treasure_chest_use').map(t=>{
      const lid=find(t.target),origin=find(lid.target),base=find(origin.target);
      return {target:t.target,items:[...(this.dynamic.get(t.target)||[]),...(this.dynamic.get(base.targetname)||[])],rubble:this.dynamic.get('#'+t.script_noteworthy+'_rubble')||[],at:vec(origin.origin),yaw:vec(origin.angles)[1]};
    });
    for(const item of [...this.pap,...this.chests.flatMap(c=>c.items)]){item.restPosition=item.object.position.clone();item.restRotation=item.object.rotation.clone();}
    this.teddy=cloneModel(await model(presentation.box.teddyModel));this.teddy.visible=false;shadeModel(this.teddy,[.5,.5,.5]);this.scene.add(this.teddy);
    for(const d of Object.values(manifest.weapons))if(d.weaponType==='projectile'&&!this.templates.has(d.projectileModel)){
      const object=cloneModel(await model(d.projectileModel));shadeModel(object,[.8,.8,.8]);this.templates.set(d.projectileModel,object);
    }
    this.frost=document.createElement('img');
    this.frost.src='/data/gameplay/bo1-coast/hud/frost_test.png';this.frost.alt='';this.frost.setAttribute('aria-hidden','true');
    Object.assign(this.frost.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',objectFit:'fill',opacity:'0',zIndex:'2',mixBlendMode:'screen'});document.getElementById('viewport').after(this.frost);
    this.scene.fog=new THREE.FogExp2(0x9daeb6,.00013);
  }
  projectile(p){const d=this.manifest.weapons[p.weapon],root=cloneModel(this.templates.get(d.projectileModel));
    if(d.projectileModel==='tag_flash'){const light=new THREE.Mesh(new THREE.SphereGeometry(1.6,6,4),new THREE.MeshBasicMaterial({color:p.weapon.startsWith('humangun')?0xecc3a3:0x8cc780}));root.add(light);}
    root.position.fromArray(p.position);this.scene.add(root);this.projectiles.set(p.id,{root,p});
  }
  removeProjectile(id){const v=this.projectiles.get(id);if(v){v.root.removeFromParent();v.root.traverse(n=>{if(n.isMesh&&n.material.isMeshBasicMaterial){n.geometry.dispose();n.material.dispose();}});}this.projectiles.delete(id);}
  reset(){for(const id of [...this.projectiles.keys()])this.removeProjectile(id);this.teddy.visible=false;this.frost.style.opacity='0';}
  update(game,cellObjects){
    const r=game.mapRules,t=game.time;
    if(!this.unculled){this.unculled=true;for(const item of [...this.pap,...this.chests.flatMap(c=>[...c.items,...c.rubble])]){const holder=item.object.parent,i=cellObjects.findIndex(c=>c.holder===holder);if(i>=0){cellObjects.splice(i,1);holder.visible=true;}}}
    for(const item of this.pap){item.object.visible=['rising','active','lowering'].includes(r.papStage)||!!r.pap;item.object.position.fromArray(vec(item.entity.origin));const a=vec(item.entity.angles);item.object.rotation.set(rad(a[2]),-rad(a[0]),rad(a[1]),'ZYX');}
    let bear=null;
    for(const c of this.chests){const b=game.boxes.get(c.target),phase=b.phase,shown=game.activeBox===c.target||['cycling','offered','teddy','closing'].includes(phase)||(phase==='leaving'&&t-b.started<5),lift=phase==='leaving'?50*Math.min(1,(t-b.started)/5):0;
      for(const item of c.items){item.object.visible=shown;item.object.position.copy(item.restPosition);item.object.position.z+=lift;}
      for(const item of c.rubble)item.object.visible=!shown;
      if(phase==='teddy'){const age=Math.max(0,t-b.offeredAt-2.5);bear={c,lift:Math.min(500,age*age*30)};}
    }
    this.teddy.visible=!!bear;if(bear){this.teddy.position.set(bear.c.at[0],bear.c.at[1],bear.c.at[2]+40+bear.lift);this.teddy.rotation.z=rad(bear.c.yaw+90);}
    this.frost.style.opacity=game.phase==='ready'||game.phase==='dead'?'0':String(Math.min(.8,r.cold/30*.8));
    for(const {root,p}of this.projectiles.values()){const f=Math.min(1,game.accumulator*120),old=p.previousPosition||p.position;root.position.fromArray(p.position.map((v,k)=>old[k]+(v-old[k])*f));root.rotation.set(0,-Math.atan2(p.velocity[2],Math.hypot(p.velocity[0],p.velocity[1])),Math.atan2(p.velocity[1],p.velocity[0]),'ZYX');}
  }
}
