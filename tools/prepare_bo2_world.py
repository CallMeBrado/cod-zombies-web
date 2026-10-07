"""Decode T6's packed render streams into the shared browser vertex format.

Each surface indexes a packed batch, not firstVertex. Validate every referenced
position against its native bounds before publishing buffers to the renderer.
"""
from pathlib import Path
import json, struct, math, re

ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'local-data/bo2-buried/web-world'
path=folder/'zm_buried.json'
world=json.loads(path.read_text())
native=folder/'zm_buried.native.json'
if world['vertexStride']==0:
    native.write_text(json.dumps(world,separators=(',',':')))
else:
    world=json.loads(native.read_text())
vertices=(folder/world['vertices']).read_bytes()
indices=(folder/world['indices']).read_bytes()
output=bytearray();out_indices=bytearray();surfaces=[];count=0
for surface in world['surfaces']:
    row=dict(surface)
    ids=struct.unpack_from('<'+str(row['triangleCount']*3)+'H',indices,row['baseIndex']*2)
    used=sorted(set(ids));mapping={old:i for i,old in enumerate(used)}
    row.update(firstVertex=count,vertexCount=len(used),baseIndex=len(out_indices)//2)
    for vertex in used:
        offset=surface['stream0Offset']+vertex*36
        xyz=struct.unpack_from('<3f',vertices,offset)
        if not all(math.isfinite(v) and surface['bounds'][0][k]-.25<=v<=surface['bounds'][1][k]+.25 for k,v in enumerate(xyz)):
            raise RuntimeError('T6 surface points outside its authored bounds: '+str(surface))
        uv=struct.unpack_from('<2e',vertices,offset+20)
        light_uv=struct.unpack_from('<2H',vertices,offset+32)
        if not all(math.isfinite(v) for v in uv):raise RuntimeError('Non-finite T6 texture coordinate')
        output.extend(struct.pack('<7f',*xyz,*uv,*(v/65535 for v in light_uv)))
        output.extend(vertices[offset+16:offset+20]);count+=1
    out_indices.extend(struct.pack('<'+str(len(ids))+'H',*(mapping[v] for v in ids)))
    surfaces.append(row)
world.update(format='bo2-web-world-v2',vertexStride=32,vertexCount=count,surfaces=surfaces,vertices='zm_buried.web.vertices.bin',indices='zm_buried.web.indices.bin')
# Compiled blend materials (*<base>_<layer>) keep a second layer: its color
# map, tint and how it combines (b: blend by its alpha, m: multiply,
# t: alpha-tested), revealed by the vertex color's green channel ("v1") with
# alphaRevealParms1. The base layer's own colorTint applies as well.
materials=ROOT/'local-data/bo2-buried/materials'
for name,info in world['materials'].items():
    if not name.startswith('*'):continue
    record=materials/'generated'/(name.split('(')[0].replace('*','_')+'.json')
    if not record.exists():continue
    native=json.loads(record.read_text());textures={t['name']:t['image'] for t in native['textures']}
    constants={c['name']:c['literal'] for c in native.get('constants',[])}
    layer=re.search(r'_([bmt])1c1(\w*?)(?:_|$)',native['techniqueSet'])
    if not layer or 'colorMap1' not in textures:continue
    info['tint']=constants.get('colorTint',[1,1,1,1])[:3]
    info['layer']=dict(diffuse=textures['colorMap1'],mode=layer.group(1),vertex='v1' in layer.group(2),
        reveal=constants.get('alphaRevealParms1',[0,0,0,0])[:2],tint=constants.get('colorTint1',[1,1,1,1])[:3])
# Each surface's native blend state (its first depth-tested color pass):
# opaque, alpha-tested at 128, alpha-blended decals, glass and overlays,
# premultiplied, additive chalk and multiply stains.
def native_record(name):
    if name.startswith('*'):return materials/'generated'/(name.split('(')[0].replace('*','_')+'.json')
    for zone in ['bo2-buried','bo2-patch','bo2-classic','bo2-base','bo2-common']:
        record=ROOT/'local-data'/zone/'materials'/(name+'.json')
        if record.exists():return record
for name,info in world['materials'].items():
    record=native_record(name)
    if not record or not record.exists():continue
    native=json.loads(record.read_text())
    passes=[b for b in native.get('stateBits',[]) if b.get('colorWriteRgb') and b.get('depthTest')=='less_equal' and not b.get('polymodeLine')]
    if not passes:continue
    b=passes[0];source,destination=b.get('srcBlendRgb'),b.get('dstBlendRgb')
    if b.get('blendOpRgb','disabled')=='disabled':info['blend']='test' if b.get('alphaTest','disabled')!='disabled' else 'opaque'
    elif (source,destination)==('srcalpha','invsrcalpha'):info['blend']='alpha'
    elif (source,destination)==('one','invsrcalpha'):info['blend']='premultiplied'
    elif (source,destination)==('one','one'):info['blend']='add'
    elif (source,destination)==('zero','srccolor'):info['blend']='multiply'
    else:info['blend']='opaque'
    if b.get('polygonOffset','offset0')!='offset0':info['decal']=True
# Routing data is retained in the local native diagnostic export, not downloaded.
for info in world['materials'].values():info.pop('declarations',None)
(folder/world['vertices']).write_bytes(output)
(folder/world['indices']).write_bytes(out_indices)
path.write_text(json.dumps(world,separators=(',',':')))
print(f'Validated {len(surfaces)} native Buried surfaces, {count} vertices, {len(out_indices)//6} triangles.')
