import * as THREE from 'three';
import {PlayerBody} from './player-body.js';
import {PLAYER_COLORS} from './coop.js';

// Draws the other co-op players from their network states, 100 ms behind
// their newest sample: their character body (Black Ops), stance, prone/down
// and dive pose, their weapon, and their gunfire sound at their position.
export class RemotePlayers {
  constructor(scene,{definitions=null,illumination,weapons,audio}){Object.assign(this,{scene,definitions,illumination,weapons,audio});this.players=new Map();}
  async body(id,character,slot){
    if(this.definitions?.length){
      const body=new PlayerBody(this.scene,this.illumination,this.definitions,character??slot%this.definitions.length);await body.prepare();body.setThirdPerson(true);return body;
    }
    return new StandIn(this.scene,PLAYER_COLORS[slot%4]);
  }
  update(coop,session,dt,time){
    for(const [id,r]of coop.remotes){
      let v=this.players.get(id);
      if(!r.present){if(v){v.body?.dispose();this.players.delete(id);}continue;}
      if(!v){v={id,body:null,loading:this.body(id,r.character,r.slot??0).then(body=>{v.body=body;}).catch(console.error),weapon:null,shots:null};this.players.set(id,v);}
      const s=session.sample(id,100);v.state=s;if(!v.body||!s)continue;
      if(s.weapon!==v.weapon&&this.weapons[s.weapon]){v.weapon=s.weapon;v.body.weapon?.({definition:this.weapons[s.weapon]});}
      v.body.poseRemote(s,dt,time);
      // Their gunfire, at their position.
      if(v.shots!==null&&s.shots>v.shots&&this.audio){const d=this.weapons[s.weapon];const alias=d?.fireSound||d?.fireSoundPlayer;if(alias)this.audio.play(alias,1,{position:[s.p[0],s.p[1],s.p[2]+50],near:100,far:3000});}
      v.shots=s.shots;
    }
    for(const [id,v]of this.players)if(!coop.remotes.has(id)){v.body?.dispose();this.players.delete(id);}
  }
  // Screen markers: names over teammates, a revive marker over downed ones.
  markers(camera,width,height){
    const out=[],at=new THREE.Vector3();
    for(const v of this.players.values()){
      const s=v.state;if(!s||s.dead)continue;at.set(s.p[0],s.p[1],s.p[2]+(s.down||s.stance==='prone'?30:s.stance==='crouch'?60:80));
      const distance=at.distanceTo(camera.position);at.project(camera);if(at.z>1||Math.abs(at.x)>1.1||Math.abs(at.y)>1.1)continue;
      out.push({id:v.id,x:(at.x+1)/2*width,y:(1-at.y)/2*height,distance,down:s.down,bleed:s.bleed});
    }return out;
  }
  dispose(){for(const v of this.players.values())v.body?.dispose();this.players.clear();}
}
// World at War's player models are not exported yet: a simple figure in the
// player's colour stands in until they are.
class StandIn {
  constructor(scene,color){
    const material=new THREE.MeshLambertMaterial({color}),root=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CylinderGeometry(11,13,52,12),material);body.rotation.x=Math.PI/2;body.position.z=34;
    const head=new THREE.Mesh(new THREE.SphereGeometry(8,12,10),material);head.position.z=68;root.add(body,head);this.root=root;this.parts={body,head};scene.add(root);
  }
  poseRemote(s){
    this.root.visible=!!s&&!s.dead;if(!this.root.visible)return;this.root.position.fromArray(s.p);this.root.rotation.set(0,0,s.dive?.yaw??s.yaw);
    const flat=s.down||s.stance==='prone'||!!s.dive,low=s.stance==='crouch'&&!flat;
    this.root.rotation.y=flat?Math.PI/2:0;this.root.position.z+=flat?10:0;this.root.scale.set(1,1,low?.7:1);
  }
  dispose(){this.root.removeFromParent();}
}
