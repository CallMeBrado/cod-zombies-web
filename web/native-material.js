// T6 skin shaders bind both a rim mask and their diffuse to colorMap. The
// authored sampler name distinguishes them; semantic alone picks the mask.
export function nativeDiffuse(material){
  const textures=material?.textures||[];
  return textures.find(t=>/^diffuse_?map$/i.test(t.name||''))||
    textures.find(t=>t.name==='colorMap')||textures.find(t=>t.semantic==='colorMap');
}
