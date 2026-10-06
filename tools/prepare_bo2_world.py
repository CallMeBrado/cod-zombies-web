"""Decode T6's packed render streams into the shared browser vertex format.

Each surface indexes a packed batch, not firstVertex. Validate every referenced
position against its native bounds before publishing buffers to the renderer.
"""
from pathlib import Path
import json, struct, math

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
# Routing data is retained in the local native diagnostic export, not downloaded.
for info in world['materials'].values():info.pop('declarations',None)
(folder/world['vertices']).write_bytes(output)
(folder/world['indices']).write_bytes(out_indices)
path.write_text(json.dumps(world,separators=(',',':')))
print(f'Validated {len(surfaces)} native Buried surfaces, {count} vertices, {len(out_indices)//6} triangles.')
