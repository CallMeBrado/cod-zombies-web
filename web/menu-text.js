import {assetResponse} from './preload.js';
// Render the installed game's bitmap glyphs while retaining normal HTML text
// for accessibility, keyboard focus and browser controls.
export class MenuText {
 constructor(root,font){this.root=root;this.font=font;this.tint=new Map();}
 async prepare(){for(const [variable,name]of [['--menu-backing','menu_button_backing_right'],['--menu-highlight','menu_button_backing_highlight_right']]){
  const response=await assetResponse('/data/gameplay/hud/'+name+'.png');if(!response.ok)throw new Error('Missing original menu artwork');
  const url=URL.createObjectURL(await response.blob());this.root.style.setProperty(variable,`url("${url}")`);
 }this.paint();}
 paint(){if(!this.font.fontReady&&!this.font.ready)return;for(const element of this.root.querySelectorAll('[data-menu-text]'))this.draw(element);}
 draw(element){
  let canvas=element.querySelector('canvas'),label=element.querySelector('.menu-label');if(!canvas){label=document.createElement('span');label.className='menu-label';label.textContent=element.textContent;canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');element.replaceChildren(label,canvas);}
  const text=label.textContent,style=getComputedStyle(element),size=parseFloat(style.fontSize),color=style.color,scale=size/this.font.font.pixelHeight,dpr=Math.min(devicePixelRatio,2);
  let atlas=this.tint.get(color);if(!atlas){atlas=document.createElement('canvas');atlas.width=this.font.atlas.width;atlas.height=this.font.atlas.height;const c=atlas.getContext('2d');c.drawImage(this.font.atlas,0,0);c.globalCompositeOperation='source-in';c.fillStyle=color;c.fillRect(0,0,atlas.width,atlas.height);this.tint.set(color,atlas);}
  const letters=[...text].map(c=>this.font.glyphs.get(c)||this.font.glyphs.get(' ')),width=Math.max(1,Math.ceil(letters.reduce((sum,g)=>sum+g.dx*scale,0))),height=Math.ceil(size*1.15);
  canvas.width=Math.ceil(width*dpr);canvas.height=Math.ceil(height*dpr);canvas.style.width=width+'px';canvas.style.height=height+'px';const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);let x=0;
  for(const g of letters){if(g.pixelWidth)ctx.drawImage(atlas,g.s0*atlas.width,g.t0*atlas.height,(g.s1-g.s0)*atlas.width,(g.t1-g.t0)*atlas.height,x+g.x0*scale,size+g.y0*scale,g.pixelWidth*scale,g.pixelHeight*scale);x+=g.dx*scale;}
 }
 set(element,value){const label=element.querySelector('.menu-label');if(label)label.textContent=value;else element.textContent=value;this.draw(element);}
}
