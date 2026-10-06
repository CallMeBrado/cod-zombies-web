import * as THREE from 'three';
const topologies=new WeakMap();
function topology(geometry){
  if(topologies.has(geometry))return topologies.get(geometry);
  const position=geometry.attributes.position,index=geometry.index,count=index?.count||position.count;
  const vertex=at=>index?index.getX(at):at,triangles=[];
  for(let at=geometry.drawRange.start;at<Math.min(count,geometry.drawRange.start+geometry.drawRange.count);at+=3){
    const ids=[vertex(at),vertex(at+1),vertex(at+2)];
    triangles.push({ids,center:[0,1,2].map(k=>ids.reduce((s,i)=>s+position.getComponent(i,k),0)/3),material:geometry.groups.find(g=>at>=g.start&&at<g.start+g.count)?.materialIndex||0});
  }
  const nodes=[];
  function split(list){
    const id=nodes.length,node={};nodes.push(node);
    if(list.length<=24){node.triangles=list;return id;}
    const span=[0,1,2].map(k=>Math.max(...list.map(t=>t.center[k]))-Math.min(...list.map(t=>t.center[k]))),axis=span.indexOf(Math.max(...span));
    list.sort((a,b)=>a.center[axis]-b.center[axis]);const half=Math.floor(list.length/2);node.left=split(list.slice(0,half));node.right=split(list.slice(half));return id;
  }
  split(triangles);topologies.set(geometry,nodes);return nodes;
}
function prepareBoneBounds(mesh,nodes){
  if(nodes[0].boneBoundsReady)return;
  const p=new THREE.Vector3(),local=new THREE.Vector3(),position=mesh.geometry.attributes.position,indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
  for(const node of nodes){if(!node.triangles)continue;const boxes=new Map();
    for(const id of new Set(node.triangles.flatMap(t=>t.ids))){p.fromBufferAttribute(position,id);
      for(let influence=0;influence<(mesh.isSkinnedMesh?4:1);influence++){
        if(mesh.isSkinnedMesh&&weights.getComponent(id,influence)<=0)continue;
        const bone=mesh.isSkinnedMesh?indices.getComponent(id,influence):-1;
        if(!boxes.has(bone))boxes.set(bone,new THREE.Box3());local.copy(p);
        if(bone>=0)local.applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[bone]);
        boxes.get(bone).expandByPoint(local);
      }
    }node.boneBoxes=[...boxes];
  }nodes[0].boneBoundsReady=true;
}
// Each posed vertex is a weighted combination of its bone transforms, so the
// union of transformed influence bounds conservatively encloses every triangle.
// Refit those cheap bounds; skin vertices only in leaves intersected by a shot.
// Final hit tests still intersect the exact animated model triangles.
export class PosedTrace {
  constructor(root){
    this.meshes=[];root.traverse(mesh=>{if(!mesh.isMesh||mesh.userData.goreOnly)return;const nodes=topology(mesh.geometry);prepareBoneBounds(mesh,nodes);this.meshes.push({mesh,nodes,vertices:new Float32Array(mesh.geometry.attributes.position.count*3),stamps:new Uint32Array(mesh.geometry.attributes.position.count),bounds:new Float64Array(nodes.length*6)});});
    this.tick=-1;this.generation=0;this.inverse=new THREE.Matrix4();this.boneMatrix=new THREE.Matrix4();this.box=new THREE.Box3();this.ray=new THREE.Ray();this.v=new THREE.Vector3();this.a=new THREE.Vector3();this.b=new THREE.Vector3();this.c=new THREE.Vector3();this.point=new THREE.Vector3();this.stack=[];
  }
  refit(tick){
    if(this.tick===tick)return;this.tick=tick;this.generation++;
    for(const {mesh,nodes,bounds}of this.meshes){
      for(let i=nodes.length-1;i>=0;i--){const node=nodes[i],at=i*6;
        if(node.triangles){bounds[at]=bounds[at+1]=bounds[at+2]=Infinity;bounds[at+3]=bounds[at+4]=bounds[at+5]=-Infinity;
          for(const [bone,box]of node.boneBoxes){this.box.copy(box);if(bone>=0)this.box.applyMatrix4(this.boneMatrix.copy(mesh.bindMatrixInverse).multiply(mesh.skeleton.bones[bone].matrixWorld));
            for(let k=0;k<3;k++){bounds[at+k]=Math.min(bounds[at+k],this.box.min.getComponent(k)-1e-5);bounds[at+3+k]=Math.max(bounds[at+3+k],this.box.max.getComponent(k)+1e-5);}
          }
        }else for(let k=0;k<3;k++){bounds[at+k]=Math.min(bounds[node.left*6+k],bounds[node.right*6+k]);bounds[at+3+k]=Math.max(bounds[node.left*6+3+k],bounds[node.right*6+3+k]);}
      }
    }
  }
  intersects(bounds,at){
    let near=0,far=Infinity;
    for(let k=0;k<3;k++){const origin=this.ray.origin.getComponent(k),direction=this.ray.direction.getComponent(k);
      if(Math.abs(direction)<1e-10){if(origin<bounds[at+k]||origin>bounds[at+3+k])return false;continue;}
      const a=(bounds[at+k]-origin)/direction,b=(bounds[at+3+k]-origin)/direction;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far)return false;
    }return true;
  }
  trace(worldRay,max,tick){
    this.refit(tick);let best=null;
    for(const entry of this.meshes){const {mesh,nodes,vertices,bounds,stamps}=entry;
      this.ray.copy(worldRay).applyMatrix4(this.inverse.copy(mesh.matrixWorld).invert());this.stack.length=0;this.stack.push(0);
      while(this.stack.length){const id=this.stack.pop(),node=nodes[id];if(!this.intersects(bounds,id*6))continue;
        if(!node.triangles){this.stack.push(node.left,node.right);continue;}
        for(const t of node.triangles){for(const id of t.ids)if(stamps[id]!==this.generation){mesh.getVertexPosition(id,this.v);this.v.toArray(vertices,id*3);stamps[id]=this.generation;}
          this.a.fromArray(vertices,t.ids[0]*3);this.b.fromArray(vertices,t.ids[1]*3);this.c.fromArray(vertices,t.ids[2]*3);
          const material=Array.isArray(mesh.material)?mesh.material[t.material]:mesh.material;
          const hit=material.side===THREE.BackSide?this.ray.intersectTriangle(this.c,this.b,this.a,true,this.point):this.ray.intersectTriangle(this.a,this.b,this.c,material.side!==THREE.DoubleSide,this.point);
          if(!hit)continue;this.point.applyMatrix4(mesh.matrixWorld);const distance=this.point.distanceTo(worldRay.origin);if(distance<max){max=distance;best={distance,object:mesh};}
        }
      }
    }return best;
  }
}
