// Swept bounding box collision against native brushes and collision triangles.
// All coordinates use original game units and Z up.
import {nativeCollisionTriangle} from './native-triangles.js';
const preparedWorlds=new WeakMap();
// 128-unit grid cells keyed by number (no per-lookup string building).
const cellKey=(x,y)=>(x+32768)*65536+(y+32768);
export const TINY_PROP={height:18,size:64};
// CONTENTS_SOLID with CONTENTS_PLAYERCLIP (0x10000) or CONTENTS_MONSTERCLIP (0x20000).
export const PLAYER_CONTENTS=1|0x10000,ACTOR_CONTENTS=1|0x20000;
const ALL_CONTENTS=PLAYER_CONTENTS|ACTOR_CONTENTS;
export class CollisionWorld {
  constructor(data, entities) {
    this.mask=PLAYER_CONTENTS;
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
      // The exported inverseAxis is axis^T/scale, where the renderer's axis rows
      // are the model's local axes in world space. World->local is therefore its
      // transpose; using it directly mirrored every non-0/180 degree rotation
      // (e.g. the upstairs Der Riese teleporter's wall sat across its entrance).
      const m=model.inverseAxis,a=[0,1,2].map(i=>[0,1,2].map(j=>m[j][i])),det=a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])-a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0])+a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
      if(Math.abs(det)<1e-8)continue;
      const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],columns=[cross(a[1],a[2]),cross(a[2],a[0]),cross(a[0],a[1])].map(v=>v.map(x=>x/det));
      const mesh=data.collisionMeshes?.[model.model];
      if(mesh&&!meshes.has(model.model))meshes.set(model.model,mesh.map(surface=>({...surface,points:surface.triangles.map(nativeCollisionTriangle)})));
      for(const surface of mesh?meshes.get(model.model):model.surfaces){
        if(!(surface.contents&ALL_CONTENTS))continue;
        const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity],planes=[];
        for(let corner=0;corner<8;corner++){const p=[0,1,2].map(k=>corner&(1<<k)?surface.maxs[k]:surface.mins[k]);for(let k=0;k<3;k++){const value=model.origin[k]+columns.reduce((s,c,j)=>s+c[k]*p[j],0);mins[k]=Math.min(mins[k],value);maxs[k]=Math.max(maxs[k],value);}}
        for(let k=0;k<3;k++){const n=a[k],length=Math.hypot(...n),offset=n.reduce((s,v,j)=>s+v*model.origin[j],0);planes.push([...n.map(v=>v/length),(surface.maxs[k]+offset)/length],[...n.map(v=>-v/length),(-surface.mins[k]-offset)/length]);}
        const start=this.triangles.length,brushStart=this.brushes.length;
        if(mesh){for(let i=0;i<surface.points.length;i++){
          const local=surface.points[i];if(!local)continue;
          const points=local.map(p=>[0,1,2].map(k=>model.origin[k]+columns.reduce((sum,c,j)=>sum+c[k]*p[j],0)));
          const n=surface.triangles[i][0],normal=[0,1,2].map(k=>a.reduce((sum,row,j)=>sum+row[k]*n[j],0));
          this.addTriangle(points,surface.contents,model.model,normal);
        }}else this.addHull({mins,maxs,planes,contents:surface.contents,model:model.model,target:null});
        this.staticSurfaces.push({mins,maxs,contents:surface.contents,model:model.model,triangleStart:start,triangleCount:this.triangles.length-start,brushStart,brushCount:this.brushes.length-brushStart});this.staticModelCount++;
      }
    }
    this.markTinyProps();
    this.staticTriangleCount=this.triangles.length;
    const vertices=data.terrain?.vertices||[],indices=data.terrain?.indices||[];
    for(let at=0;at<indices.length;at+=3){
      this.addTriangle(indices.slice(at,at+3).map(i=>vertices[i]),data.terrain?.contents?.[at/3]??1);
    }
    this.disabled = new Set();
    preparedWorlds.set(data,{entities,brushes:this.brushes,cells:this.cells,staticModelCount:this.staticModelCount,staticSurfaces:this.staticSurfaces,staticTriangleCount:this.staticTriangleCount,triangles:this.triangles,triangleCells:this.triangleCells});
  }
  // Floor clutter (plugs, bottles, debris: no taller than a step, 18 units,
  // and 64 across) never blocks the player's own movement, even lying among
  // other clutter; zombies still collide with it. A prop with another resting
  // on it (the lower sandbags of a wall or pile) stays solid.
  markTinyProps(){
    const small=s=>s.maxs[2]-s.mins[2]<=TINY_PROP.height&&s.maxs[0]-s.mins[0]<=TINY_PROP.size&&s.maxs[1]-s.mins[1]<=TINY_PROP.size;
    const cells=new Map(),key=(x,y)=>x*100003+y;
    this.staticSurfaces.forEach((s,i)=>{for(let x=Math.floor(s.mins[0]/64);x<=Math.floor(s.maxs[0]/64);x++)for(let y=Math.floor(s.mins[1]/64);y<=Math.floor(s.maxs[1]/64);y++){const k=key(x,y);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);}});
    this.staticSurfaces.forEach((s,i)=>{
      if(!small(s))return;const near=new Set();
      for(let x=Math.floor(s.mins[0]/64);x<=Math.floor(s.maxs[0]/64);x++)for(let y=Math.floor(s.mins[1]/64);y<=Math.floor(s.maxs[1]/64);y++)for(const j of cells.get(key(x,y))||[])near.add(j);
      for(const j of near){if(j===i)continue;const o=this.staticSurfaces[j];
        if(o.mins[0]<=s.maxs[0]+2&&o.maxs[0]>=s.mins[0]-2&&o.mins[1]<=s.maxs[1]+2&&o.maxs[1]>=s.mins[1]-2&&o.mins[2]>=s.maxs[2]-2&&o.mins[2]<s.maxs[2]+30)return;}
      s.tiny=true;for(let k=s.triangleStart;k<s.triangleStart+s.triangleCount;k++)this.triangles[k].tiny=true;for(let k=s.brushStart;k<s.brushStart+s.brushCount;k++)this.brushes[k].tiny=true;
    });
  }
  addTriangle(points,contents=1,model=null,nativeNormal=null){
    const edges=points.map((p,i)=>points[(i+1)%3].map((v,k)=>v-p[k])),u=edges[0],v=edges[1],normal=nativeNormal||[u[2]*v[1]-u[1]*v[2],u[0]*v[2]-u[2]*v[0],u[1]*v[0]-u[0]*v[1]],length=Math.hypot(...normal);
    if(length<1e-8)return;for(let k=0;k<3;k++)normal[k]/=length;
    const axes=[[1,0,0],[0,1,0],[0,0,1],normal];for(const e of edges)axes.push([0,e[2],-e[1]],[-e[2],0,e[0]],[e[1],-e[0],0]);
    const values=[];for(const a of axes){const len=Math.hypot(...a);if(len<1e-8)continue;const n=a.map(x=>x/len),p=points.map(p=>n.reduce((s,x,k)=>s+x*p[k],0));values.push(...n,Math.min(...p),Math.max(...p));}
    // Moon repeats almost a million prop triangles. Store SAT intervals in
    // shared double-precision slabs instead of millions of tiny JS arrays.
    // The sweep math and precision remain identical to the native hull path.
    if(!this.intervalSlab||this.intervalCursor+values.length>this.intervalSlab.length){this.intervalSlab=new Float64Array(1<<20);this.intervalCursor=0;}
    const intervalStart=this.intervalCursor,intervalEnd=intervalStart+values.length;
    this.intervalSlab.set(values,intervalStart);this.intervalCursor=intervalEnd;
    const mins=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),maxs=[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))),id=this.triangles.length;
    this.triangles.push({mins,maxs,normal,dist:normal.reduce((s,x,k)=>s+x*points[0][k],0),intervals:this.intervalSlab,intervalStart,intervalEnd,contents,model});
    for(let x=Math.floor(mins[0]/128);x<=Math.floor(maxs[0]/128);x++)for(let y=Math.floor(mins[1]/128);y<=Math.floor(maxs[1]/128);y++){const key=cellKey(x,y);if(!this.triangleCells.has(key))this.triangleCells.set(key,[]);this.triangleCells.get(key).push(id);}
  }
  add(original, origin, target) {
    if (!(original.contents & ALL_CONTENTS)) return;
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
      const key=cellKey(x,y);if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(id);
    }
  }
  // Candidates are gathered in grid-visit order and deduplicated with stamps
  // (no per-trace Sets); the arithmetic matches the original step for step.
  trace(start,end,half=[0,0,0],mask=this.mask,ignoreWalkableTerrain=false) {
    const s0=start[0],s1=start[1],s2=start[2],e0=end[0],e1=end[1],e2=end[2],h0=half[0],h1=half[1],h2=half[2];
    const low0=Math.min(s0,e0)-h0,low1=Math.min(s1,e1)-h1,low2=Math.min(s2,e2)-h2,high0=Math.max(s0,e0)+h0,high1=Math.max(s1,e1)+h1,high2=Math.max(s2,e2)+h2;
    if(this.brushSeen?.length!==this.brushes.length||this.triangleSeen?.length!==this.triangles.length||this.traceStamp>=0xfffffff0){
      this.brushSeen=new Uint32Array(this.brushes.length);this.triangleSeen=new Uint32Array(this.triangles.length);this.traceStamp=0;this.brushIds=[];this.triangleIds=[];
    }
    const stamp=++this.traceStamp,brushSeen=this.brushSeen,triangleSeen=this.triangleSeen,brushIds=this.brushIds,triangleIds=this.triangleIds;brushIds.length=0;triangleIds.length=0;
    const visit=(x,y)=>{
      const key=cellKey(x,y),cellBrushes=this.cells.get(key),cellTriangles=this.triangleCells.get(key);
      if(cellBrushes)for(let i=0;i<cellBrushes.length;i++){const id=cellBrushes[i];if(brushSeen[id]!==stamp){brushSeen[id]=stamp;brushIds.push(id);}}
      if(cellTriangles)for(let i=0;i<cellTriangles.length;i++){const id=cellTriangles[i];if(triangleSeen[id]!==stamp){triangleSeen[id]=stamp;triangleIds.push(id);}}
    };
    if(high0-low0<256&&high1-low1<256){for(let x=Math.floor(low0/128);x<=Math.floor(high0/128);x++)for(let y=Math.floor(low1/128);y<=Math.floor(high1/128);y++)visit(x,y);}
    else{
      // Walk the swept ray's cells, rather than scanning its entire enclosing
      // rectangle. Diagonal shots used to inspect thousands of empty cells.
      let x=Math.floor(s0/128),y=Math.floor(s1/128);const ex=Math.floor(e0/128),ey=Math.floor(e1/128),dx=e0-s0,dy=e1-s1,sx=Math.sign(dx),sy=Math.sign(dy),rx=Math.ceil(h0/128),ry=Math.ceil(h1/128);
      let tx=dx?((x+(sx>0?1:0))*128-s0)/dx:Infinity,ty=dy?((y+(sy>0?1:0))*128-s1)/dy:Infinity;
      const limit=Math.abs(ex-x)+Math.abs(ey-y)+2;
      for(let step=0;step<limit;step++){for(let a=-rx;a<=rx;a++)for(let b=-ry;b<=ry;b++)visit(x+a,y+b);if(x===ex&&y===ey)break;if(tx<=ty){x+=sx;tx+=128/Math.abs(dx);}else{y+=sy;ty+=128/Math.abs(dy);}}
    }
    let fraction=1,normal=[0,0,0],solid=false,allSolid=false;const skipTiny=this.playerMovement;
    const disabled=this.disabled,checkDisabled=disabled.size>0;
    for(let c=0;c<brushIds.length;c++) {
      const b=this.brushes[brushIds[c]];if(!(b.contents&mask)||checkDisabled&&disabled.has(b.target)||skipTiny&&b.tiny)continue;
      const bm=b.mins,bM=b.maxs;if(bm[0]>high0||bm[1]>high1||bm[2]>high2||bM[0]<low0||bM[1]<low1||bM[2]<low2)continue;
      let enter=-1,leave=1,hit=null,outside=false,endOutside=false,reject=false,closest=null,closestDistance=-Infinity;
      const planes=b.planes;
      for(let k=0;k<planes.length;k++) {
        const p=planes[k];
        const support=Math.abs(p[0])*h0+Math.abs(p[1])*h1+Math.abs(p[2])*h2;
        const d1=p[0]*s0+p[1]*s1+p[2]*s2-p[3]-support;
        const d2=p[0]*e0+p[1]*e1+p[2]*e2-p[3]-support;
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
            const inward=closest[0]*(e0-s0)+closest[1]*(e1-s1)+closest[2]*(e2-s2);
            if(inward<-1e-9){fraction=0;normal=closest.slice(0,3);}
          }else{allSolid=true;fraction=0;normal=closest.slice(0,3);}
        }
        continue;
      }
      if(enter<leave&&enter>-1&&enter<fraction&&hit){fraction=Math.max(0,enter);normal=hit.slice(0,3);}
    }
    const d0=e0-s0,d1=e1-s1,d2=e2-s2;
    for(let c=0;c<triangleIds.length;c++){
      const t=this.triangles[triangleIds[c]],n=t.normal;if(!(t.contents&mask)||ignoreWalkableTerrain&&!t.model&&n[2]>.65||skipTiny&&t.tiny)continue;
      const tm=t.mins,tM=t.maxs;if(tm[0]>high0||tm[1]>high1||tm[2]>high2||tM[0]<low0||tM[1]<low1||tM[2]<low2)continue;
      let velocity=0;velocity+=n[0]*d0;velocity+=n[1]*d1;velocity+=n[2]*d2;
      let support=0;support+=Math.abs(n[0])*h0;support+=Math.abs(n[1])*h1;support+=Math.abs(n[2])*h2;
      let front=0;front+=n[0]*s0;front+=n[1]*s1;front+=n[2]*s2;front=front-t.dist-support;
      // A box can overlap the next triangle at a slope seam while its center
      // remains above the surface. Keep that contact; rejecting a penetrated
      // support point lets gravity carry the whole actor through the terrain.
      if(velocity>=-1e-8||front<-support-.03||front+velocity>.03)continue;
      let enter=0,leave=fraction,hit=n,reject=false;const intervals=t.intervals;
      for(let k=t.intervalStart;k<t.intervalEnd;k+=5){const a0=intervals[k],a1=intervals[k+1],a2=intervals[k+2],radius=Math.abs(a0)*h0+Math.abs(a1)*h1+Math.abs(a2)*h2,p=a0*s0+a1*s1+a2*s2,d=a0*d0+a1*d1+a2*d2,min=intervals[k+3]-radius,max=intervals[k+4]+radius;
        if(Math.abs(d)<1e-9){if(p<min-1e-7||p>max+1e-7){reject=true;break;}continue;}
        const first=(min-p)/d,last=(max-p)/d,near=Math.min(first,last),far=Math.max(first,last);if(near>enter){enter=near;hit=d>0?[-a0,-a1,-a2]:[a0,a1,a2];}leave=Math.min(leave,far);if(enter>leave+1e-7){reject=true;break;}
      }
      if(!reject&&enter<=leave&&enter<fraction){fraction=Math.max(0,enter-.03/Math.max(1e-8,-velocity));normal=hit.slice();}
    }
    return {fraction,normal,solid,allSolid,end:[s0+(e0-s0)*fraction,s1+(e1-s1)*fraction,s2+(e2-s2)*fraction]};
  }
  // Zombies are blocked by solid and monster clip but walk through player
  // clip (the clip sealing Kino's spawn closets): run fn with their mask.
  actor(fn){const mask=this.mask;this.mask=ACTOR_CONTENTS;try{return fn();}finally{this.mask=mask;}}
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
  supported(feet,half){
    let count=0;
    // Probes at the hull's edge: one unit in, a step onto a door sill had
    // to reach a whole unit over it before counting, and the player stalled.
    for(const [x,y] of [[0,0],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const at=[feet[0]+x*(half[0]-.25),feet[1]+y*(half[1]-.25)],t=this.trace([at[0],at[1],feet[2]+2],[at[0],at[1],feet[2]-8],[0,0,0]);
      if(t.fraction<1&&t.normal[2]>.65&&++count>=2)return true;
    }
    return false;
  }
  walkableBeyond(top,delta,half){
    const length=Math.hypot(delta[0],delta[1]),reach=24,ahead=[top[0]+delta[0]/length*reach,top[1]+delta[1]/length*reach,top[2]];
    const forward=this.trace(top,ahead,half);if(forward.allSolid||forward.fraction<1)return false;
    const floor=this.trace(ahead,[ahead[0],ahead[1],ahead[2]-18],half);
    return !floor.allSolid&&floor.fraction<1&&floor.normal[2]>=.65;
  }
  step(feet,delta,half=[14,14,35]) {
    const direct=this.move(feet,delta,half);
    if(Math.hypot(delta[0],delta[1])<.001)return direct;
    if(Math.hypot(direct.position[0]-feet[0],direct.position[1]-feet[1])>=Math.hypot(delta[0],delta[1])-.1)return direct;
    const center=[feet[0],feet[1],feet[2]+half[2]],up=this.trace(center,[center[0],center[1],center[2]+18],half);
    if(up.allSolid)return direct;
    const over=this.move([up.end[0],up.end[1],up.end[2]-half[2]],[delta[0],delta[1],Math.max(0,delta[2])],half);
    const top=[over.position[0],over.position[1],over.position[2]+half[2]],landing=this.trace(top,[top[0],top[1],top[2]-18+Math.min(0,delta[2])],half);
    if(landing.allSolid)return direct;
    // A steep landing is normally a wall or rubble face. A short bevelled lip
    // (e.g. the Der Riese mainframe threshold, 56 degrees, 8 units) is crossed
    // when walkable floor lies just beyond it within step height.
    if(landing.fraction<1&&landing.normal[2]<.65&&!(landing.normal[2]>=.5&&this.walkableBeyond(top,delta,half)))return direct;
    // Step probes remain vertical; sliding an 18-unit downward probe along a
    // tilted prop face used to kick the player sideways into nearby barriers.
    const down={position:[landing.end[0],landing.end[1],landing.end[2]-half[2]],grounded:landing.fraction<1&&landing.normal[2]>.65};
    // The player steps only onto something that can hold them: at least two of
    // five downward probes (centre and corners) must find floor at the landing
    // height. Stair treads support the leading corners; the edge of a thin
    // slat or plate (Kino's mainframe face) does not, so it is not a step.
    if(this.playerMovement&&down.position[2]>feet[2]+1&&!this.supported(down.position,half))return direct;
    if(Math.hypot(down.position[0]-feet[0],down.position[1]-feet[1])>Math.hypot(direct.position[0]-feet[0],direct.position[1]-feet[1])+.1)return down;
    return direct;
  }
}
