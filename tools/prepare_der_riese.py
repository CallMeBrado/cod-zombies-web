"""Prepare Der Riese and original lobby artwork; keep all output on E:."""
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile
from inspect_game import parse_entities

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty World at War')
ZONE = DATA / 'der-riese'
OUTPUT = DATA / 'gameplay/der-riese'
SEARCH = ['der-riese', 'common', 'nacht']


def find(relative):
    return next((DATA / z / relative for z in SEARCH if (DATA / z / relative).is_file()), None)


def weapon(name, fields):
    values = (ZONE / 'weapons' / name).read_text().split('\\')
    props = dict(zip(values[1::2], values[2::2]))
    return {key: float(props[key]) if re.fullmatch(r'-?\d+(?:\.\d*)?', props.get(key, ''))
            else props.get(key, '') for key in fields}


# _zombiemode_perks.gsc: the perk bottles and Pack-a-Punch knuckle crack are
# viewmodel-only "weapons" played between putting a gun away and raising it.
GESTURES = {'specialty_armorvest': 'zombie_perk_bottle_jugg', 'specialty_fastreload': 'zombie_perk_bottle_sleight',
            'specialty_rof': 'zombie_perk_bottle_doubletap', 'specialty_quickrevive': 'zombie_perk_bottle_revive',
            'knuckle_crack': 'zombie_knuckle_crack'}
GESTURE_FIELDS = ['gunModel', 'idleAnim', 'emptyIdleAnim', 'firstRaiseAnim', 'dropAnim', 'firstRaiseTime', 'dropTime', 'notetrackSoundMap']
PERK_SOUNDS = ['mx_jugger_sting', 'mx_speed_sting', 'mx_doubletap_sting', 'mx_revive_sting', 'mx_packa_sting',
               'bottle_dispense3d', 'perks_power_on', 'electrical_surge', 'broken_random_jingle',
               'packa_rollers_loop', 'packa_weap_upgrade', 'packa_weap_ready', 'ticktock_loop', 'packa_deny']
# nazi_zombie_factory_amb.csc PA system: teleporter link countdown, success and failure.
TELEPORTER_SOUNDS = ['pa_buzz', 'pa_audio_link_start', 'pa_audio_link_fail', 'clock_tick_1sec',
                     *[f'pa_audio_link_{n}' for n in (20, 15, *range(10, 0, -1))], *[f'pa_audio_act_pad_{i}' for i in range(3)]]
# _zombiemode_powerups.gsc special_drop_setup (teleporter drop) and the carpenter.
POWERUP_SOUNDS = ['pre_spawn', 'bolt', 'spawn', 'spawn_powerup', 'spawn_powerup_loop', 'sam_nospawn', 'carp_loop', 'carp_end', 'carp_vox', 'ma_vox', 'insta_vox', 'dp_vox', 'nuke_vox']
DER_RIESE_EFFECTS = ['maps/zombie/fx_zombie_dog_lightning_buildup', 'maps/zombie/fx_zombie_dog_lightning_spawn']
# _zombiemode_timer.gsc stopwatch shown during a teleporter link countdown.
HUD_IMAGES = ['zombie_stopwatch', 'zombie_stopwatchneedle', 'zombie_stopwatch_glass']


def convert_sounds(aliases, sounds, output=None, search=None):
    archives = sorted((GAME / 'main').glob('*.iwd'))
    search = search or SEARCH
    sound_folder = (output or OUTPUT)/'sounds';sound_folder.mkdir(parents=True, exist_ok=True)
    index = {}
    for archive in archives:
        with ZipFile(archive) as bundle:
            for name in bundle.namelist():
                if name.lower().startswith('sound/'): index[name.casefold()] = (archive,name)
    for alias in sorted(x for x in aliases if x):
        source = next((DATA/z/'web-sounds'/f'{alias}.json' for z in search if (DATA/z/'web-sounds'/f'{alias}.json').is_file()), None)
        if not source: continue
        available = []
        for i, entry in enumerate(json.loads(source.read_text())[:12 if alias.endswith(('_vocals','_whoosh')) or alias.startswith('step_') else 4]):
            file = entry['file'].replace('\\','/').lstrip(',/')
            loaded = next((candidate for z in search for candidate in [DATA/z/'sound'/file,(DATA/z/'sound'/file).with_suffix('.xwma')] if candidate.is_file()),None)
            location = index.get(('sound/'+file).casefold()) or index.get(file.casefold())
            if location:
                loaded = ROOT/'.cache'/('der-riese-audio'+Path(file).suffix)
                with ZipFile(location[0]) as bundle: loaded.write_bytes(bundle.read(location[1]))
            if not loaded: continue
            output = sound_folder/f'{alias}_{i}.wav'
            result = subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(loaded),'-c:a','pcm_s16le',str(output)],capture_output=True)
            if result.returncode:
                print(f'Skipped undecodable alias variant: {alias} #{i}')
                continue
            available.append({**entry,'url':'/data/'+output.relative_to(DATA).as_posix()})
        if available: sounds[alias] = available


