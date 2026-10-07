"""Recover BO1's actual knife charge animation/range/timing for shared melee."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
FIELDS = ['meleeAnim', 'meleeChargeAnim', 'meleeDamage', 'meleeDelay', 'meleeChargeDelay', 'meleeTime', 'meleeChargeTime', 'meleeChargeRange']

def prepare():
    from bo1_maps import BO1_MAPS
    for m in BO1_MAPS.values():
        prepare_map(DATA / m['data'] / 'manifest.json')

def prepare_map(target):
    if not target.exists():
        return
    source = next(DATA / z / 'weapons/knife_zm' for z in ['bo1-common', 'bo1-kino', 'bo1-base'] if (DATA / z / 'weapons/knife_zm').exists())
    tokens = source.read_text().split('\\')
    native = dict(zip(tokens[1::2], tokens[2::2]))
    manifest = json.loads(target.read_text())
    for weapon in manifest['weapons'].values():
        for field in FIELDS:
            value = native[field]
            weapon[field] = value if field.endswith('Anim') else float(value)
    updated = json.dumps(manifest, separators=(',', ':'))
    if target.read_text() != updated:
        target.write_text(updated)
    print('Prepared native BO1 knife charge: %d weapons, %s units, %ss impact delay' % (len(manifest['weapons']), native['meleeChargeRange'], native['meleeChargeDelay']))

if __name__ == '__main__':
    prepare()
