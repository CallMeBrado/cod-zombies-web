"""Decode the installed IW7 BC6 sky cube for the browser's initial world test."""
import argparse
import json
import struct
import sys
from pathlib import Path
from PIL import Image
from iw7_memory import ROOT, Memory, state, assets
from extract_spaceland import OUTPUT, key, package_data

sys.path.insert(0, str(ROOT / '.tools/iw7-pydeps'))
import texture2ddecoder

parser = argparse.ArgumentParser()
parser.add_argument('--pid', required=True, type=int)
args = parser.parse_args()
context = state()
memory = Memory(args.pid)
try:
    pointer = next(a['header'] for a in assets(memory, context['pools'], 18) if not a['temporary'] and memory.string(memory.pointer(a['header'] + 104)) == 'sky_cp_zmb_night_01')
    h = memory.read(pointer, 112)
    if h[24] != 95 or h[32] != 5 or h[57] != 1:
        raise ValueError('Unexpected native Spaceland sky layout')
    levels = [(i, *struct.unpack_from('<HH', h, offset)) for i, offset in enumerate((72, 80, 88, 96))]
    choices = [v for v in levels if 0 < max(v[1:]) <= 512]
    level, width, height = max(choices, key=lambda v: v[1] * v[2]) if choices else min((v for v in levels if v[1] and v[2]), key=lambda v: v[1] * v[2])
    start, end, package = memory.unpack('<QQH', pointer + 112 + level * 24)
    data = package_data(Path(context['directory']) / f'imagefile{package}.pak', start, end)
    size = ((width + 3) // 4) * ((height + 3) // 4) * 16
    if len(data) < size * 6:
        raise ValueError('Incomplete native sky cube')
    faces = []
    for i in range(6):
        rgba = texture2ddecoder.decode_bc6(data[i * size:(i + 1) * size], width, height)
        filename = f'textures/sky-{i}.png'
        image = Image.frombytes('RGBA', (width, height), rgba, 'raw', 'BGRA')
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        image.save(OUTPUT / filename)
        faces.append({'url': filename, 'bytes': (OUTPUT / filename).stat().st_size})
    manifest = json.loads((OUTPUT / 'manifest.json').read_text(encoding='utf8'))
    manifest['sky'] = faces
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf8')
    print(f'Spaceland native sky: six {width}x{height} BC6 faces decoded.')
finally:
    memory.close()
