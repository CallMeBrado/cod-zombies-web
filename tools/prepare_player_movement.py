"""Add the installed T5 dive clips to existing weapon metadata without re-extraction."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def prepare():
    path = ROOT / 'local-data/gameplay/bo1-kino/manifest.json'
    if not path.exists():
        return
    manifest = json.loads(path.read_text())
    previous = json.dumps(manifest, separators=(',', ':'))
    clips = set()
    for weapon in manifest['weapons'].values():
        for phase in ['in', 'loop', 'out']:
            for empty in [False, True]:
                source = 'dtp_' + ('empty_' if empty else '') + phase
                name = weapon.get(source, '')
                weapon['dtp' + phase.title() + ('Empty' if empty else '') + 'Anim'] = name
                if name:
                    if not any((ROOT / 'local-data' / zone / 'web-anims' / (name + '.json')).exists()
                               for zone in ['bo1-kino', 'bo1-common', 'bo1-base']):
                        raise RuntimeError('Missing native dive clip: ' + name)
                    clips.add(name)
    prepared = json.dumps(manifest, separators=(',', ':'))
    if prepared != previous:
        path.write_text(prepared)
    print(f'Prepared {len(clips)} original Black Ops dive clips for {len(manifest["weapons"])} weapons on E:')


if __name__ == '__main__':
    prepare()
