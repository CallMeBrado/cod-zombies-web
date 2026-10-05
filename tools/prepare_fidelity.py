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

def prepare():
    animations = {}
    for name in ANIMS:
        d = json.loads((DATA / 'nacht/web-anims' / (name+'.json')).read_text())
        delta = d.get('delta')
        motion = []
        if delta and delta['values']:
            motion = [[index/d['fps'], *[delta['mins'][k]+value[k]*delta['size'][k] for k in range(3)]]
                      for index,value in zip(delta['indices'],delta['values'])]
        animations[name] = {'duration':d['frames']/d['fps'], 'notifies':d['notifies'], 'motion':motion}
    effects = {}
    grenade_effects = ['explosions/grenadeexp_concrete','explosions/fx_grenade_flash']
    sources = list((DATA / 'nacht/web-fx').rglob('*.json')) + [DATA / 'common/web-fx' / (name+'.json') for name in grenade_effects]
    for source in sources:
        effect = json.loads(source.read_text())
        for element in effect['elements']:
            textures = []
            grenade_fx = effect['name'] in grenade_effects
            for name in element['visuals']:
                name = name.lstrip(',')
                material = next((DATA/z/'materials'/(name+'.json') for z in ['nacht','common']
                                 if (DATA/z/'materials'/(name+'.json')).exists()), None)
                if not material:
                    continue
                settings = json.loads(material.read_text())
                if grenade_fx:
                    state = next(iter(settings.get('stateBits',[])), {})
                    element['blending'] = 'additive' if state.get('dstBlendRgb') == 'one' else 'normal'
                    if 'distortion' in name:
                        continue
                texture = next((t for t in settings.get('textures',[]) if t.get('semantic')=='colorMap'),
                               next(iter(settings.get('textures',[])), None))
                if not texture:
                    continue
                image = texture['image'].lstrip(',')
                target = next((DATA/z/'images'/(image+'.dds') for z in ['nacht','common']
                               if (DATA/z/'images'/(image+'.dds')).exists()), None)
                if not target:
                    for archive in sorted((GAME/'main').glob('*.iwd')):
                        with ZipFile(archive) as bundle:
                            member = 'images/'+image+'.iwi'
                            if member in bundle.namelist():
                                raw = DATA/'nacht/images'/(image+'.iwi')
                                raw.parent.mkdir(parents=True,exist_ok=True)
                                raw.write_bytes(bundle.read(member))
                    raw = DATA/'nacht/images'/(image+'.iwi')
                    if raw.exists():
                        subprocess.run([str(ROOT/'.tools/oat/ImageConverter.exe'),'--no-color',str(raw)],check=True,stdout=subprocess.DEVNULL)
                        target = raw.with_suffix('.dds')
                if target:
                    textures.append('/data/'+target.relative_to(DATA).as_posix())
            element['textures'] = textures
        effects[effect['name']] = effect
    result = {'animations':animations, 'effects':effects,
              'powerups':{'full_ammo':'zombie_ammocan','insta_kill':'zombie_skull','double_points':'zombie_x2_icon','nuke':'zombie_bomb'},
              'box':{'openAngle':105,'openTime':.5,'floatHeight':40,'riseTime':3,'offerTime':12,'closeTime':.5,'cooldown':3,
                     'cycleDelays':[.05]*20+[.1]*10+[.2]*5+[.3]*3+[0,0]}}
    (DATA/'gameplay/presentation.json').write_text(json.dumps(result,separators=(',',':')))
    print(json.dumps({'animations':len(animations),'effects':len(effects),'powerups':4}))

if __name__ == '__main__':
    prepare()
