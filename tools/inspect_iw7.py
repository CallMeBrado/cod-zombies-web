"""Inventory installed Spaceland assets loaded by Cordycep; output stays on E:."""
import argparse
import json
from iw7_memory import Memory, state, assets, ROOT

parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True, help='PID of the local Cordycep.CLI.exe loader')
args = parser.parse_args()
context = state()
memory = Memory(args.pid)
try:
    inventory = {}
    for kind in range(80):
        rows = []
        for asset in assets(memory, context['pools'], kind):
            name_offset = 104 if kind == 18 else 0
            try:
                name = memory.string(memory.pointer(asset['header'] + name_offset))
            except (OSError, ValueError):
                name = ''
            rows.append({**asset, 'name': name})
        if rows:
            inventory[str(kind)] = rows
    output = ROOT / 'local-data/iw7-spaceland'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'inventory.json').write_text(json.dumps({'source': context['directory'], 'pools': inventory}, indent=2), encoding='utf8')
    for kind, rows in inventory.items():
        print(kind, len(rows), 'loaded,', sum(not row['temporary'] for row in rows), 'resolved:', ', '.join(row['name'] for row in rows[:4]))
finally:
    memory.close()
