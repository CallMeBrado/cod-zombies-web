"""Export IW7's native Spaceland render world from the offline Cordycep loader.

Structures checked against auroramod/iw7-mod database.hpp; image/mesh decoding
follows Scobalula/Greyhound's IW handler. Assets remain ignored on E:.
This is the render import; Havok collision and gameplay require separate work.
"""
import argparse
import hashlib
import io
import json
import struct
import re
from pathlib import Path
import numpy as np
from PIL import Image
import lz4.block
from iw7_memory import ROOT, Memory, state, assets

OUTPUT = ROOT / 'local-data/gameplay/iw7-spaceland'
PRIVATE = ROOT / 'local-data/iw7-spaceland'


def key(name):
    return hashlib.sha256(name.encode('utf8')).hexdigest()[:20]


def package_data(path, start, end):
    with path.open('rb') as stream:
        stream.seek(start + 4)
        total, = struct.unpack('<Q', stream.read(8))
        if total > 128 * 1024 * 1024:
            raise ValueError('IW texture exceeds bounded decode size')
        stream.read(4)
        output = bytearray()
        while len(output) < total:
            compressed, size, flags = struct.unpack('<III', stream.read(12))
            if not size or stream.tell() + compressed > end or len(output) + size > total:
                raise ValueError('Invalid IW texture block')
            output.extend(lz4.block.decompress(stream.read(compressed), uncompressed_size=size))
            stream.seek((stream.tell() + 3) & ~3)
        return bytes(output)


def dds_image(data, width, height, fmt):
    header = bytearray(148)
    header[:4] = b'DDS '
    struct.pack_into('<7I', header, 4, 124, 0x81007, height, width, len(data), 0, 1)
    struct.pack_into('<II4s', header, 76, 32, 4, b'DX10')
    struct.pack_into('<I', header, 108, 0x1000)
    struct.pack_into('<5I', header, 128, fmt, 3, 0, 1, 0)
    return Image.open(io.BytesIO(header + data)).convert('RGBA')


