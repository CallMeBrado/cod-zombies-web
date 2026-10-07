"""Prepare World at War's Verrückt (nazi_zombie_asylum) on E:, building on
Nacht's prepared gameplay data like Der Riese. Run tools/extract_verruckt.py
first."""
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile
from inspect_game import parse_entities
import prepare_der_riese as riese
from prepare_fidelity import animation

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
GAME = riese.GAME
ZONE = DATA / 'verruckt'
OUTPUT = DATA / 'gameplay/verruckt'
SEARCH = ['verruckt-patch', 'verruckt', 'common', 'nacht']
ASSET = 'nazi_zombie_asylum'
# include_weapons(): the hitscan guns the WaW runtime fires. The Ray Gun,
# Panzerschreck, flamethrower, rifle grenades, molotovs and Bouncing Betties
# need projectile and equipment support first.
WEAPONS = ['zombie_colt', 'sw_357', 'm1carbine', 'm1garand', 'gewehr43', 'stg44', 'thompson', 'mp40', 'ppsh', 'kar98k',
           'springfield', 'ptrs41_zombie', 'doublebarrel', 'doublebarrel_sawed_grip', 'shotgun', 'fg42_bipod', 'mg42_bipod', '30cal_bipod', 'bar', 'bar_bipod']
LABELS = {'zombie_colt': 'Colt M1911', 'sw_357': '.357 Magnum', 'm1carbine': 'M1A1 Carbine', 'm1garand': 'M1 Garand', 'gewehr43': 'Gewehr 43',
          'stg44': 'STG-44', 'thompson': 'Thompson', 'mp40': 'MP40', 'ppsh': 'PPSh-41', 'kar98k': 'Kar98k', 'springfield': 'Springfield',
          'ptrs41_zombie': 'PTRS-41', 'doublebarrel': 'Double-Barreled Shotgun', 'doublebarrel_sawed_grip': 'Sawed-Off Shotgun', 'shotgun': 'M1897 Trench Gun',
          'fg42_bipod': 'FG42', 'mg42_bipod': 'MG42', '30cal_bipod': 'Browning M1919', 'bar': 'BAR', 'bar_bipod': 'BAR'}
WALL_ONLY = {'kar98k', 'gewehr43', 'm1garand', 'springfield', 'thompson', 'mp40', 'stg44', 'doublebarrel', 'doublebarrel_sawed_grip', 'shotgun', 'bar_bipod'}


def find(relative):
    return next((DATA / z / relative for z in SEARCH if (DATA / z / relative).is_file()), None)


def weapon(name, fields):
    values = find('weapons/' + name).read_text().split('\\')
    props = dict(zip(values[1::2], values[2::2]))
    return {key: float(props[key]) if re.fullmatch(r'-?\d+(?:\.\d*)?', props.get(key, '')) else props.get(key, '') for key in fields}


