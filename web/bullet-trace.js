import * as THREE from 'three';

const trees=new WeakMap();
function treeFor(geometry){
  if(trees.has(geometry))return trees.get(geometry);
  const position=geometry.attributes.position,index=geometry.index,start=geometry.drawRange.start;
  const count=Math.floor((Math.min(index?.count??position.count,start+geometry.drawRange.count)-start)/3);
  const vertex=at=>index?index.getX(at):at,ids=[],centers=new Float32Array(count*3),bounds=new Float32Array(count*6),materials=new Uint16Array(count);
  for(let t=0;t<count;t++){
    const at=start+t*3,vertices=[vertex(at),vertex(at+1),vertex(at+2)];ids.push(t);
    materials[t]=geometry.groups.find(g=>at>=g.start&&at<g.start+g.count)?.materialIndex||0;
    for(let k=0;k<3;k++){
      const values=vertices.map(id=>position.getComponent(id,k));
      bounds[t*6+k]=Math.min(...values);bounds[t*6+3+k]=Math.max(...values);centers[t*3+k]=(values[0]+values[1]+values[2])/3;
    }
  }
  const nodes=[];
  function split(list){
    const box=new THREE.Box3(),cmin=[Infinity,Infinity,Infinity],cmax=[-Infinity,-Infinity,-Infinity];
    for(const t of list)for(let k=0;k<3;k++){
      box.min.setComponent(k,Math.min(box.min.getComponent(k),bounds[t*6+k]));box.max.setComponent(k,Math.max(box.max.getComponent(k),bounds[t*6+3+k]));
      cmin[k]=Math.min(cmin[k],centers[t*3+k]);cmax[k]=Math.max(cmax[k],centers[t*3+k]);
    }
    const id=nodes.length,node={box};nodes.push(node);
    if(list.length<=16)node.triangles=list;
    else{
      const spans=cmax.map((v,k)=>v-cmin[k]),axis=spans.indexOf(Math.max(...spans));
      list.sort((a,b)=>centers[a*3+axis]-centers[b*3+axis]);const half=Math.floor(list.length/2);
      node.left=split(list.slice(0,half));node.right=split(list.slice(half));
    }
    return id;
  }
  if(ids.length)split(ids);
  const tree={nodes,position,index,start,materials};trees.set(geometry,tree);return tree;
}

// Read alpha at the hit UV, including the native compressed DDS textures.
// Transparent pixels in a grate/fence texture must not close its openings.
export function textureAlpha(texture,uv){
  if(!texture)return 1;
  texture.updateMatrix();texture.transformUv(uv);
  const image=texture.image,mip=texture.mipmaps?.[0],width=mip?.width??image?.width,height=mip?.height??image?.height;
  if(!width||!height)return 1;
  const x=Math.min(width-1,Math.max(0,Math.floor(uv.x*width))),y=Math.min(height-1,Math.max(0,Math.floor(uv.y*height)));
  const data=mip?.data??image?.data;if(!data)return 1;
  if(!texture.isCompressedTexture){
    if(data.length!==width*height*4)return 1;
    const a=data[(y*width+x)*4+3];return data instanceof Float32Array?a:a/255;
  }
  const pixel=(y%4)*4+x%4,block=Math.floor(y/4)*Math.ceil(width/4)+Math.floor(x/4),f=texture.format;
  if(f===THREE.RGBA_S3TC_DXT1_Format){
    const at=block*8,c0=data[at]|data[at+1]<<8,c1=data[at+2]|data[at+3]<<8;
    return c0<=c1&&((data[at+4+(pixel>>2)]>>(pixel%4*2))&3)===3?0:1;
  }
  if(f===THREE.RGBA_S3TC_DXT3_Format){const at=block*16+(pixel>>1);return ((data[at]>>(pixel%2*4))&15)/15;}
  if(f===THREE.RGBA_S3TC_DXT5_Format){
    const at=block*16,bit=pixel*3,byte=at+2+(bit>>3),code=((data[byte]|(data[byte+1]||0)<<8)>>(bit%8))&7,a=data[at],b=data[at+1];
    if(code===0)return a/255;if(code===1)return b/255;
    if(a>b)return ((8-code)*a+(code-1)*b)/(7*255);
    if(code===6)return 0;if(code===7)return 1;
    return ((6-code)*a+(code-1)*b)/(5*255);
  }
  return 1;
}

