"""Prepare owned BO1 dive foley, shared exertions and character body dependencies on E:."""
from concurrent.futures import ThreadPoolExecutor
import json
import hashlib
from pathlib import Path
import re
import subprocess
import struct
import tempfile
import wave
from zipfile import ZipFile
from bo1_maps import BO1_MAPS

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops')


def prepare():
    for m in BO1_MAPS.values():
        prepare_map(m)


def prepare_map(m):
    path = DATA / m['data'] / 'manifest.json'
    ZONES = [m['zone'], 'bo1-common', m['english'], 'bo1-base']
    if not path.exists():
        return
    manifest = json.loads(path.read_text())
    previous = json.dumps(manifest, separators=(',', ':'))
    output = path.parent / 'dive-sounds'
    output.mkdir(exist_ok=True)
    scratch = ROOT / '.cache/dive-audio'
    scratch.mkdir(parents=True, exist_ok=True)
    aliases = {}
    for zone in ZONES:
        for p in (DATA / zone / 'web-sounds').glob('fly_dtp_*plr*.json'):
            aliases.setdefault(p.stem, json.loads(p.read_text()))
    archives = {}
    for archive in sorted((GAME / 'main').glob('*.iwd')):
        with ZipFile(archive) as z:
            for name in z.namelist():
                archives[name.casefold()] = (archive, name)
    # The shared stock player mappings resolve to these nonverbal takes. This
    # does not assert a separate Zombies-character-specific recording bank.
    for event, folder in [('launch', 'jump'), ('land', 'land')]:
        pattern = re.compile(r'english/sound/vox/dds/us/exert/carter/' + folder + '/' + event + r'_exert_\d+\.wav$', re.I)
        entries = [{'file': name, 'pitch': 1, 'volume': 1} for name in sorted(archives) if pattern.search(name)]
        if not entries:
            raise RuntimeError('Missing original ' + event + ' exertions')
        aliases['chr_' + event + '_exert_plr'] = entries
        aliases['chr_' + event + '_exert_npc'] = entries
    jobs = {}
    for alias, entries in aliases.items():
        for index, entry in enumerate(entries):
            filename = entry['file'].replace('\\', '/').lstrip(',/').casefold()
            target = output / (hashlib.sha256(filename.encode()).hexdigest()[:16] + '.wav')
            where = archives.get(filename) or archives.get('sound/' + filename)
            meta = next((DATA / z / 'web-audio' / (filename + '.json') for z in ZONES
                         if (DATA / z / 'web-audio' / (filename + '.json')).exists()), None)
            if not where and not meta:
                raise RuntimeError('Missing dive audio source: ' + filename)
            entry['url'] = '/data/' + target.relative_to(DATA).as_posix()
            if not (target.exists() and target.stat().st_size > 100):
                jobs[target] = (where, meta, target)

    def encode(job):
        where, meta, target = job
        if where:
            with ZipFile(where[0]) as z:
                raw = z.read(where[1])
        else:
            raw = meta.with_suffix('.bin').read_bytes()
        with tempfile.TemporaryDirectory(dir=scratch) as temporary:
            source = Path(temporary) / 'source.boa'
            def decode(data, extra=()):
                source.write_bytes(data)
                return subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', *extra, '-i', str(source),
                                       '-ac', '1', '-c:a', 'pcm_s16le', str(target)], capture_output=True)
            if where:
                result = decode(raw)
            else:
                m = json.loads(meta.read_text())
                result = None
                if m['format'] == 7:
                    for align in [4096, 2230, 2048, 1487, 1024]:
                        if len(raw) % align:
                            continue
                        fmt = struct.pack('<HHIIHH', 0x161, m['channels'], m['rate'], 6000 * m['channels'], align, 16)
                        body = b'XWMA' + b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(raw)) + raw
                        candidate = decode(b'RIFF' + struct.pack('<I', len(body)) + body)
                        if candidate.returncode == 0 and not candidate.stderr and target.exists():
                            with wave.open(str(target)) as wav:
                                if abs(wav.getnframes() - m['frames']) <= 2048:
                                    result = candidate
                                    break
                elif m['format'] == 6:
                    header = bytearray(2096)
                    struct.pack_into('<IIIII', header, 0, 1, m['frames'], m['rate'], m['channels'], 2096)
                    struct.pack_into('<I', header, 21, m['blockSize'] >> 8)
                    result = decode(header + raw, ['-f', 'boa'])
        if not result or result.returncode or not target.exists() or target.stat().st_size < 100:
            raise RuntimeError('Dive audio decode failed: ' + str(where[1] if where else meta))

    with ThreadPoolExecutor(6) as pool:
        list(pool.map(encode, jobs.values()))
    manifest['sounds'].update(aliases)
    manifest['diveAudio'] = {'profiles': {'shared': {'launch': 'chr_launch_exert_plr', 'landing': 'chr_land_exert_plr',
                                                   'remoteLaunch': 'chr_launch_exert_npc', 'remoteLanding': 'chr_land_exert_npc'}},
                             'provenance': 'Stock BO1 shared exertion and dive-to-prone foley recordings; no unique character bank inferred.'}
    manifest['playerBodies'] = [dict(character) for character in m['bodies']]
    for character in manifest['playerBodies']:
        for key in ['body', 'head', 'hat']:
            if key in character and not any((DATA / z / 'model_export' / (character[key] + '_lod0.glb')).exists() for z in m['search']):
                raise RuntimeError('Missing character model: ' + character[key])
    prepared = json.dumps(manifest, separators=(',', ':'))
    if prepared != previous:
        path.write_text(prepared)
    print(f'Prepared {len(aliases)} original dive sound aliases ({len(jobs)} decoded) and four character bodies on E:')


if __name__ == '__main__':
    prepare()