class Exporter:
    def __init__(self, memory, context, cap):
        self.memory, self.context, self.cap = memory, context, cap
        self.images, self.materials, self.models = {}, {}, {}
        self.failures = []
        (OUTPUT / 'textures').mkdir(parents=True, exist_ok=True)
        (OUTPUT / 'geometry').mkdir(parents=True, exist_ok=True)
        (PRIVATE / 'native').mkdir(parents=True, exist_ok=True)

    def image(self, pointer):
        if not pointer:
            return None
        if pointer in self.images:
            return self.images[pointer]
        m = self.memory
        name = m.string(m.pointer(pointer + 104))
        ident = key(name + ':' + str(self.cap))
        path = OUTPUT / f'textures/{ident}.png'
        h = m.read(pointer, 112)
        fmt, streamed = h[24], h[57]
        if h[32] == 5:
            self.images[pointer] = None  # Cube faces need the sky import, not a 2D texture.
            return None
        width, height = struct.unpack_from('<HH', h, 48)
        try:
            if streamed:
                dims = [struct.unpack_from('<HH', h, offset) for offset in (72, 80, 88, 96)]
                levels = [(i, w, t) for i, (w, t) in enumerate(dims) if w and t]
                choices = [v for v in levels if max(v[1:]) <= self.cap] or levels[:1]
                level, width, height = max(choices, key=lambda v: v[1] * v[2])
                start, end, package = m.unpack('<QQH', pointer + 112 + level * 24)
                if not end > start:
                    raise ValueError('Unresolved IW streamed texture')
                data = package_data(Path(self.context['directory']) / f'imagefile{package}.pak', start, end)
            else:
                size, = struct.unpack_from('<I', h, 40)
                data = m.read(m.pointer(pointer + 64), size)
            if not path.exists():
                image = dds_image(data, width, height, fmt)
                image.thumbnail((self.cap, self.cap), Image.Resampling.LANCZOS)
                image.save(path, compress_level=2)
            result = {'name': name, 'url': f'textures/{ident}.png', 'width': min(self.cap, width), 'height': min(self.cap, height), 'format': fmt, 'bytes': path.stat().st_size}
        except (OSError, ValueError, struct.error) as error:
            self.failures.append({'image': name, 'error': str(error)})
            result = None
        self.images[pointer] = result
        return result

    def material(self, pointer):
        if pointer in self.materials:
            return key(self.materials[pointer]['name'])
        m = self.memory
        name = m.string(m.pointer(pointer))
        count = m.read(pointer + 48, 1)[0]
        table = m.pointer(pointer + 64)
        technique = m.string(m.pointer(m.pointer(pointer + 56)))
        constants = {}
        constant_count = m.read(pointer + 49, 1)[0]
        constant_table = m.pointer(pointer + 72)
        for i in range(constant_count):
            record = m.read(constant_table + i * 32, 32)
            constant_name = record[4:16].split(b'\0', 1)[0].decode('ascii', errors='replace')
            constants[constant_name] = list(struct.unpack_from('<4f', record, 16))
        textures = []
        diffuse = None
        emissive = None
        for i in range(count):
            semantic, image_pointer = m.unpack('<I4xQ', table + i * 16)
            image_name = m.string(m.pointer(image_pointer + 104))
            textures.append({'semantic': semantic, 'name': image_name})
            if semantic == 0xA0AB1041:
                diffuse = self.image(image_pointer)
            if semantic == 0x34614347:
                emissive = self.image(image_pointer)
        self.materials[pointer] = {'name': name, 'diffuse': diffuse, 'emissive': emissive, 'textures': textures, 'technique': technique, 'constants': constants}
        return key(name)

    def geometry(self, label, vertices, indices, groups):
        if not len(vertices) or not len(indices) or not np.isfinite(vertices).all():
            raise ValueError(f'Invalid IW geometry: {label}')
        if int(indices.max()) >= len(vertices):
            raise ValueError(f'Out-of-range IW mesh index: {label}')
        ident = key(label)
        path = OUTPUT / f'geometry/{ident}.bin'
        header = struct.pack('<4sIII', b'IW7G', 1, len(vertices), len(indices))
        path.write_bytes(header + vertices.astype('<f4').tobytes() + indices.astype('<u4').tobytes())
        return {'name': label, 'url': f'geometry/{ident}.bin', 'vertices': len(vertices), 'indices': len(indices), 'bytes': path.stat().st_size, 'groups': groups,
                'bounds': [vertices[:, :3].min(axis=0).tolist(), vertices[:, :3].max(axis=0).tolist()]}

    def model(self, pointer):
        if pointer in self.models:
            return key(self.models[pointer]['name'])
        m = self.memory
        name = m.string(m.pointer(pointer))
        h = m.read(pointer, 736)
        num_lods = h[11]
        if not 0 < num_lods <= 6:
            raise ValueError(f'Unresolved native model: {name}')
        # First LOD, material handles and surface streams from Greyhound's IWXModel.
        surfaces, first_material = struct.unpack_from('<HH', h, 228)
        surface_pointer, = struct.unpack_from('<Q', h, 272)
        materials_pointer, = struct.unpack_from('<Q', h, 216)
        vertices, indices, groups = [], [], []
        first_vertex, first_index = 0, 0
        for i in range(surfaces):
            s = m.read(surface_pointer + i * 256, 256)
            vertex_count, triangle_count = struct.unpack_from('<HH', s, 2)
            vertex_pointer, index_pointer = struct.unpack_from('<QQ', s, 32)
            if not vertex_count or not triangle_count:
                continue
            raw = np.frombuffer(m.read(vertex_pointer, vertex_count * 32), dtype=np.dtype({'names': ['position', 'uv', 'normal'], 'formats': [('<f4', 3), ('<f2', 2), '<u4'], 'offsets': [0, 20, 24], 'itemsize': 32}))
            v = np.zeros((vertex_count, 8), dtype='<f4')
            v[:, :3] = raw['position']
            v[:, 3:5] = raw['uv']
            n = raw['normal']
            for axis in range(3):
                v[:, 5 + axis] = ((n >> (axis * 10)) & 1023) / 1023 * 2 - 1
            idx = np.frombuffer(m.read(index_pointer, triangle_count * 6), dtype='<u2').astype('<u4')
            if int(idx.max()) >= vertex_count:
                raise ValueError(f'Bad native model triangles: {name}')
            material = self.material(m.pointer(materials_pointer + (first_material + i) * 8))
            vertices.append(v)
            indices.append(idx + first_vertex)
            groups.append({'start': first_index, 'count': len(idx), 'material': material})
            first_vertex += vertex_count
            first_index += len(idx)
        result = self.geometry(name, np.concatenate(vertices), np.concatenate(indices), groups)
        self.models[pointer] = result
        return key(name)

    def world(self, pointer):
        m = self.memory
        h = m.read(pointer, 4520)
        name = m.string(m.pointer(pointer))
        surface_count, = struct.unpack_from('<I', h, 28)
        index_count, = struct.unpack_from('<I', h, 168 + 496)
        indices_pointer, = struct.unpack_from('<Q', h, 168 + 504)
        surface_pointer, = struct.unpack_from('<Q', h, 2976 + 840)
        if not 0 < surface_count < 100000 or not 0 < index_count < 20000000:
            raise ValueError('Invalid IW world counts')
        raw_indices = np.frombuffer(m.read(indices_pointer, index_count * 2), dtype='<u2')
        surfaces = m.read(surface_pointer, surface_count * 48)
        zones = {}
        for i in range(32):
            zone_pointer, = struct.unpack_from('<Q', h, 168 + 240 + i * 8)
            if not zone_pointer:
                continue
            count, = m.unpack('<I', zone_pointer + 12)
            if not count:
                continue
            if count > 3000000:
                raise ValueError('Invalid IW transient vertex count')
            raw = np.frombuffer(m.read(m.pointer(zone_pointer + 16), count * 44), dtype=np.dtype({'names': ['position', 'uv', 'normal'], 'formats': [('<f4', 3), ('<f4', 2), '<u4'], 'offsets': [0, 20, 36], 'itemsize': 44}))
            v = np.zeros((count, 8), dtype='<f4')
            v[:, :3], v[:, 3:5] = raw['position'], raw['uv']
            for axis in range(3):
                n = (raw['normal'] >> (axis * 10)) & 1023
                v[:, 5 + axis] = n / 1023 * 2 - 1
            zones[i] = v
        ordered = sorted(zones)
        offsets, running = {}, 0
        for i in ordered:
            offsets[i] = running
            running += len(zones[i])
        vertex_data = np.concatenate([zones[i] for i in ordered])
        indices, groups, index_offset = [], [], 0
        for i in range(surface_count):
            s = surfaces[i * 48:(i + 1) * 48]
            first, = struct.unpack_from('<I', s, 4)
            count, = struct.unpack_from('<H', s, 14)
            base_index, = struct.unpack_from('<I', s, 16)
            material, = struct.unpack_from('<Q', s, 24)
            zone = s[40]
            if not count:
                continue
            if zone not in zones or base_index + count * 3 > len(raw_indices):
                raise ValueError('Unresolved IW world surface')
            idx = raw_indices[base_index:base_index + count * 3].astype('<u4') + first
            if int(idx.max()) >= len(zones[zone]):
                raise ValueError('Out-of-range native world surface')
            indices.append(idx + offsets[zone])
            groups.append({'start': index_offset, 'count': len(idx), 'material': self.material(material), 'lightmap': s[32], 'flags': s[33]})
            index_offset += len(idx)
        result = self.geometry(name, vertex_data, np.concatenate(indices), groups)
        static_count, = struct.unpack_from('<I', h, 2976)
        static_pointer, = struct.unpack_from('<Q', h, 2976 + 856)
        static = []
        for i in range(static_count):
            s = m.read(static_pointer + i * 184, 184)
            model_pointer, = struct.unpack_from('<Q', s, 56)
            model = self.model(model_pointer)
            static.append({'model': model, 'origin': list(struct.unpack_from('<3f', s)), 'axis': list(struct.unpack_from('<9f', s, 12)), 'scale': struct.unpack_from('<f', s, 48)[0]})
            if (i + 1) % 500 == 0:
                print(f'Exported {i + 1}/{static_count} native static instances', flush=True)
        return result, static


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--texture-size', type=int, choices=[512, 1024, 2048, 4096], default=512)
    args = parser.parse_args()
    context = state()
    memory = Memory(args.pid)
    try:
        exporter = Exporter(memory, context, args.texture_size)
        world_assets = [a for a in assets(memory, context['pools'], 29) if not a['temporary']]
        if len(world_assets) != 1 or 'cp_zmb' not in memory.string(memory.pointer(world_assets[0]['header'])):
            raise ValueError('Load cp_zmb in the Infinite Warfare Cordycep handler first')
        world, static = exporter.world(world_assets[0]['header'])
        entities = next(a for a in assets(memory, context['pools'], 27) if not a['temporary'])['header']
        entity_count, = memory.unpack('<I', entities + 16)
        entity_text = memory.read(memory.pointer(entities + 8), entity_count).rstrip(b'\0').decode('utf8')
        (PRIVATE / 'native/entities.txt').write_text(entity_text, encoding='utf8')
        token_source = ROOT / '.tools/gsc-tool-source/src/gsc/engine/iw7_token.cpp'
        tokens = {int(code, 16): name for code, name in re.findall(r'\{ 0x([0-9A-F]+), "(.*?)" \}', token_source.read_text(encoding='utf8'))}
        records = [{tokens.get(int(code)) or code: value for code, value in re.findall(r'(\d+) "([^"\n]*)"', block)} for block in re.findall(r'\{([^}]+)\}', entity_text)]
        (PRIVATE / 'native/entities.json').write_text(json.dumps(records, indent=2), encoding='utf8')
        spawns_count, = memory.unpack('<H', entities + 304)
        spawns_pointer = memory.pointer(entities + 312)
        spawns = []
        for i in range(spawns_count):
            s = memory.read(spawns_pointer + i * 40, 40)
            strings = struct.unpack_from('<3I', s, 4)
            spawns.append({'name': memory.string(context['strings'] + strings[0]), 'target': memory.string(context['strings'] + strings[1]), 'noteworthy': memory.string(context['strings'] + strings[2]), 'origin': list(struct.unpack_from('<3f', s, 16)), 'angles': list(struct.unpack_from('<3f', s, 28))})
        if not spawns:
            for entity in records:
                if entity.get('targetname') == 'default_player_start':
                    spawns.append({'name': entity.get('model'), 'origin': [float(v) for v in entity['origin'].split()], 'angles': [float(v) for v in entity.get('angles','0 0 0').split()]})
        for asset in assets(memory, context['pools'], 49):
            if asset['temporary']:
                continue
            name_ptr, compressed, size, bytecode_size, buffer, bytecode = memory.unpack('<Qiii4xQQ', asset['header'])
            name = memory.string(name_ptr)
            filename = tokens.get(int(name), name) if name.isdecimal() else name
            if not filename.startswith('scripts/') or '..' in Path(filename).parts:
                filename = 'unresolved/' + key(name)
            target = PRIVATE / 'native/scripts' / (filename + '.gscbin')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(name.encode('utf8') + b'\0' + struct.pack('<III', compressed, size, bytecode_size) + memory.read(buffer, compressed) + memory.read(bytecode, bytecode_size))
        manifest = {'version': 1, 'map': 'spaceland', 'title': 'Zombies in Spaceland', 'source': 'IW7 cp_zmb (owned local installation)', 'textureLimit': args.texture_size,
                    'world': world, 'static': static, 'models': {key(v['name']): v for v in exporter.models.values()}, 'materials': {key(v['name']): v for v in exporter.materials.values()}, 'spawns': spawns}
        (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf8')
        (PRIVATE / 'extraction-report.json').write_text(json.dumps({'textureFailures': exporter.failures, 'world': world, 'staticInstances': len(static), 'uniqueModels': len(exporter.models), 'materials': len(exporter.materials), 'images': len(exporter.images), 'spawns': spawns}, indent=2), encoding='utf8')
        print(f'Spaceland render import: {world["vertices"]} vertices, {world["indices"] // 3} triangles, {len(static)} static models, {len(exporter.images)} images; {len(exporter.failures)} texture failures.')
    finally:
        memory.close()


if __name__ == '__main__':
    main()
