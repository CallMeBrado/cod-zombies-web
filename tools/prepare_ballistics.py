"""Refresh combat fields from the owned games without re-extracting maps/audio."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
FIELDS = ['weaponType', 'weaponClass', 'penetrateType', 'rifleBullet', 'maxRange',
          'damage', 'minDamage', 'maxDamageRange', 'minDamageRange', 'locHead',
          'locTorsoUpper', 'shotCount', 'adsSpread', 'hipSpreadStandMin',
          'hipSpreadMax', 'hipSpreadFireAdd', 'hipSpreadMoveAdd']
for folder, zones in [('gameplay', ['nacht', 'common']),
                      ('gameplay/der-riese', ['der-riese', 'common', 'nacht']),
                      ('gameplay/verruckt', ['verruckt-patch', 'verruckt', 'common', 'nacht']),
                      ('gameplay/bo1-kino', ['bo1-kino', 'bo1-common', 'bo1-base'])]:
    file = DATA / folder / 'manifest.json'
    if not file.exists():
        continue
    manifest = json.loads(file.read_text())
    for name, definition in manifest['weapons'].items():
        native = next((DATA / zone / 'weapons' / name for zone in zones
                       if (DATA / zone / 'weapons' / name).exists()), None)
        if native is None:
            raise RuntimeError('Missing original combat definition: ' + name)
        values = native.read_text().split('\\')
        properties = dict(zip(values[1::2], values[2::2]))
        for field in FIELDS:
            if field in properties:
                value = properties[field]
                definition[field] = float(value) if re.fullmatch(r'-?\d+(?:\.\d*)?', value) else value
    file.write_text(json.dumps(manifest, separators=(',', ':')))
    print('Updated original combat fields: ' + folder, flush=True)