def add_perk_assets(manifest):
    gestures = {key: {**weapon(name, GESTURE_FIELDS), 'name': name} for key, name in GESTURES.items()}
    aliases = set(PERK_SOUNDS) | set(TELEPORTER_SOUNDS) | set(POWERUP_SOUNDS)
    aliases.update(line.split()[-1] for g in gestures.values() for line in g['notetrackSoundMap'].splitlines() if line.split())
    convert_sounds(aliases - set(manifest['sounds']), manifest['sounds'])
    manifest['gestures'] = gestures


def add_presentation_assets(path):
    """Teleporter-drop lightning, the carpenter powerup model and stopwatch HUD art."""
    from prepare_fidelity import add_effects
    add_effects(path, 'der-riese', DER_RIESE_EFFECTS)
    presentation = json.loads(path.read_text())
    presentation['powerups']['carpenter'] = 'zombie_carpenter'
    path.write_text(json.dumps(presentation,separators=(',',':')))
    for name in HUD_IMAGES:
        subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(ZONE/'images'/(name+'.dds')),
                        '-frames:v','1',str(DATA/'gameplay/hud'/(name+'.png'))],check=True)


def patch_perk_assets():
    """Add gestures and perk sounds to an already prepared Der Riese manifest."""
    path = OUTPUT/'manifest.json'
    manifest = json.loads(path.read_text())
    add_perk_assets(manifest)
    path.write_text(json.dumps(manifest,separators=(',',':')))
    print(json.dumps({'gestures':len(manifest['gestures']),'sounds':len(manifest['sounds'])}))


