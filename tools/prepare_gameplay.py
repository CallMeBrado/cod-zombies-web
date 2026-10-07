"""Prepare local runtime data from the installed game's recovered assets."""
from pathlib import Path
import json
import re
import shutil
import subprocess
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty World at War')


ZOMBIE_SOUNDS = ['amb_vocals','sprint_vocals','attack_vocals','attack_whoosh','step_zombie','step_sweetner','crawl_vocals','crawl_vocals_slow']

def prepare(game=GAME):
    source = (DATA / 'nacht/maps/_zombiemode.gsc').read_text()
    source = re.sub(r'//[^\n]*|/\*[\s\S]*?\*/|/#[\s\S]*?#/', '', source)
    variables = {}
    for name, number, divisor in re.findall(r'set_zombie_var\(\s*"([^"\n]+)"\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)', source):
        variables[name] = float(number) / (float(divisor) if divisor else 1)
    entities = json.loads((DATA / 'inspection.json').read_text())['entities']
    weapons = {}
    names = ['zombie_colt','kar98k','m1carbine','thompson','bar','doublebarrel','shotgun','mp40','sw_357','stg44','mg42_bipod']
    fields = ['displayName','gunModel','worldModel','damage','minDamage','maxDamageRange','minDamageRange','clipSize','startAmmo','maxAmmo','fireTime','reloadTime','reloadEmptyTime','fireSound','reloadSound','meleeDamage','adsZoomFov','moveSpeedScale','fireType','locHead','locTorsoUpper']
    fields += ['weaponType','weaponClass','penetrateType','rifleBullet','maxRange']
    fields += ['handModel','idleAnim','emptyIdleAnim','fireAnim','lastShotAnim','adsFireAnim','adsLastShotAnim','reloadAnim','reloadEmptyAnim','rechamberAnim','adsRechamberAnim','adsUpAnim','adsDownAnim','meleeAnim','raiseAnim',
               'fireSoundPlayer','reloadSoundPlayer','emptyFireSoundPlayer','notetrackSoundMap','rechamberTime','rechamberBoltTime','shotCount','adsSpread','hipSpreadStandMin','hipSpreadMax','hipSpreadDecayRate','hipSpreadFireAdd','hipSpreadMoveAdd',
               'adsTransInTime','adsTransOutTime','adsViewKickPitchMin','adsViewKickPitchMax','adsViewKickYawMin','adsViewKickYawMax','hipViewKickPitchMin','hipViewKickPitchMax','hipViewKickYawMin','hipViewKickYawMax','hipViewKickCenterSpeed','adsViewKickCenterSpeed','hudIcon']
    fields += ['knifeModel','meleeChargeAnim','meleeTime','meleeDelay','meleeChargeTime','meleeChargeDelay','meleeSwipeSoundPlayer','meleeHitSound',
               'sprintInAnim','sprintLoopAnim','sprintOutAnim','sprintInTime','sprintLoopTime','sprintOutTime','sprintDurationScale',
               'sprintOfsF','sprintOfsR','sprintOfsU','sprintRotP','sprintRotY','sprintRotR','sprintBobH','sprintBobV','sprintScale']
    from prepare_weapon_switch import SWITCH_FIELDS
    fields += SWITCH_FIELDS
    for name in names:
        values = (DATA / 'nacht/weapons' / name).read_text().split('\\')
        props = dict(zip(values[1::2], values[2::2]))
        weapons[name] = {key: float(props[key]) if re.fullmatch(r'-?\d+(?:\.\d*)?', props.get(key,'')) else props.get(key,'') for key in fields}
    grenade_values = (DATA / 'nacht/weapons/fraggrenade').read_text().split('\\')
    grenade_props = dict(zip(grenade_values[1::2], grenade_values[2::2]))
    grenade_fields = ['gunModel','handModel','worldModel','projectileModel','idleAnim','holdFireAnim','fireAnim','altRaiseAnim','altRaiseTime','altDropTime','holdFireTime','fireTime','fireDelay','dropTime','raiseTime','fuseTime','projectileSpeed','projectileSpeedUp','explosionRadius','explosionInnerDamage','explosionOuterDamage','parallelDefaultBounce','perpendicularDefaultBounce','pullbackSoundPlayer','fireSoundPlayer']
    grenade = {key: float(grenade_props[key]) if re.fullmatch(r'-?\d+(?:\.\d*)?', grenade_props.get(key,'')) else grenade_props.get(key,'') for key in grenade_fields}
    aliases = {w[key] for w in weapons.values() for key in ['fireSound','reloadSound','fireSoundPlayer','reloadSoundPlayer','emptyFireSoundPlayer','raiseSoundPlayer','putawaySoundPlayer'] if w[key]}
    aliases.update(['grenade_pull_pin','foley_throw','grenade_bounce_concrete','grenade_explode','grenade_explode_bass'])
    aliases.update(line.split()[-1] for w in weapons.values() for line in w['notetrackSoundMap'].splitlines() if line.split())
    aliases.update(['amb_zombies_left','amb_zombies_right','amb_spooky_2d','zombie_head_gib',
                    'mx_splash_screen','mx_zombie_wave_1','chalk','round_over'])
    aliases.update(['lid_open','music_box','lid_close','spawn_powerup','spawn_powerup_loop','powerup_grabbed',
                    'full_ammo','insta_kill','double_point','nuke','remove_boards','knife_pull_plr','knife_stab_plr','melee_hit',
                    'cha_ching','no_cha_ching','repair_boards'])
    aliases.update(w['meleeSwipeSoundPlayer'] for w in weapons.values() if w['meleeSwipeSoundPlayer'])
    # Zombie animation notetracks: vocals, swipes and footsteps.
    aliases.update(ZOMBIE_SOUNDS)
    hud = DATA / 'gameplay/hud'
    hud.mkdir(parents=True, exist_ok=True)
    # _gameskill.gsc's red overlay and the engine's damage direction arrow.
    image_names = {f'chalkmarks_{i}' for i in range(1,6)} | {'hud_colt','hud_us_grenade','ammocounterback','scorebar_zom_1','overlay_low_health','hit_direction'}
    for w in weapons.values():
        material = next((DATA / z / 'materials' / (w['hudIcon']+'.json') for z in ['nacht','common'] if (DATA / z / 'materials' / (w['hudIcon']+'.json')).exists()),None)
        if material:
            image_name = json.loads(material.read_text())['textures'][0]['image'].lstrip(',')
            image_names.add(image_name)
            w['hudImage'] = '/data/gameplay/hud/'+image_name+'.png'
    for name in image_names:
        for archive in sorted((game / 'main').glob('*.iwd')):
            with ZipFile(archive) as z:
                if 'images/'+name+'.iwi' in z.namelist():
                    raw = DATA / 'ui/images' / (name+'.iwi')
                    raw.parent.mkdir(parents=True,exist_ok=True)
                    raw.write_bytes(z.read('images/'+name+'.iwi'))
        raw = DATA / 'ui/images' / (name+'.iwi')
        if raw.exists():
            subprocess.run([str(ROOT/'.tools/oat/ImageConverter.exe'),'--no-color',str(raw)],check=True,stdout=subprocess.DEVNULL)
        image_file = next((DATA / z / 'images' / (name+'.dds') for z in ['ui','nacht','common'] if (DATA / z / 'images' / (name+'.dds')).exists()),None)
        if image_file:
            subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(image_file),'-frames:v','1',str(hud/(name+'.png'))], check=True)
    subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(DATA/'ui/images/gamefonts_pc.dds'),'-frames:v','1',str(hud/'gamefonts_pc.png')],check=True)
    sounds = {}
    wanted = {}
    for alias in sorted(aliases):
        file = next((DATA / zone / 'web-sounds' / (alias + '.json') for zone in ['nacht','common'] if (DATA / zone / 'web-sounds' / (alias + '.json')).exists()), None)
        if file is None:
            continue
        entries = json.loads(file.read_text())[:12 if alias in ZOMBIE_SOUNDS else 4]
        for entry in entries:
            source_file = entry['file'].replace('\\','/').lstrip(',/')
            wanted[source_file] = None
        sounds[alias] = entries
    for archive in sorted((game / 'main').glob('*.iwd')):
        with ZipFile(archive) as z:
            # Windows game paths and IWD member names use inconsistent casing.
            files = {name.casefold(): name for name in z.namelist()}
            for file in wanted:
                for candidate in [file, 'sound/' + file]:
                    if candidate.casefold() in files:
                        wanted[file] = (archive, files[candidate.casefold()])
    output_sounds = DATA / 'gameplay/sounds'
    output_sounds.mkdir(parents=True, exist_ok=True)
    for alias, entries in list(sounds.items()):
        available = []
        for i, entry in enumerate(entries):
            source_file = entry['file'].replace('\\','/').lstrip(',/')
            location = wanted.get(source_file)
            filename = f'{alias}_{i}.wav'
            # OAT exports loaded XWMA with its real extension, even if the alias
            # references .wav. Preserve the original stream and convert it below.
            loaded = next((candidate for zone in ['nacht','common']
                           for candidate in [DATA / zone / 'sound' / source_file,
                                             (DATA / zone / 'sound' / source_file).with_suffix('.xwma')]
                           if candidate.exists()), None)
            input_file = loaded
            if not loaded and location:
                with ZipFile(location[0]) as z:
                    input_file = ROOT / '.cache' / ('audio-' + filename)
                    input_file.write_bytes(z.read(location[1]))
            if input_file is None:
                continue
            converter = shutil.which('ffmpeg')
            if not converter:
                raise RuntimeError('FFmpeg is required to convert the original ADPCM sounds into browser-compatible PCM WAV.')
            subprocess.run([converter, '-nostdin', '-y', '-loglevel', 'error', '-i', str(input_file), '-c:a', 'pcm_s16le', str(output_sounds / filename)], check=True)
            available.append({**entry, 'url': '/data/gameplay/sounds/' + filename})
        sounds[alias] = available
    manifest = {'format':'waw-solo-data-v1', 'variables':variables, 'weapons':weapons, 'grenade':grenade, 'entities':entities,
                'sounds':sounds, 'provenance':{'rules':'maps/_zombiemode.gsc', 'weaponSettings':'original WEAPONFILE assets',
                'runtime':'JavaScript engine reimplementation; not the native WaW executable or a full GSC interpreter'}}
    (DATA / 'gameplay/manifest.json').write_text(json.dumps(manifest, separators=(',',':')))
    from prepare_fidelity import prepare as prepare_presentation
    prepare_presentation()
    print(json.dumps({'variables':len(variables),'weapons':len(weapons),'originalSoundFiles':sum(len(x) for x in sounds.values()),'entities':len(entities)}))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-dir', type=Path, default=GAME)
    prepare(parser.parse_args().game_dir)
