"""Recover presentation and timing data from Brad's installed Nacht assets."""
from pathlib import Path
import json
from zipfile import ZipFile
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty World at War')
ANIMS = ['ai_zombie_walk_v1', 'ai_zombie_attack_v1', 'ai_zombie_death_v1', 'ai_zombie_idle_v1',
         'ai_zombie_traverse_v1', 'ai_zombie_traverse_v2',
         'ai_zombie_door_tear_low', 'ai_zombie_door_tear_high', 'ai_zombie_door_tear_left', 'ai_zombie_door_tear_right']
# _zombiemode.gsc walk/run/sprint cycles. Der Riese adds slower walks and real runs.
GAITS = ['ai_zombie_walk_v2', 'ai_zombie_walk_v3', 'ai_zombie_walk_v4',
         'ai_zombie_walk_fast_v1', 'ai_zombie_walk_fast_v2', 'ai_zombie_walk_fast_v3',
         'ai_zombie_sprint_v1', 'ai_zombie_sprint_v2']
DER_RIESE_GAITS = ['ai_zombie_walk_v6', 'ai_zombie_walk_v7', 'ai_zombie_walk_v8', 'ai_zombie_run_v2', 'ai_zombie_run_v4']

def animation(zone, name):
    d = json.loads((DATA / zone / 'web-anims' / (name+'.json')).read_text())
    delta = d.get('delta')
    motion = []
    if delta and delta['values']:
        motion = [[index/d['fps'], *[delta['mins'][k]+value[k]*delta['size'][k] for k in range(3)]]
                  for index,value in zip(delta['indices'],delta['values'])]
    return {'duration':d['frames']/d['fps'], 'notifies':d['notifies'], 'motion':motion}

def add_animations(path, zone, names):
    result = json.loads(path.read_text())
    for name in names: result['animations'][name] = animation(zone, name)
    path.write_text(json.dumps(result,separators=(',',':')))

def load_effect(source, zones, effect_blending=False):
    """Resolve an exported web-fx effect's materials to served DDS textures."""
    effect = json.loads(source.read_text())
    for element in effect['elements']:
        textures = []
        for name in element['visuals']:
            name = name.lstrip(',')
            material = next((DATA/z/'materials'/(name+'.json') for z in zones
                             if (DATA/z/'materials'/(name+'.json')).exists()), None)
            if not material:
                continue
            settings = json.loads(material.read_text())
            if effect_blending:
                state = next(iter(settings.get('stateBits',[])), {})
                element['blending'] = 'additive' if state.get('dstBlendRgb') == 'one' else 'normal'
                if 'distortion' in name:
                    continue
            texture = next((t for t in settings.get('textures',[]) if t.get('semantic')=='colorMap'),
                           next(iter(settings.get('textures',[])), None))
            if not texture:
                continue
            image = texture['image'].lstrip(',')
            target = next((DATA/z/'images'/(image+'.dds') for z in zones
                           if (DATA/z/'images'/(image+'.dds')).exists()), None)
            if not target:
                for archive in sorted((GAME/'main').glob('*.iwd')):
                    with ZipFile(archive) as bundle:
                        member = 'images/'+image+'.iwi'
                        if member in bundle.namelist():
                            raw = DATA/zones[0]/'images'/(image+'.iwi')
                            raw.parent.mkdir(parents=True,exist_ok=True)
                            raw.write_bytes(bundle.read(member))
                raw = DATA/zones[0]/'images'/(image+'.iwi')
                if raw.exists():
                    subprocess.run([str(ROOT/'.tools/oat/ImageConverter.exe'),'--no-color',str(raw)],check=True,stdout=subprocess.DEVNULL)
                    target = raw.with_suffix('.dds')
            if target:
                textures.append('/data/'+target.relative_to(DATA).as_posix())
        element['textures'] = textures
    return effect

def add_effects(path, zone, names):
    result = json.loads(path.read_text())
    for name in names:
        effect = load_effect(DATA/zone/'web-fx'/(name+'.json'), [zone, 'common', 'nacht'], effect_blending=True)
        result['effects'][effect['name']] = effect
    path.write_text(json.dumps(result,separators=(',',':')))

def prepare():
    animations = {name:animation('nacht', name) for name in ANIMS+GAITS}
    effects = {}
    grenade_effects = ['explosions/grenadeexp_concrete','explosions/fx_grenade_flash']
    sources = list((DATA / 'nacht/web-fx').rglob('*.json')) + [DATA / 'common/web-fx' / (name+'.json') for name in grenade_effects]
    for source in sources:
        effect = load_effect(source, ['nacht', 'common'], effect_blending=json.loads(source.read_text())['name'] in grenade_effects)
        effects[effect['name']] = effect
    result = {'animations':animations, 'effects':effects,
              'powerups':{'full_ammo':'zombie_ammocan','insta_kill':'zombie_skull','double_points':'zombie_x2_icon','nuke':'zombie_bomb'},
              'box':{'openAngle':105,'openTime':.5,'floatHeight':40,'riseTime':3,'offerTime':12,'closeTime':.5,'cooldown':3,
                     'cycleDelays':[.05]*20+[.1]*10+[.2]*5+[.3]*3+[0,0]}}
    (DATA/'gameplay/presentation.json').write_text(json.dumps(result,separators=(',',':')))
    print(json.dumps({'animations':len(animations),'effects':len(effects),'powerups':4}))

if __name__ == '__main__':
    prepare()
