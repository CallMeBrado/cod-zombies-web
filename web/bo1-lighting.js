// T5 lmap pixel shaders: RGB565 carries red/blue chroma and the two normal
// coordinates; G16R16 carries ambient/directional intensity (scale 31.875).
// Convert to the shared renderer's stacked linear RGBA lighting texture.
export function decodeKinoLightmap(chroma,intensity,width,height){
  const a=new DataView(chroma),b=new DataView(intensity),half=height/2;
  if(!Number.isInteger(half)||chroma.byteLength!==width*height*2||intensity.byteLength!==width*half*4)throw new Error('Invalid T5 lightmap dimensions.');
  const out=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const pixel=y*width+x,v=a.getUint16(pixel*2,true),r=((v>>>11)&31)/31,g=((v>>>5)&63)/63,blue=(v&31)/31;
    const i=b.getUint16(((y%half)*width+x)*4+(y>=half?2:0),true)/65535*31.875;
    out[pixel*4]=r*i*4;out[pixel*4+1]=(1-r-blue)*i*2;out[pixel*4+2]=blue*i*4;
    // Preserve the native d.xy = chroma.g * 4 - 2 in the renderer's encoding.
    out[pixel*4+3]=(g*4-2+(y>=half?2.064516:2.08))/(y>=half?4.064516:4.08);
  }return out;
}