// Bullet-only collision uses the actual map/model triangles. Shared BVHs and
// stable instance transforms keep shots independent of renderer batching and
// camera culling, without scanning every triangle on each shot.
export class BulletTrace {
  constructor(){
    this.entries=[];this.worldRay=new THREE.Ray();this.ray=new THREE.Ray();this.inverse=new THREE.Matrix4();this.normalMatrix=new THREE.Matrix3();
    this.direction=new THREE.Vector3();this.a=new THREE.Vector3();this.b=new THREE.Vector3();this.c=new THREE.Vector3();this.point=new THREE.Vector3();this.worldPoint=new THREE.Vector3();this.normal=new THREE.Vector3();
    this.uv=new THREE.Vector2();this.bary=new THREE.Vector3();this.stack=[];
  }
  addGeometry(geometry,material,matrix,options={}){
    const tree=treeFor(geometry);if(!tree.nodes.length)return;
    this.entries.push({tree,geometry,material,matrix:matrix.clone(),box:tree.nodes[0].box.clone().applyMatrix4(matrix),...options});
  }
  addMesh(mesh,options={}){mesh.updateWorldMatrix(true,false);this.addGeometry(mesh.geometry,mesh.material,mesh.matrixWorld,options);}
  addInstances(geometry,material,instances){for(const {matrix}of instances)this.addGeometry(geometry,material,matrix);}
  addRoot(root,{penetrable=false}={}){
    if(penetrable)return; // Rebuildable window boards admit gunfire.
    root.updateWorldMatrix(true,true);
    root.traverse(mesh=>{
      if(!mesh.isMesh)return;let geometry=mesh.geometry;
      if(mesh.isSkinnedMesh){
        geometry=geometry.clone();mesh.skeleton.update();const p=geometry.attributes.position;
        for(let i=0;i<p.count;i++){mesh.getVertexPosition(i,this.point);p.setXYZ(i,this.point.x,this.point.y,this.point.z);}
      }
      this.addGeometry(geometry,mesh.material,mesh.matrixWorld,{owner:mesh});
    });
  }
  visible(owner){for(let node=owner;node;node=node.parent)if(!node.visible)return false;return true;}
  inside(box,ray,max){
    let near=0,far=max;
    for(let k=0;k<3;k++){
      const p=ray.origin.getComponent(k),d=ray.direction.getComponent(k),min=box.min.getComponent(k),hi=box.max.getComponent(k);
      if(Math.abs(d)<1e-10){if(p<min||p>hi)return false;continue;}
      const a=(min-p)/d,b=(hi-p)/d;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far)return false;
    }
    return true;
  }
  trace(origin,direction,max=16000){
    this.worldRay.origin.fromArray(origin);this.worldRay.direction.fromArray(direction).normalize();let best=null;
    for(const e of this.entries){
      if(e.owner){
        if(!this.visible(e.owner))continue;
        e.owner.updateWorldMatrix(true,false);
        if(!e.matrix.equals(e.owner.matrixWorld)){e.matrix.copy(e.owner.matrixWorld);e.box.copy(e.tree.nodes[0].box).applyMatrix4(e.matrix);}
      }
      if(!this.inside(e.box,this.worldRay,max))continue;
      this.inverse.copy(e.matrix).invert();this.ray.copy(this.worldRay).applyMatrix4(this.inverse);
      const scale=this.direction.copy(this.worldRay.direction).applyMatrix3(this.normalMatrix.setFromMatrix4(this.inverse)).length();
      const {nodes,position,index,start,materials}=e.tree,vertex=at=>index?index.getX(at):at;
      this.stack.length=0;this.stack.push(0);
      while(this.stack.length){
        const node=nodes[this.stack.pop()];if(!this.inside(node.box,this.ray,max*scale))continue;
        if(!node.triangles){this.stack.push(node.left,node.right);continue;}
        for(const t of node.triangles){
          const at=start+t*3,ids=[vertex(at),vertex(at+1),vertex(at+2)],material=Array.isArray(e.material)?e.material[materials[t]]:e.material;
          if(!material||material.visible===false)continue;
          this.a.fromBufferAttribute(position,ids[0]);this.b.fromBufferAttribute(position,ids[1]);this.c.fromBufferAttribute(position,ids[2]);
          if(!this.ray.intersectTriangle(this.a,this.b,this.c,false,this.point))continue;
          this.worldPoint.copy(this.point).applyMatrix4(e.matrix);const distance=this.worldPoint.distanceTo(this.worldRay.origin);
          if(distance>=max)continue;
          const uv=e.geometry.attributes.uv;
          if(uv&&(material.alphaTest>0||material.transparent)){
            THREE.Triangle.getBarycoord(this.point,this.a,this.b,this.c,this.bary);
            this.uv.set(ids.reduce((sum,id,k)=>sum+uv.getX(id)*this.bary.getComponent(k),0),ids.reduce((sum,id,k)=>sum+uv.getY(id)*this.bary.getComponent(k),0));
            const layer=e.geometry.attributes.wawLayer?.getX(ids[0]),texture=e.layers?.[layer]||material.map;
            if(textureAlpha(texture,this.uv)*(material.opacity??1)<Math.max(.01,material.alphaTest))continue;
          }
          THREE.Triangle.getNormal(this.a,this.b,this.c,this.normal);this.normal.applyNormalMatrix(this.normalMatrix.getNormalMatrix(e.matrix));
          if(this.normal.dot(this.worldRay.direction)>0)this.normal.negate();
          max=distance;best={distance,normal:this.normal.toArray()};
        }
      }
    }
    return best;
  }
  shot(origin,dir,range,traceEnemy){
    const surface=this.trace(origin,dir,range),found=traceEnemy(origin,dir,surface?.distance??range,true);
    const hits=(Array.isArray(found)?found:found?[found]:[]).sort((a,b)=>a.distance-b.distance),hit=hits[0]||null;
    const nearest=hit?.distance??surface?.distance??range;
    return {hit,hits,origin,dir,end:origin.map((v,i)=>v+dir[i]*nearest),wall:!hit&&!!surface,normal:surface?.normal||[0,0,0]};
  }
}
