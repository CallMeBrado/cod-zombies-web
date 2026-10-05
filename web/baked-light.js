// Exact nearest sample within the original 27 lighting cells. Dense surfaces
// use a bounded tree instead of scanning every vertex around each actor.
export class BakedLightSamples {
  constructor(samples) {
    const groups=new Map();
    samples.forEach((sample,order)=>{const key=sample.p.map(v=>Math.floor(v/128)).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push({sample,order});});
    const build=items=>{
      const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
      for(const {sample}of items)for(let k=0;k<3;k++){low[k]=Math.min(low[k],sample.p[k]);high[k]=Math.max(high[k],sample.p[k]);}
      if(items.length<=16)return {low,high,items};
      let axis=0;for(let k=1;k<3;k++)if(high[k]-low[k]>high[axis]-low[axis])axis=k;
      items.sort((a,b)=>a.sample.p[axis]-b.sample.p[axis]||a.order-b.order);const middle=items.length>>1;
      return {low,high,left:build(items.slice(0,middle)),right:build(items.slice(middle))};
    };
    this.cells=new Map([...groups].map(([key,items])=>[key,build(items)]));
  }
  nearest(position) {
    const cx=Math.floor(position[0]/128),cy=Math.floor(position[1]/128),cz=Math.floor(position[2]/128);
    let best=null,distance=Infinity;
    const bound=node=>{let d=0;for(let k=0;k<3;k++){const delta=Math.max(node.low[k]-position[k],0,position[k]-node.high[k]);d+=delta*delta;}return d;};
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const tree=this.cells.get((cx+x)+','+(cy+y)+','+(cz+z));if(!tree)continue;
      let found=null,localDistance=distance,order=Infinity;
      const visit=(node,minimum)=>{
        if(minimum>localDistance)return;
        if(node.items){for(const item of node.items){const p=item.sample.p,d=(p[0]-position[0])**2+(p[1]-position[1])**2+(p[2]-position[2])**2;
          if(d<localDistance||found&&d===localDistance&&item.order<order){found=item.sample;localDistance=d;order=item.order;}}
        }else{const a=bound(node.left),b=bound(node.right);if(a<=b){visit(node.left,a);visit(node.right,b);}else{visit(node.right,b);visit(node.left,a);}}
      };
      visit(tree,bound(tree));if(found){best=found;distance=localDistance;}
    }
    return best;
  }
}
