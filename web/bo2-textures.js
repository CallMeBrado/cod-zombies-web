// Native T6 DX11 normal maps are BC5 (two BC4 channels). Three's DDS loader
// does not decode that format; retain both authored channels in an RGBA texture.
export function decodeBC5(buffer){
  const h=new DataView(buffer);
  if(buffer.byteLength<148||h.getUint32(84,true)!==0x30315844||h.getUint32(128,true)!==83)return null;
  const width=h.getUint32(16,true),height=h.getUint32(12,true),pixels=new Uint8Array(width*height*4),bw=Math.ceil(width/4),bh=Math.ceil(height/4);
  if(148+bw*bh*16>buffer.byteLength)throw new Error('Incomplete native BC5 image');
  const block=(at)=>{const a=h.getUint8(at),b=h.getUint8(at+1),table=[a,b];
    if(a>b)for(let j=1;j<=6;j++)table.push(((7-j)*a+j*b)/7);
    else{for(let j=1;j<=4;j++)table.push(((5-j)*a+j*b)/5);table.push(0,255);}
    let bits=0;for(let j=0;j<6;j++)bits+=h.getUint8(at+2+j)*2**(j*8);
    return Array.from({length:16},(_,j)=>Math.round(table[Math.floor(bits/2**(j*3))%8]));};
  for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){
    const at=148+(y*bw+x)*16,r=block(at),g=block(at+8);
    for(let j=0;j<16;j++){const px=x*4+j%4,py=y*4+(j>>2);if(px>=width||py>=height)continue;const k=(py*width+px)*4;
      pixels[k]=r[j];pixels[k+1]=g[j];pixels[k+2]=Math.round((Math.sqrt(Math.max(0,1-(r[j]/127.5-1)**2-(g[j]/127.5-1)**2))*.5+.5)*255);pixels[k+3]=255;}
  }
  return {pixels,width,height};
}
