"""Spatially batch Spaceland's native render geometry for the browser test."""
from pathlib import Path
import json
import re
import struct
from collections import defaultdict
import numpy as np
from extract_spaceland import OUTPUT, PRIVATE, key


def prepare():
    manifest = json.loads((OUTPUT / 'manifest.json').read_text(encoding='utf8'))
    raw = (OUTPUT / manifest['world']['url']).read_bytes()
    _, version, vertex_count, index_count = struct.unpack_from('<4sIII', raw)
    assert version == 1
    vertices = np.frombuffer(raw, dtype='<f4', offset=16, count=vertex_count * 8).reshape(-1, 8)
    indices = np.frombuffer(raw, dtype='<u4', offset=16 + vertex_count * 32, count=index_count)
    tiles = defaultdict(lambda: defaultdict(list))
    for group in manifest['world']['groups']:
        triangles = indices[group['start']:group['start'] + group['count']].reshape(-1, 3)
        centres = vertices[triangles, :3].mean(axis=1)
        cells = np.floor(centres[:, :2] / 1024).astype('i4')
        for cell in np.unique(cells, axis=0):
            selected = triangles[(cells == cell).all(axis=1)]
            tiles[tuple(cell)][group['material']].append(selected)
    chunks = []
    for cell, materials in sorted(tiles.items()):
        merged, groups, offset = [], [], 0
        for material, parts in sorted(materials.items()):
            chunk_indices = np.concatenate(parts).ravel()
            merged.append(chunk_indices)
            groups.append({'start': offset, 'count': len(chunk_indices), 'material': material})
            offset += len(chunk_indices)
        original_indices = np.concatenate(merged)
        used, remapped = np.unique(original_indices, return_inverse=True)
        chunk_vertices = vertices[used]
        name = key('world-chunk-' + str(cell))
        filename = 'geometry/' + name + '.bin'
        (OUTPUT / filename).write_bytes(struct.pack('<4sIII', b'IW7G', 1, len(used), len(remapped)) + chunk_vertices.tobytes() + remapped.astype('<u4').tobytes())
        chunks.append({'name': str(cell), 'url': filename, 'vertices': len(used), 'indices': len(remapped), 'bytes': 16 + len(used) * 32 + len(remapped) * 4, 'groups': groups,
                       'bounds': [chunk_vertices[:, :3].min(axis=0).tolist(), chunk_vertices[:, :3].max(axis=0).tolist()]})
    manifest['chunks'] = chunks
    records = json.loads((PRIVATE / 'native/entities.json').read_text(encoding='utf8'))
    world = records[0]
    manifest['sun'] = {'color': [float(v) for v in world['suncolor'].split()], 'intensity': float(world['sunlight']), 'angles': [float(v) for v in world['sundirection'].split()]}
    manifest['testMode'] = 'Native map exploration and performance test; survival gameplay is not implemented yet.'
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf8')
    print(f'Spaceland: {len(chunks)} spatial world chunks, {sum(len(c["groups"]) for c in chunks)} material batches; original {index_count // 3} triangles retained.')


if __name__ == '__main__':
    prepare()