def prepare():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    original = json.loads((DATA / 'gameplay/manifest.json').read_text())
    entities = parse_entities(ZONE / 'maps' / (ASSET + '.d3dbsp.ents'))
    world = json.loads((ZONE / 'web-world' / (ASSET + '.json')).read_text())
    fields = list(original['weapons']['zombie_colt'])
    weapons = {name: weapon(name, fields) for name in WEAPONS if find('weapons/' + name)}
    script = find('maps/_zombiemode_weapons.gsc').read_text()
    costs = {name: int(price) for name, price in re.findall(r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,[^,\n]+,\s*(\d+)', script)}
    for e in entities:
        if e.get('targetname') == 'weapon_upgrade':
            e['zombie_cost'] = str(costs.get(e.get('zombie_weapon_upgrade'), 250))
            e['script_ammo_clip'] = str(int(e['zombie_cost']) // 2)
    for e in entities:
        if e.get('targetname') == 'use_master_switch': e.update(nativeTargetname='use_master_switch', targetname='use_power_switch')
    variables = dict(original['variables'])
    variables.update({k: float(v) for k, v in re.findall(r'set_zombie_var\(\s*"([^"\n]+)"\s*,\s*([\d.]+)', find('maps/_zombiemode.gsc').read_text())})

    # Textures referenced by the world, models and weapons, recovered from the IWDs.
    wanted = {(m.get(k) or '').lstrip(',') for m in world['materials'].values() for k in ['diffuse', 'normal']}
    models = {m['model'] for m in world['staticModels']} | {e.get('model') for e in entities if e.get('classname') == 'script_model'}
    models |= {w.get(k) for w in weapons.values() for k in ['gunModel', 'worldModel', 'knifeModel']} | {'viewmodel_hands'}
    for name in models:
        source = name and find(f'model_export/{name}_lod0.glb')
        if not source: continue
        buffer = source.read_bytes(); length = int.from_bytes(buffer[12:16], 'little')
        gltf = json.loads(buffer[20:20 + length])
        wanted.update(Path(i['uri']).stem.lstrip(',') for i in gltf.get('images', []) if i.get('uri', '').endswith('.dds'))
    wanted = {n for n in wanted if n and '$identity' not in n and not find(f'images/{n}.dds')}
    art = ['loadscreen_zombie_asylum', 'menu_zombie_asylum', 'specialty_juggernaut_zombies', 'specialty_fastreload_zombies', 'specialty_doubletap_zombies', 'specialty_quickrevive_zombies']
    sources = {}
    for archive in sorted((GAME / 'main').glob('*.iwd')):
        with ZipFile(archive) as bundle:
            lookup = {n.casefold(): n for n in bundle.namelist()}
            for name in wanted | set(art):
                member = lookup.get(('images/' + name + '.iwi').casefold())
                if member: sources[name] = (archive, member)
    for name, (archive, member) in sources.items():
        raw = ZONE / 'images' / (name + '.iwi')
        with ZipFile(archive) as bundle: raw.write_bytes(bundle.read(member))
        subprocess.run([str(ROOT / '.tools/oat/ImageConverter.exe'), '--no-color', str(raw)], check=True, stdout=subprocess.DEVNULL)
    hud = DATA / 'gameplay/hud'
    for name in art:
        image = find('images/' + name + '.dds')
        if image: subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-i', str(image), '-frames:v', '1', str(hud / (name + '.png'))], check=True)

    # Sounds: Nacht's set plus Verrückt's own weapons, perks, PA and zombies.
    sounds = dict(original['sounds'])
    aliases = {w.get(k) for w in weapons.values() for k in ['fireSound', 'reloadSound', 'fireSoundPlayer', 'reloadSoundPlayer', 'emptyFireSoundPlayer', 'meleeSwipeSoundPlayer', 'raiseSoundPlayer', 'putawaySoundPlayer']}
    aliases.update(line.split()[-1] for w in weapons.values() for line in w.get('notetrackSoundMap', '').splitlines() if line.split())
    aliases.update(['amb_vocals', 'sprint_vocals', 'attack_vocals', 'attack_whoosh', 'step_zombie', 'step_sweetner', 'crawl_vocals', 'crawl_vocals_slow',
                    'mx_game_over', 'switch_flip', 'electrical_surge', 'mx_jugger_jingle', 'mx_speed_jingle', 'mx_doubletap_jingle', 'mx_revive_jingle',
                    # Stone barriers, the moving box, the power and the electric traps.
                    'break_stone', 'rebuild_barrier_piece', 'box_move', 'box_poof', 'couch_slam', 'whoosh', 'ann_vox_magicbox', 'laugh_child',
                    'elec_start', 'elec_loop', 'elec_arc', 'elec_vocals', 'zombie_arc', 'exp_jib_zombie', 'ignite', 'warning', 'purchase',
                    'door_slide_open', 'door_deny', 'amb_sparks_l', 'amb_sparks_r', 'amb_sparks_l_b', 'amb_sparks_r_b', 'amb_sparks_l_end', 'amb_sparks_r_end',
                    'alarm', 'comp_start', 'elec_current_loop', 'the_numbers', 'perks_power_on', 'perks_rattle', 'mx_splash_screen', 'round_over', 'mx_zombie_wave_1'])
    aliases.update(p.stem for z in ['verruckt', 'verruckt-patch'] if (DATA / z / 'web-sounds').exists() for p in (DATA / z / 'web-sounds').glob('*.json')
                   if re.match(r'(zapper|elec|pa_|mx_|amb_|door|perks|bottle|zmb_|asylum|announcer|radio|toilet|chair|bounce|betty)', p.stem))
    riese.convert_sounds({a for a in aliases if a}, sounds, output=OUTPUT, search=SEARCH)

    # ----- the map's spawning and window rules (nazi_zombie_asylum.gsc) -----
    collision = json.loads((ZONE / 'web-world' / (ASSET + '.collision.json')).read_text())
    point = lambda e: list(map(float, e['origin'].split()))
    def hulls(e):
        origin = point(e); model = collision['models'][int(e['model'][1:])]; out = []
        for index in model['brushes']:
            b = collision['brushes'][index]
            out.append({'mins': [v + origin[k] for k, v in enumerate(b['mins'])], 'maxs': [v + origin[k] for k, v in enumerate(b['maxs'])],
                        'planes': [[*q[:3], q[3] + sum(q[k] * origin[k] for k in range(3))] for q in b['planes']]})
        return out
    by_name = lambda name: next((e for e in entities if e.get('targetname') == name), None)
    spawner_groups = {e['targetname'] for e in entities if e.get('classname', '').startswith('actor_') and e.get('targetname')}
    # add_new_zombie_spawners(): a bought door adds the spawners of its first
    # door brush (self.door = targets[0]: target and script_string); debris
    # adds those of every junk piece.
    door_spawners = {}
    for trigger in (e for e in entities if e.get('targetname') in ('zombie_door', 'zombie_debris')):
        parts = [e for e in entities if e.get('targetname') == trigger['target']]
        if trigger['targetname'] == 'zombie_door': parts = parts[:1]
        groups = door_spawners.setdefault(trigger['target'], set())
        for part in parts:
            groups.update(g for g in (part.get('target'), part.get('script_string')) if g in spawner_groups)
    # manage_zone(): while a player is inside a volume, its spawners join and
    # its "<volume>_goal" windows open (the upstairs volumes also count their
    # magic-box room once its doors are bought).
    zones = []
    for name, extra, flags in [('north_upstairs_volume', 'magic_room_north_volume', ['upstairs_north_door1', 'upstairs_north_door2', 'magic_box_north']),
                               ('south_upstairs_volume', 'magic_room_south_volume', ['magic_box_south', 'south_access_1']),
                               ('south_spawners', None, []), ('south_west_upper_corner', None, []), ('north_spawners', None, [])]:
        volume = by_name(name)
        if not volume: continue
        zone = {'name': name, 'spawners': volume.get('target') if volume.get('target') in spawner_groups else None, 'hulls': hulls(volume)}
        if extra and by_name(extra): zone.update(extra={'hulls': hulls(by_name(extra)), 'flags': flags})
        zones.append(zone)
    # activate_goals_when_door_opened(): windows tagged with a door's
    # script_noteworthy stay off until the first such zombie_door's (or
    # zombie_debris's) flag is set.
    door_windows = {}
    for note in ['north_lower_door', 'south_upstairs_debris', 'magic_door']:
        for kind in ['zombie_door', 'zombie_debris']:
            first = next((e for e in entities if e.get('targetname') == kind and e.get('script_noteworthy') == note), None)
            if first and first.get('script_flag'): door_windows.setdefault(note, []).append(first['script_flag'])
    windows = {e['target']: {'noteworthy': e.get('script_noteworthy'), 'zone': e.get('script_string')} for e in entities if e.get('targetname') == 'exterior_goal'}
    # treasure_chest_init(): five locations, starting at "start_chest".
    chests = {e['script_noteworthy']: e['target'] for e in entities if e.get('targetname') == 'treasure_chest_use'}
    map_data = {'id': 'verruckt', 'title': 'Verrückt', 'initialSpawners': ['zombie_spawner_init'],
                'doorSpawners': {k: sorted(v) for k, v in door_spawners.items() if v}, 'doorWindows': door_windows,
                'windows': windows, 'zones': zones, 'riseSpots': [point(e) for e in entities if e.get('targetname') == 'zombie_rise'],
                'chests': chests, 'initialBox': chests.get('start_chest'), 'propModels': ['zombie_teddybear'],
                # init_elec_trap_trigs(): each lever's damage trigger_multiple.
                'trapHulls': {e['target']: hulls(t) for e in entities if e.get('targetname') == 'gas_access'
                              for t in entities if t.get('targetname') == e['target'] and t.get('classname') == 'trigger_multiple'},
                'boxWeapons': [n for n in weapons if n not in WALL_ONLY and n != 'zombie_colt']}
    manifest = {**original, 'variables': variables, 'weapons': weapons, 'weaponNames': {n: LABELS.get(n, n) for n in weapons},
                'entities': entities, 'sounds': sounds,
                'map': map_data}
    # Perk bottles and their sounds (Der Riese's helper, with this map's zone).
    riese.ZONE, riese.OUTPUT, riese.SEARCH = ZONE, OUTPUT, SEARCH
    # No Pack-a-Punch on Verrückt, so no knuckle crack.
    riese.GESTURES = {k: v for k, v in riese.GESTURES.items() if k != 'knuckle_crack'}
    riese.add_perk_assets(manifest)
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    # Verrückt's level.scr_anim gaits and melee sets (Der Riese's, plus walk v9
    # and sprints v4/v5) and level._zombie_rise_anims.
    presentation = json.loads((DATA / 'gameplay/presentation.json').read_text())
    for name in ['ai_zombie_walk_v6', 'ai_zombie_walk_v7', 'ai_zombie_walk_v8', 'ai_zombie_walk_v9', 'ai_zombie_run_v2', 'ai_zombie_run_v4',
                 'ai_zombie_sprint_v4', 'ai_zombie_sprint_v5', 'ai_zombie_attack_v4', 'ai_zombie_attack_v6',
                 'ai_zombie_walk_attack_v1', 'ai_zombie_walk_attack_v2', 'ai_zombie_walk_attack_v3', 'ai_zombie_run_attack_v1', 'ai_zombie_run_attack_v2', 'ai_zombie_run_attack_v3',
                 'ai_zombie_traverse_ground_v1_walk', 'ai_zombie_traverse_ground_v2_walk_altA', 'ai_zombie_traverse_ground_v1_run', 'ai_zombie_traverse_ground_climbout_fast']:
        zone = next((z for z in ['verruckt-patch', 'verruckt'] if (DATA / z / 'web-anims' / (name + '.json')).is_file()), None)
        if zone: presentation['animations'][name] = animation(zone, name)
    presentation['box'] = {**presentation.get('box', {}), 'teddyOpen': True}
    (OUTPUT / 'presentation.json').write_text(json.dumps(presentation, separators=(',', ':')))
    print(json.dumps({'entities': len(entities), 'weapons': len(weapons), 'texturesRecovered': len(sources), 'sounds': len(sounds),
                      'gestures': len(manifest['gestures'])}))


if __name__ == '__main__':
    prepare()
