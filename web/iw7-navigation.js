// A bounded, time-sliced flow field shared by the entire horde. The imported
// render collision is temporary until IW7's native Havok/nav data is decoded.
export class ParkNavigation {
  constructor(trace){this.trace=trace;this.cells=new Map();this.edges=new Map();this.flow=new Map();this.size=64;this.target=null;this.generation=0;}
  key(x,y,z){return `${x},${y},${z}`;}
  cell(x,y,z){
    const key=this.key(x,y,z);if(this.cells.has(key))return this.cells.get(key);
    const px=x*this.size,py=y*this.size,top=z*128+100,hit=this.trace([px,py,top],[0,0,-1],220);
    let result=null;
    if(hit&&hit.normal[2]>.65){
      const pz=top-hit.distance+.05;let blocked=false;
      for(const height of [22,53])for(const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]])if(this.trace([px,py,pz+height],d,17)){blocked=true;break;}
      if(!blocked)result={key,x,y,z,position:[px,py,pz]};
    }
    this.cells.set(key,result);return result;
  }
  nearest(position){
    const x=Math.round(position[0]/this.size),y=Math.round(position[1]/this.size),z=Math.round(position[2]/128);
    let best=null,distance=Infinity;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const cell=this.cell(x+dx,y+dy,z);if(!cell)continue;const d=Math.hypot(cell.position[0]-position[0],cell.position[1]-position[1],cell.position[2]-position[2]);if(d<distance){best=cell;distance=d;}}
    return best;
  }
  connected(a,b){
    const key=[a.key,b.key].sort().join(':');if(this.edges.has(key))return this.edges.get(key);
    let open=Math.abs(a.position[2]-b.position[2])<=20;
    if(open){const dx=b.position[0]-a.position[0],dy=b.position[1]-a.position[1],len=Math.hypot(dx,dy),dir=[dx/len,dy/len,0];
      for(const h of [23,52])for(const side of [-12,12]){const o=[a.position[0]-dir[1]*side,a.position[1]+dir[0]*side,Math.max(a.position[2],b.position[2])+h];if(this.trace(o,dir,len)){open=false;break;}}
      const floor=this.trace([(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2,Math.max(a.position[2],b.position[2])+20],[0,0,-1],44);if(!floor||floor.normal[2]<.65)open=false;
    }
    this.edges.set(key,open);return open;
  }
  begin(position){
    const goal=this.nearest(position);if(!goal||this.target?.key===goal.key)return;
    this.target=goal;this.pending=new Map([[goal.key,{cell:goal,distance:0,next:null}]]);this.queue=[goal];this.cursor=0;
  }
  work(limit=28){
    if(!this.pending)return;
    for(let i=0;i<limit&&this.cursor<this.queue.length;i++){
      const a=this.queue[this.cursor++],distance=this.pending.get(a.key).distance;
      if(distance>=22)continue;
      for(const [x,y]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const b=this.cell(a.x+x,a.y+y,a.z);if(!b||this.pending.has(b.key)||!this.connected(a,b))continue;
        this.pending.set(b.key,{cell:b,distance:distance+1,next:a});this.queue.push(b);
      }
    }
    if(this.cursor>=this.queue.length){this.flow=this.pending;this.pending=null;this.generation++;}
  }
  next(position){const at=this.nearest(position),node=at&&this.flow.get(at.key);return node?.next?.position||node?.cell.position||null;}
  spawns(player,nativePoints){
    const all=[...this.flow.values()].filter(n=>n.distance>=6&&n.distance<=19&&Math.hypot(n.cell.position[0]-player[0],n.cell.position[1]-player[1])>360);
    // Prioritize reachable entries adjacent to the original active spawn group.
    const nearby=nativePoints.filter(p=>Math.hypot(p.origin[0]-player[0],p.origin[1]-player[1])<2200);
    return all.map(n=>({position:n.cell.position,score:nearby.length?Math.min(...nearby.map(p=>Math.hypot(p.origin[0]-n.cell.position[0],p.origin[1]-n.cell.position[1]))):0})).sort((a,b)=>a.score-b.score).slice(0,32).map(n=>n.position);
  }
}
