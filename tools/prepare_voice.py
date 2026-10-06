"""Character voice lines (player vox) for Kino der Toten.

The four playable characters' lines are vox_plr_<n>_<line>_<variant> aliases
(n: 0 Dempsey, 1 Nikolai, 2 Takeo, 3 Richtofen) streamed from the localized
IWDs. They are encoded to mono Opus and kept in the manifest's `voice` table,
separate from `sounds`, so the browser decodes a line only when it is spoken.
Run after prepare_bo1.py (which calls this module itself).
"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops')


def archive_index():
    index = {}
    for archive in sorted((GAME / 'main').glob('*.iwd')):
        with ZipFile(archive) as z:
            for name in z.namelist():
                index[name.casefold()] = (archive, name)  # Later IWDs override earlier ones.
    return index


def encode(job):
    raw, target = job
    with tempfile.NamedTemporaryFile(suffix='.boa', delete=False) as handle:
        handle.write(raw)
        source = handle.name
    try:
        result = subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-i', source, '-ac', '1',
                                 '-c:a', 'libopus', '-b:a', '32k', str(target)], capture_output=True)
        return result.returncode == 0 and target.exists() and target.stat().st_size > 100
    finally:
        Path(source).unlink(missing_ok=True)


def prepare_kino(manifest_path=DATA / 'gameplay/bo1-kino/manifest.json', sounds=DATA / 'bo1-english/web-sounds'):
    output = manifest_path.parent / 'voice'
    output.mkdir(exist_ok=True)
    index, jobs, voice = None, [], {}
    for path in sorted(sounds.glob('vox_plr_[0-3]_*.json')):
        alias, entry = path.stem, json.loads(path.read_text())[0]
        target = output / (alias + '.ogg')
        if not (target.exists() and target.stat().st_size > 100):
            index = index or archive_index()
            name = entry['file'].replace('\\', '/').lstrip(',/')
            where = index.get(name.casefold()) or index.get(('sound/' + name).casefold())
            if not where:
                continue
            with ZipFile(where[0]) as z:
                jobs.append((z.read(where[1]), target))
        voice[alias] = [{'url': '/data/' + target.relative_to(DATA).as_posix(), 'volume': entry['volume'], 'pitch': entry['pitch']}]
    with ThreadPoolExecutor(8) as pool:
        failed = [target for (raw, target), ok in zip(jobs, pool.map(encode, jobs)) if not ok]
    for target in failed:
        voice.pop(target.stem, None)
    manifest = json.loads(manifest_path.read_text())
    manifest['voice'] = voice
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':')))
    size = sum(p.stat().st_size for p in output.glob('*.ogg'))
    print(f'Prepared {len(voice)} Kino voice lines ({len(jobs)} encoded, {len(failed)} failed), {size / 1e6:.1f} MB')
    return voice


if __name__ == '__main__':
    prepare_kino()
