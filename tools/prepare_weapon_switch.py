"""Weapon switch (put away / draw) animations, timings and sounds from the WEAPONFILEs.

prepare_gameplay.py and prepare_der_riese.py include these fields for new
extractions; running this module patches already prepared manifests in place.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
SWITCH_FIELDS = ['dropAnim', 'firstRaiseAnim', 'emptyDropAnim', 'emptyRaiseAnim',
                 'dropTime', 'raiseTime', 'firstRaiseTime', 'emptyDropTime', 'emptyRaiseTime',
                 'raiseSoundPlayer', 'firstRaiseSoundPlayer', 'putawaySoundPlayer']


def weapon_props(path):
    values = path.read_text().split('\\')
    return dict(zip(values[1::2], values[2::2]))


def patch(manifest_path, weapon_dir, output, search):
    from prepare_der_riese import convert_sounds
    manifest = json.loads(manifest_path.read_text())
    for name, weapon in manifest['weapons'].items():
        props = weapon_props(weapon_dir / name)
        for key in SWITCH_FIELDS:
            value = props.get(key, '')
            weapon[key] = float(value) if re.fullmatch(r'-?\d+(?:\.\d*)?', value) else value
    aliases = {w[k] for w in manifest['weapons'].values() for k in ['raiseSoundPlayer', 'firstRaiseSoundPlayer', 'putawaySoundPlayer'] if w[k]}
    convert_sounds(aliases - set(manifest['sounds']), manifest['sounds'], output, search)
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':')))
    return len(manifest['weapons']), sorted(aliases)


if __name__ == '__main__':
    print(patch(DATA/'gameplay/manifest.json', DATA/'nacht/weapons', DATA/'gameplay', ['nacht', 'common']))
    print(patch(DATA/'gameplay/der-riese/manifest.json', DATA/'der-riese/weapons', DATA/'gameplay/der-riese', ['der-riese', 'common', 'nacht']))
    print(patch(DATA/'gameplay/verruckt/manifest.json', DATA/'verruckt/weapons', DATA/'gameplay/verruckt', ['verruckt-patch', 'verruckt', 'common', 'nacht']))