def prepare():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    original = json.loads((DATA / 'gameplay/manifest.json').read_text())
    entities = parse_entities(ZONE / 'maps/nazi_zombie_factory.d3dbsp.ents')
    collision = json.loads((ZONE / 'web-world/nazi_zombie_factory.collision.json').read_text())
    world = json.loads((ZONE / 'web-world/nazi_zombie_factory.json').read_text())
    fields = list(original['weapons']['zombie_colt'])
    names = ['zombie_colt', 'zombie_kar98k', 'zombie_gewehr43', 'zombie_m1carbine',
             'zombie_m1garand', 'zombie_thompson', 'zombie_bar', 'zombie_doublebarrel',
             'zombie_shotgun', 'zombie_mp40', 'zombie_sw_357', 'zombie_stg44',
             'zombie_mg42', 'zombie_fg42', 'zombie_type100_smg', 'zombie_ppsh', 'zombie_30cal']
    weapons = {name: weapon(name, fields) for name in names}
    # The upgraded Colt is a grenade launcher and needs projectile weapon support.
    for name in names[1:]:
        upgraded = name + '_upgraded'
        if (ZONE / 'weapons' / upgraded).exists():
            weapons[upgraded] = weapon(upgraded, fields)
            weapons[name]['upgrade'] = upgraded
    script = (ZONE / 'maps/_zombiemode_weapons.gsc').read_text()
    costs = {name: int(price) for name, price in re.findall(
        r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,[^,\n]+,\s*(\d+)', script)}
    for e in entities:
        if e.get('targetname') == 'weapon_upgrade':
            e['zombie_cost'] = str(costs.get(e.get('zombie_weapon_upgrade'), 250))
            e['script_ammo_clip'] = str(int(e['zombie_cost']) // 2)
    volumes = []
    for e in entities:
        if e.get('script_noteworthy') != 'player_volume':
            continue
        origin = list(map(float, e['origin'].split()))
        model = collision['models'][int(e['model'][1:])]
        hulls = []
        for index in model['brushes']:
            b = collision['brushes'][index]
            hulls.append({'mins': [v + origin[k] for k, v in enumerate(b['mins'])],
                          'maxs': [v + origin[k] for k, v in enumerate(b['maxs'])],
                          'planes': [[*plane[:3], plane[3] + sum(plane[k] * origin[k] for k in range(3))]
                                     for plane in b['planes']]})
        volumes.append({'name': e['targetname'], 'spawners': e['target'], 'hulls': hulls})
    def zone_at(position):
        def score(volume):
            best = float('inf')
            for hull in volume['hulls']:
                outside = sum(max(hull['mins'][k] - position[k], 0, position[k] - hull['maxs'][k])**2 for k in range(3))
                if outside == 0 and all(sum(p[k]*position[k] for k in range(3)) <= p[3]+2 for p in hull['planes']):
                    return -1
                best = min(best, outside)
            return best
        return min(volumes, key=score)
    traverses = [e for e in entities if e.get('targetname') == 'traverse']
    def point(e): return list(map(float, e['origin'].split()))
    goals = {}
    for e in entities:
        if e.get('targetname') != 'exterior_goal':
            continue
        begin = min(traverses, key=lambda t: sum((a-b)**2 for a, b in zip(point(t), point(e))))
        end = next(x for x in entities if x.get('targetname') == begin['target'])
        volume = zone_at([point(end)[0], point(end)[1], point(end)[2]+25])
        zone = e.get('script_noteworthy', '').removesuffix('_barriers') or volume['name']
        group = next(v['spawners'] for v in volumes if v['name'] == zone)
        goals[e['target']] = {'zone': zone, 'spawners': group}
    connections = [['receiver_zone','outside_east_zone','enter_outside_east'],
                   ['receiver_zone','outside_west_zone','enter_outside_west'],
                   ['outside_east_zone','wnuen_zone','enter_wnuen_building'],
                   ['wnuen_zone','wnuen_bridge_zone','enter_wnuen_loading_dock'],
                   ['outside_west_zone','warehouse_bottom_zone','enter_warehouse_building'],
                   ['warehouse_bottom_zone','warehouse_top_zone','enter_warehouse_second_floor'],
                   ['warehouse_top_zone','bridge_zone','enter_warehouse_second_floor'],
                   ['wnuen_zone','tp_east_zone','enter_tp_east'],
                   ['warehouse_top_zone','tp_west_zone','enter_tp_west'],
                   ['outside_south_zone','tp_south_zone','enter_tp_south'],
                   ['receiver_zone','outside_south_zone','electricity_on'],
                   ['wnuen_bridge_zone','bridge_zone','electricity_on'],
                   ['warehouse_top_zone','bridge_zone','electricity_on']]
    # Recover every referenced map/model texture. Archives override earlier files.
    wanted = {(m.get(k) or '').lstrip(',') for m in world['materials'].values() for k in ['diffuse','normal']}
    models = {m['model'] for m in world['staticModels']} | {e.get('model') for e in entities if e.get('classname') == 'script_model'}
    models |= {w.get(k) for w in weapons.values() for k in ['gunModel','worldModel','knifeModel']} | {'viewmodel_hands'}
    for name in models:
        if not name: continue
        source = find(f'model_export/{name}_lod0.glb')
        if not source:
            raise RuntimeError(f'Missing model: {name}')
        buffer = source.read_bytes();length = int.from_bytes(buffer[12:16], 'little')
        gltf = json.loads(buffer[20:20+length])
        wanted.update(Path(i['uri']).stem.lstrip(',') for i in gltf.get('images', []) if i.get('uri', '').endswith('.dds'))
        for material in gltf.get('materials', []):
            native = find('materials/'+material['name'].lstrip(',')+'.json')
            if native:
                wanted.update(t['image'].lstrip(',') for t in json.loads(native.read_text()).get('textures', []) if t.get('semantic')=='colorMap')
    wanted = {name for name in wanted if name and '$identity' not in name and not find(f'images/{name}.dds')}
    art = ['menu_background_coop','loadscreen_zombie1','loadscreen_zombie_factory_mini','loadscreen_zombie_factory',
           'specialty_juggernaut_zombies','specialty_fastreload_zombies','specialty_doubletap_zombies','specialty_quickrevive_zombies']
    requested = wanted | set(art)
    archives = sorted((GAME / 'main').glob('*.iwd'))
    sources = {}
    for archive in archives:
        with ZipFile(archive) as bundle:
            lookup = {name.casefold(): name for name in bundle.namelist()}
            for name in requested:
                member = lookup.get(('images/'+name+'.iwi').casefold())
                if member: sources[name] = (archive, member)
    for name in requested:
        if name not in sources:
            if name in wanted: raise RuntimeError(f'Missing map texture: {name}')
            continue
        archive, member = sources[name]
        raw = ZONE / 'images' / (name+'.iwi')
        with ZipFile(archive) as bundle: raw.write_bytes(bundle.read(member))
        subprocess.run([str(ROOT/'.tools/oat/ImageConverter.exe'),'--no-color',str(raw)],check=True,stdout=subprocess.DEVNULL)
        if name in art:
            subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(raw.with_suffix('.dds')),
                            '-frames:v','1',str(DATA/'gameplay/hud'/ (name+'.png'))],check=True)
    sounds = dict(original['sounds'])
    aliases = {w.get(k) for w in weapons.values() for k in ['fireSound','reloadSound','fireSoundPlayer','reloadSoundPlayer','emptyFireSoundPlayer','meleeSwipeSoundPlayer','raiseSoundPlayer','putawaySoundPlayer']}
    aliases.update(line.split()[-1] for w in weapons.values() for line in w.get('notetrackSoundMap','').splitlines() if line.split())
    # Zombie notetrack sounds and the scripted death_vocals / behind_vocals.
    aliases.update(['amb_vocals','sprint_vocals','attack_vocals','attack_whoosh','step_zombie','step_sweetner','crawl_vocals','crawl_vocals_slow','board_vocals','taunt_vocals','death_vocals','behind_vocals'])
    aliases.update(['switch_flip','bridge_lower','bridge_hit','mx_jugger_jingle','mx_speed_jingle','mx_doubletap_jingle','mx_revive_jingle','mx_packa_jingle','teleport_in','teleport_out','packa_door_2'])
    convert_sounds(aliases, sounds)
    labels=['Colt M1911','Kar98k','Gewehr 43','M1A1 Carbine','M1 Garand','Thompson','BAR','Double barrel','Trench gun','MP40','.357 Magnum','STG-44','MG42','FG42','Type 100','PPSh-41','Browning M1919']
    weapon_names=dict(zip(names,labels))
    for name in names[1:]:
        if name+'_upgraded' in weapons: weapon_names[name+'_upgraded']='Upgraded '+weapon_names[name]
    # _zombiemode.gsc: Der Riese's zombie_spawn_delay starts at 2, not Nacht's 3.
    manifest = {**original,'variables':{**original['variables'],'zombie_spawn_delay':2},'weapons':weapons,'weaponNames':weapon_names,'entities':entities,'sounds':sounds,
                'map':{'id':'der-riese','title':'Der Riese','initialZone':'receiver_zone','volumes':volumes,'goals':goals,'connections':connections,
                       'boxWeapons':names,'initialBox':'magic_box_lid_0'}}
    add_perk_assets(manifest)
    (OUTPUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
    (OUTPUT/'presentation.json').write_bytes((DATA/'gameplay/presentation.json').read_bytes())
    from prepare_fidelity import add_animations, DER_RIESE_GAITS
    add_animations(OUTPUT/'presentation.json', 'der-riese', DER_RIESE_GAITS)
    add_presentation_assets(OUTPUT/'presentation.json')
    print(json.dumps({'entities':len(entities),'barriers':len(goals),'weapons':len(weapons),'texturesRecovered':len(wanted),'sounds':sum(len(v) for v in sounds.values())}))


if __name__ == '__main__': prepare()
