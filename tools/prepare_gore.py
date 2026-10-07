"""Prepare owned native gore models and blood textures for every playable map."""
from pathlib import Path
import json
import struct
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'

def head_sound(folder, zones):
    """Decode T5's owned loaded WMA head-gib samples without a full re-export."""
    manifest_path = DATA / folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    alias = next((DATA / z / 'web-sounds/zmb_zombie_head_gib.json' for z in zones
                  if (DATA / z / 'web-sounds/zmb_zombie_head_gib.json').exists()), None)
    if not alias:
        return None
    entries = []
    for index, entry in enumerate(json.loads(alias.read_text())):
        filename = entry['file'].replace('\\', '/').lstrip(',/')
        meta = next((DATA / z / 'web-audio' / (filename + '.json') for z in zones
                     if (DATA / z / 'web-audio' / (filename + '.json')).exists()), None)
        if not meta:
            continue
        info = json.loads(meta.read_text())
        if info['format'] != 7:
            continue
        output = DATA / folder / 'sounds' / ('gore_head_%d.wav' % index)
        output.parent.mkdir(parents=True, exist_ok=True)
        if not output.exists():
            raw = meta.with_suffix('.bin').read_bytes()
            temporary = ROOT / '.cache/gore-head-audio.xwma'
            temporary.parent.mkdir(parents=True, exist_ok=True)
            decoded = False
            for align in ([4096,2230,2048,1487,1024] if info['channels'] == 2 else [2230,1487,2048,4096,1024]):
                if len(raw) % align:
                    continue
                fmt = struct.pack('<HHIIHH', 0x161, info['channels'], info['rate'], 12000 if info['channels'] == 2 else 6000, align, 16)
                body = b'XWMAfmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(raw)) + raw
                temporary.write_bytes(b'RIFF' + struct.pack('<I', len(body)) + body)
                result = subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(temporary),'-c:a','pcm_s16le',str(output)], capture_output=True)
                if result.returncode == 0 and not result.stderr and output.exists():
                    with wave.open(str(output)) as audio:
                        decoded = abs(audio.getnframes() - info['frames']) <= 2048
                    if decoded:
                        break
            if not decoded:
                output.unlink(missing_ok=True)
                continue
        entries.append(dict(entry, url='/data/' + output.relative_to(DATA).as_posix()))
    if not entries:
        return None
    manifest['sounds']['zombie_head_gib'] = entries
    updated = json.dumps(manifest, separators=(',', ':'))
    if manifest_path.read_text() != updated:
        manifest_path.write_text(updated)
    return 'zombie_head_gib'

def prepare():
    for folder, zones, black_ops in [
        ('gameplay', ['nacht', 'common'], False),
        ('gameplay/der-riese', ['der-riese', 'common', 'nacht'], False),
        ('gameplay/verruckt', ['verruckt-patch', 'verruckt', 'common', 'nacht'], False),
        ('gameplay/bo1-kino', ['bo1-kino', 'bo1-common', 'bo1-base'], True),
        ('gameplay/bo1-cosmodrome', ['bo1-cosmodrome-patch', 'bo1-cosmodrome', 'bo1-common', 'bo1-base'], True),
        ('gameplay/bo1-coast', ['bo1-coast-patch','bo1-coast','bo1-common','bo1-base'], True),
    ]:
        target = DATA / folder / 'presentation.json'
        if not target.exists():
            continue
        presentation = json.loads(target.read_text())
        def texture(material):
            for zone in zones:
                source = DATA / zone / 'materials' / (material + '.json')
                if not source.exists():
                    continue
                definition = json.loads(source.read_text())
                image = next(t['image'].lstrip(',') for t in definition['textures'] if t['semantic'] == 'colorMap')
                for image_zone in zones:
                    path = DATA / image_zone / 'images' / (image + '.dds')
                    if path.exists():
                        return '/data/' + path.relative_to(DATA).as_posix()
            raise FileNotFoundError('Original blood texture unavailable: ' + material)
        # The map zombie body's own beheaded variant (Ascension's Spetsnaz), else
        # the honour guard's.
        fallback = 'char_ger_honorgd_body1_g_behead' if black_ops else 'char_ger_honorgd_zomb_behead'
        candidates = [presentation.get('actors', {}).get('body', '') + '_g_behead', fallback]
        model = next((m for m in candidates if any((DATA / z / 'model_export' / (m + '_lod0.glb')).exists() for z in zones)), None)
        if not model:
            raise FileNotFoundError('Original severed-neck model unavailable: ' + fallback)
        presentation['gore'] = dict(
            neckModel=model, neckMount='body' if black_ops else 'j_spine4',
            headSound=head_sound(folder, zones) if black_ops else 'zombie_head_gib',
            burst=texture('gfx_fxt_bio_bloodburst'), drops=texture('gfx_fxt_bio_blooddrops'),
            decals=[texture('wc/gfx_impact_blood_spatter%02d' % n) for n in (1, 2, 3)],
        )
        updated = json.dumps(presentation, separators=(',', ':'))
        if target.read_text() != updated:
            target.write_text(updated)
        print('Prepared native gore: ' + folder)

if __name__ == '__main__':
    prepare()
