// Swept bounding box collision against native brushes and collision triangles.
// All coordinates use original game units and Z up.
import {nativeCollisionTriangle} from './native-triangles.js';
const preparedWorlds=new WeakMap();
export class CollisionWorld {
  constructor(data, entities) {
    const prepared=preparedWorlds.get(data);
    if(prepared?.entities===entities){Object.assign(this,prepared);this.disabled=new Set();return;}
    const submodels = new Set(data.models.slice(1).flatMap(m => m.brushes));
    this.brushes = [];
    this.cells = new Map();
    for (const i of data.worldBrushes||data.brushes.map((_,i)=>i)) {
      if (!submodels.has(i)) this.add(data.brushes[i], [0,0,0], null);
    }
    for (const entity of entities) {
      if (entity.classname !== 'script_brushmodel' || !entity.model?.startsWith('*')) continue;
      const model = data.models[Number(entity.model.slice(1))];
      if (!model || entity.targetname === 'flag_blocker') continue;
      const origin = entity.origin.split(/\s+/).map(Number);
      for (const id of model.brushes) this.add(data.brushes[id], origin, entity.targetname || null);
    }
    this.staticModelCount=0;this.staticSurfaces=[];this.triangles=[];this.triangleCells=new Map();
    const meshes=new Map();
    for(const model of data.staticModels||[]){
      const a=model.inverseAxis,det=a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])-a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0])+a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
      if(Math.abs(det)<1e-8)continue;
      const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],columns=[cross(a[1],a[2]),cross(a[2],a[0]),cross(a[0],a[1])].map(v=>v.map(x=>x/det));
      const mesh=data.collisionMeshes?.[model.model];
      if(mesh&&!meshes.has(model.model))meshes.set(model.model,mesh.map(surface=>({...surface,points:surface.triangles.map(nativeCollisionTriangle)})));
      for(const surface of mesh?meshes.get(model.model):model.surfaces){
        if(!(surface.contents&(1|0x10000)))continue;
        const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity],planes=[];
        for(let corner=0;corner<8;corner++){const p=[0,1,2].map(k=>corner&(1<<k)?surface.maxs[k]:surface.mins[k]);for(let k=0;k<3;k++){const value=model.origin[k]+columns.reduce((s,c,j)=>s+c[k]*p[j],0);mins[k]=Math.min(mins[k],value);maxs[k]=Math.max(maxs[k],value);}}
        for(let k=0;k<3;k++){const n=a[k],length=Math.hypot(...n),offset=n.reduce((s,v,j)=>s+v*model.origin[j],0);planes.push([...n.map(v=>v/length),(surface.maxs[k]+offset)/length],[...n.map(v=>-v/length),(-surface.mins[k]-offset)/length]);}
        const start=this.triangles.length;
        if(mesh){for(let i=0;i<surface.points.length;i++){
          const local=surface.points[i];if(!local)continue;
          const points=local.map(p=>[0,1,2].map(k=>model.origin[k]+columns.reduce((sum,c,j)=>sum+c[k]*p[j],0)));
          const n=surface.triangles[i][0],normal=[0,1,2].map(k=>a.reduce((sum,row,j)=>sum+row[k]*n[j],0));
          this.addTriangle(points,surface.contents,model.model,normal);
        }}else this.addHull({mins,maxs,planes,contents:surface.contents,model:model.model,target:null});
        this.staticSurfaces.push({mins,maxs,contents:surface.contents,model:model.model,triangleStart:start,triangleCount:this.triangles.length-start});this.staticModelCount++;
      }
    }
    this.staticTriangleCount=this.triangles.length;
    const vertices=data.terrain?.vertices||[],indices=data.terrain?.indices||[];
    for(let at=0;at<indices.length;at+=3){
      this.addTriangle(indices.slice(at,at+3).map(i=>vertices[i]),data.terrain?.contents?.[at/3]??1);
    }
    this.disabled = new Set();
    preparedWorlds.set(data,{entities,brushes:this.brushes,cells:this.cells,staticModelCount:this.staticModelCount,staticSurfaces:this.staticSurfaces,staticTriangleCount:this.staticTriangleCount,triangles:this.triangles,triangleCells:this.triangleCells});
  }
  addTriangle(points,contents=1,model=null,nativeNormal=null){
    const edges=points.map((p,i)=>points[(i+1)%3].map((v,k)=>v-p[k])),u=edges[0],v=edges[1],normal=nativeNormal||[u[2]*v[1]-u[1]*v[2],u[0]*v[2]-u[2]*v[0],u[1]*v[0]-u[0]*v[1]],length=Math.hypot(...normal);
    if(length<1e-8)return;for(let k=0;k<3;k++)normal[k]/=length;
    const axes=[[1,0,0],[0,1,0],[0,0,1],normal];for(const e of edges)axes.push([0,e[2],-e[1]],[-e[2],0,e[0]],[e[1],-e[0],0]);
    const intervals=[];for(const a of axes){const len=Math.hypot(...a);if(len<1e-8)continue;const n=a.map(x=>x/len),p=points.map(p=>n.reduce((s,x,k)=>s+x*p[k],0));intervals.push([...n,Math.min(...p),Math.max(...p)]);}
    const mins=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),maxs=[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))),id=this.triangles.length;
    this.triangles.push({mins,maxs,normal,dist:normal.reduce((s,x,k)=>s+x*points[0][k],0),intervals,contents,model});
    for(let x=Math.floor(mins[0]/128);x<=Math.floor(maxs[0]/128);x++)for(let y=Math.floor(mins[1]/128);y<=Math.floor(maxs[1]/128);y++){const key=x+','+y;if(!this.triangleCells.has(key))this.triangleCells.set(key,[]);this.triangleCells.get(key).push(id);}
  }
  add(original, origin, target) {
    if (!(original.contents & (1 | 0x10000))) return;
    const mins = original.mins.map((v,i)=>v+origin[i]), maxs = original.maxs.map((v,i)=>v+origin[i]);
    const planes = original.planes.map(p=>[...p.slice(0,3), p[3]+p[0]*origin[0]+p[1]*origin[1]+p[2]*origin[2]]);
    for (let i=0;i<3;i++) {
      const p=[0,0,0,maxs[i]], q=[0,0,0,-mins[i]];p[i]=1;q[i]=-1;planes.push(p,q);
    }
    this.addHull({mins,maxs,planes,target,contents:original.contents});
  }
  addHull(brush){
    const {mins,maxs}=brush,id=this.brushes.length;
    this.brushes.push(brush);
    for(let x=Math.floor(mins[0]/128);x<=Math.floor(maxs[0]/128);x++) for(let y=Math.floor(mins[1]/128);y<=Math.floor(maxs[1]/128);y++) {
      const key=x+','+y;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(id);
    }
  }
  trace(start,end,half=[0,0,0],mask=1|0x10000,ignoreWalkableTerrain=false) {
    const low=start.map((v,i)=>Math.min(v,end[i])-half[i]), high=start.map((v,i)=>Math.max(v,end[i])+half[i]);
    const candidates=new Set(),triangles=new Set(),visit=(x,y)=>{const key=x+','+y;for(const id of this.cells.get(key)||[])candidates.add(id);for(const id of this.triangleCells.get(key)||[])triangles.add(id);};
    if(high[0]-low[0]<256&&high[1]-low[1]<256){for(let x=Math.floor(low[0]/128);x<=Math.floor(high[0]/128);x++)for(let y=Math.floor(low[1]/128);y<=Math.floor(high[1]/128);y++)visit(x,y);}
    else{
      // Walk the swept ray's cells, rather than scanning its entire enclosing
      // rectangle. Diagonal shots used to inspect thousands of empty cells.
      let x=Math.floor(start[0]/128),y=Math.floor(start[1]/128);const ex=Math.floor(end[0]/128),ey=Math.floor(end[1]/128),dx=end[0]-start[0],dy=end[1]-start[1],sx=Math.sign(dx),sy=Math.sign(dy),rx=Math.ceil(half[0]/128),ry=Math.ceil(half[1]/128);
      let tx=dx?((x+(sx>0?1:0))*128-start[0])/dx:Infinity,ty=dy?((y+(sy>0?1:0))*128-start[1])/dy:Infinity;
      const limit=Math.abs(ex-x)+Math.abs(ey-y)+2;
      for(let step=0;step<limit;step++){for(let a=-rx;a<=rx;a++)for(let b=-ry;b<=ry;b++)visit(x+a,y+b);if(x===ex&&y===ey)break;if(tx<=ty){x+=sx;tx+=128/Math.abs(dx);}else{y+=sy;ty+=128/Math.abs(dy);}}
    }
    let fraction=1,normal=[0,0,0],solid=false,allSolid=false;
    for(const id of candidates) {
      const b=this.brushes[id];if(!(b.contents&mask)||this.disabled.has(b.target)||b.mins.some((v,i)=>v>high[i])||b.maxs.some((v,i)=>v<low[i]))continue;
      let enter=-1,leave=1,hit=null,outside=false,endOutside=false,reject=false,closest=null,closestDistance=-Infinity;
      for(const p of b.planes) {
        const support=Math.abs(p[0])*half[0]+Math.abs(p[1])*half[1]+Math.abs(p[2])*half[2];
        const d1=p[0]*start[0]+p[1]*start[1]+p[2]*start[2]-p[3]-support;
        const d2=p[0]*end[0]+p[1]*end[1]+p[2]*end[2]-p[3]-support;
        if(d1>closestDistance){closestDistance=d1;closest=p;}
        if(d2>0)endOutside=true;
        if(d1>0)outside=true;
        if(d1>0&&d2>=d1){reject=true;break;}
        if(d1<=0&&d2<=0)continue;
        // A short step can be smaller than the .03-unit contact margin. Keep the
        // entering fraction at zero instead of discarding the floor as f < -1.
        if(d1>d2) {const f=Math.max(0,(d1-.03)/(d1-d2));if(f>enter){enter=f;hit=p;}}
        else leave=Math.min(leave,(d1+.03)/(d1-d2));
      }
      if(reject)continue;
      if(!outside){
        solid=true;
        // Starting exactly on (or slightly inside) a floor is a blocked sweep
        // when its endpoint is also inside. It must never become a clear fall.
        // A sweep that exits the brush remains free, including jumping upward.
        if(!endOutside){
          // A shallow contact is a clipping plane, not a volume that freezes
          // every direction. Permit tangential motion/escape at floor seams.
          if(closestDistance>=-.06){
            const inward=closest[0]*(end[0]-start[0])+closest[1]*(end[1]-start[1])+closest[2]*(end[2]-start[2]);
            if(inward<-1e-9){fraction=0;normal=closest.slice(0,3);}
          }else{allSolid=true;fraction=0;normal=closest.slice(0,3);}
        }
        continue;
      }
      if(enter<leave&&enter>-1&&enter<fraction&&hit){fraction=Math.max(0,enter);normal=hit.slice(0,3);}
    }
    for(const id of triangles){
      const t=this.triangles[id];if(!(t.contents&mask)||ignoreWalkableTerrain&&!t.model&&t.normal[2]>.65||t.mins.some((v,i)=>v>high[i])||t.maxs.some((v,i)=>v<low[i]))continue;
      const velocity=t.normal.reduce((s,n,k)=>s+n*(end[k]-start[k]),0),support=t.normal.reduce((s,n,k)=>s+Math.abs(n)*half[k],0),front=t.normal.reduce((s,n,k)=>s+n*start[k],0)-t.dist-support;
      // A box can overlap the next triangle at a slope seam while its center
      // remains above the surface. Keep that contact; rejecting a penetrated
      // support point lets gravity carry the whole actor through the terrain.
      if(velocity>=-1e-8||front<-support-.03||front+velocity>.03)continue;
      let enter=0,leave=fraction,hit=t.normal,reject=false;
      for(const a of t.intervals){const radius=Math.abs(a[0])*half[0]+Math.abs(a[1])*half[1]+Math.abs(a[2])*half[2],p=a[0]*start[0]+a[1]*start[1]+a[2]*start[2],d=a[0]*(end[0]-start[0])+a[1]*(end[1]-start[1])+a[2]*(end[2]-start[2]),min=a[3]-radius,max=a[4]+radius;
        if(Math.abs(d)<1e-9){if(p<min-1e-7||p>max+1e-7){reject=true;break;}continue;}
        const first=(min-p)/d,last=(max-p)/d,near=Math.min(first,last),far=Math.max(first,last);if(near>enter){enter=near;hit=a.slice(0,3).map(n=>d>0?-n:n);}leave=Math.min(leave,far);if(enter>leave+1e-7){reject=true;break;}
      }
      if(!reject&&enter<=leave&&enter<fraction){fraction=Math.max(0,enter-.03/Math.max(1e-8,-velocity));normal=hit.slice();}
    }
    return {fraction,normal,solid,allSolid,end:start.map((v,i)=>v+(end[i]-v)*fraction)};
  }
  move(feet, delta, half=[14,14,35]) {
    const start=[feet[0],feet[1],feet[2]+half[2]];
    let pos=start.slice(), velocity=delta.slice(), grounded=false;
    for(let i=0;i<4;i++) {
      const result=this.trace(pos,pos.map((v,j)=>v+velocity[j]),half);
      pos=result.end;
      if(result.fraction===1)break;
      if(result.normal[2]>.65)grounded=true;
      if(result.allSolid)break;
      const dot=velocity.reduce((sum,v,j)=>sum+v*result.normal[j],0);
      velocity=velocity.map((v,j)=>(v-result.normal[j]*Math.min(0,dot))*(1-result.fraction));
    }
    return {position:[pos[0],pos[1],pos[2]-half[2]],grounded};
  }
  step(feet,delta,half=[14,14,35]) {
    const direct=this.move(feet,delta,half);
    if(Math.hypot(delta[0],delta[1])<.001)return direct;
    if(Math.hypot(direct.position[0]-feet[0],direct.position[1]-feet[1])>=Math.hypot(delta[0],delta[1])-.1)return direct;
    const center=[feet[0],feet[1],feet[2]+half[2]],up=this.trace(center,[center[0],center[1],center[2]+18],half);
    if(up.allSolid)return direct;
    const over=this.move([up.end[0],up.end[1],up.end[2]-half[2]],[delta[0],delta[1],Math.max(0,delta[2])],half);
    const top=[over.position[0],over.position[1],over.position[2]+half[2]],landing=this.trace(top,[top[0],top[1],top[2]-18+Math.min(0,delta[2])],half);
    if(landing.allSolid||landing.fraction<1&&landing.normal[2]<.65)return direct;
    // Step probes remain vertical; sliding an 18-unit downward probe along a
    // tilted prop face used to kick the player sideways into nearby barriers.
    const down={position:[landing.end[0],landing.end[1],landing.end[2]-half[2]],grounded:landing.fraction<1&&landing.normal[2]>.65};
    if(Math.hypot(down.position[0]-feet[0],down.position[1]-feet[1])>Math.hypot(direct.position[0]-feet[0],direct.position[1]-feet[1])+.1)return down;
    return direct;
  }
}
