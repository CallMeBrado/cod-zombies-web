"""Prepare Kino's native T5 assets and script-derived browser runtime data on E:."""
from pathlib import Path
from zipfile import ZipFile
from collections import Counter
import json, re, struct, subprocess, wave, shutil
from inspect_game import parse_entities
from prepare_fidelity import animation

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops')
SEARCH = ['bo1-kino', 'bo1-common', 'bo1-base', 'bo1-english', 'bo1-ui']
OUTPUT = DATA / 'gameplay/bo1-kino'
OUTPUT.mkdir(parents=True, exist_ok=True)
archives = {}
for archive in sorted((GAME / 'main').glob('*.iwd')):
    with ZipFile(archive) as z:
        for name in z.namelist(): archives[name.casefold()] = (archive, name)

def find(relative):
    return next((DATA / z / relative for z in SEARCH if (DATA / z / relative).is_file()), None)

def archive_bytes(name):
    where = archives.get(name.casefold())
    if not where: return None
    with ZipFile(where[0]) as z: return z.read(where[1])

def weapon(name):
    p = find('weapons/' + name)
    if not p: raise RuntimeError('Missing native weapon: ' + name)
    values = p.read_text().split('\\')
    props = dict(zip(values[1::2], values[2::2]))
    return {k: float(v) if re.fullmatch(r'-?\d+(?:\.\d*)?', v) else v for k, v in props.items()}

entities = parse_entities(DATA / 'bo1-kino/maps/zombie_theater.d3dbsp.ents')
world = json.loads((DATA / 'bo1-kino/web-world/zombie_theater.json').read_text())
for name, details in world['materials'].items():
    if details.get('diffuse'): continue
    p=find('materials/'+name.lstrip(',')+'.json')
    if not p: raise RuntimeError('Unresolved native world material: '+name)
    material=json.loads(p.read_text())
    details['diffuse']=next((t['image'] for t in material.get('textures',[]) if t['semantic']=='colorMap'),None)
    details['normal']=next((t['image'] for t in material.get('textures',[]) if t['semantic']=='normalMap'),None)
    if not details['diffuse']:raise RuntimeError('Native material has no color texture: '+name)
(DATA/'bo1-kino/web-world/zombie_theater.json').write_text(json.dumps(world,separators=(',',':')))
collision = json.loads((DATA / 'bo1-kino/web-world/zombie_theater.collision.json').read_text())
paths = json.loads((DATA / 'bo1-kino/web-world/zombie_theater.paths.json').read_text())
script = (DATA / 'bo1-kino/maps/zombie_theater.gsc').read_text()
point = lambda e: list(map(float, e['origin'].split()))
# T5 embeds its traverse markers in the native path graph instead of entities.
for i, node in enumerate(paths['nodes']):
    if node['type'] != 17: continue
    end = next((paths['nodes'][l['node']] for l in node['links'] if l['negotiation']), None)
    if not end: continue
    key = 'kino_traverse_' + str(i)
    entities += [dict(classname='script_struct', targetname='traverse', target=key,
                     origin=' '.join(map(str, [*node['origin'][:2], node['origin'][2]-16])), angles=f"0 {node['angle']} 0"),
                 dict(classname='script_struct', targetname=key, origin=' '.join(map(str, [*end['origin'][:2], end['origin'][2]-16])))]
# Preserve native names alongside the adapter names used by the shared renderer.
core = next(e for e in entities if e.get('targetname') == 'trigger_teleport_pad_0')
pad = next(e for e in entities if e.get('targetname') == core['target'] and e.get('classname') == 'trigger_use')
pad['nativeTargetname'] = pad['targetname']; pad['targetname'] = 'trigger_teleport_core'
for e in entities:
    if e.get('targetname') == 'use_elec_switch': e.update(nativeTargetname='use_elec_switch', targetname='use_power_switch')
    if e.get('targetname') == 'elec_switch': e.update(nativeTargetname='elec_switch', targetname='power_switch')

volumes = []
for e in entities:
    if e.get('script_noteworthy') != 'player_volume': continue
    origin = point(e); model = collision['models'][int(e['model'][1:])]; hulls = []
    for index in model['brushes']:
        b = collision['brushes'][index]
        hulls.append(dict(mins=[v+origin[k] for k,v in enumerate(b['mins'])], maxs=[v+origin[k] for k,v in enumerate(b['maxs'])],
                          planes=[[*p[:3], p[3]+sum(p[k]*origin[k] for k in range(3))] for p in b['planes']]))
    volumes.append(dict(name=e['targetname'], spawners=e['target'], hulls=hulls))
def zone_at(p):
    def score(v):
        return min(sum(max(h['mins'][k]-p[k], 0, p[k]-h['maxs'][k])**2 for k in range(3)) for h in v['hulls'])
    return min(volumes, key=score)
goals = {}
for e in entities:
    if e.get('targetname') != 'exterior_goal': continue
    begin = min((x for x in entities if x.get('targetname')=='traverse'), key=lambda x: sum((a-b)**2 for a,b in zip(point(x),point(e))))
    end = next(x for x in entities if x.get('targetname')==begin['target'])
    v = zone_at([*point(end)[:2], point(end)[2]+25]); goals[e['target']] = dict(zone=v['name'], spawners=v['spawners'])
connections = re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"', script)
names = {e['zombie_weapon_upgrade'] for e in entities if e.get('targetname')=='weapon_upgrade'}
names |= {'m1911_zm','python_zm','commando_zm','galil_zm','rpk_zm','hk21_zm','famas_zm','spas_zm','thundergun_zm','ray_gun_zm'}
names -= {'claymore_zm','bowie_knife_zm','frag_grenade_zm'}
base_names = sorted(names)
weapon_script = (DATA / 'bo1-common/maps/_zombiemode_weapons.gsc').read_text()
native_weapons = {n:(upgrade,int(cost)) for n,upgrade,cost in re.findall(r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,\s*"([^"\n]*)"\s*,\s*[^,\n]+,\s*(\d+)', weapon_script)}
for n in base_names:
    upgraded=native_weapons.get(n,(n.replace('_zm','_upgraded_zm'),0))[0]
    if n not in ['m1911_zm'] and find('weapons/'+upgraded): names.add(upgraded)
weapons = {n: weapon(n) for n in sorted(names)}
knife = weapon('knife_zm')
for name, w in weapons.items():
    # T5 stores reserve ammo in magazines, unlike T4's bullet counts.
    if name.startswith(('ray_gun','thundergun')): w['startAmmo'] += w['clipSize']
    else: w['startAmmo'] = (w['startAmmo']+1)*w['clipSize']; w['maxAmmo'] *= w['clipSize']
    w['handsModel'] = 'viewmodel_usa_pow_arms'
    w['knifeModel'] = knife['gunModel']
    for phase in ['in','loop','out']:
        w['dtp'+phase.title()+'Anim'] = w.get('dtp_'+phase,'')
        w['dtp'+phase.title()+'EmptyAnim'] = w.get('dtp_empty_'+phase,'')
    for key in ['meleeAnim','meleeChargeAnim','meleeDamage','meleeDelay','meleeChargeDelay','meleeTime','meleeChargeTime','meleeChargeRange']: w[key] = knife[key]
    w['meleeDelay'] = knife['meleeDelay']; w['meleeSwipeSoundPlayer'] = 'wpn_knife_pull_plr'
    upgraded=native_weapons.get(name,('',0))[0]
    if upgraded in weapons: w['upgrade'] = upgraded
    # The gun's base animation is also its fallback ADS / last-shot animation.
    for key, fallback in [('lastShotAnim','fireAnim'),('adsFireAnim','fireAnim'),('adsLastShotAnim','lastShotAnim'),('emptyIdleAnim','idleAnim')]:
        if not w.get(key): w[key] = w.get(fallback,'')
    if not w.get('locHead'): w['locHead'] = 1
    if not w.get('locTorsoUpper'): w['locTorsoUpper'] = 1
grenade = weapon('frag_grenade_zm'); grenade['handsModel'] = 'viewmodel_usa_pow_arms'
gesture_names={'specialty_armorvest':'zombie_perk_bottle_jugg','specialty_fastreload':'zombie_perk_bottle_sleight',
               'specialty_rof':'zombie_perk_bottle_doubletap','specialty_quickrevive':'zombie_perk_bottle_revive','knuckle_crack':'zombie_knuckle_crack'}
gestures={key:dict(weapon(name),name=name,handsModel='viewmodel_usa_pow_arms') for key,name in gesture_names.items()}
costs = {n: value[1] for n,value in native_weapons.items()}
for e in entities:
    if e.get('targetname')=='weapon_upgrade':
        e['zombie_cost'] = str(costs.get(e['zombie_weapon_upgrade'], 250))
        e['script_ammo_clip'] = str(int(e['zombie_cost'])//2)
initial_box = next(e['target'] for e in entities if e.get('targetname')=='treasure_chest_use' and e.get('start_exclude')!='1')
source = (DATA / 'bo1-common/maps/_zombiemode.gsc').read_text()
variables = {k:float(v) for k,v in re.findall(r'set_zombie_var\(\s*"([^"\n]+)"\s*,\s*([\d.]+)',source)}
# mp/zombiemode.csv overrides GSC defaults in the original game.
csv = archive_bytes('mp/zombiemode.csv')
if csv:
    for row in csv.decode().splitlines():
        parts=row.split(',')
        if len(parts)>1 and re.fullmatch(r'\d+(?:\.\d+)?',parts[1]): variables[parts[0]]=float(parts[1])
variables.update(zombie_score_start=500,zombie_score_kill=50,zombie_score_damage=10,zombie_max_ai=24,zombie_ai_per_player=6)
variables['zombie_health_increase_percent'] = variables.get('zombie_health_increase_multiplier', .1)

animations = {}
for name in ['ai_zombie_walk_v1','ai_zombie_walk_v2','ai_zombie_walk_v3','ai_zombie_walk_v4','ai_zombie_walk_v6','ai_zombie_walk_v7','ai_zombie_walk_v8',
             'ai_zombie_walk_fast_v1','ai_zombie_walk_fast_v2','ai_zombie_walk_fast_v3','ai_zombie_run_v2','ai_zombie_run_v4','ai_zombie_sprint_v1','ai_zombie_sprint_v2',
             # level._zombie_melee / _zombie_walk_melee / _zombie_run_melee
             'ai_zombie_attack_v2','ai_zombie_attack_v4','ai_zombie_attack_v6','ai_zombie_attack_forward_v1','ai_zombie_attack_forward_v2',
             'ai_zombie_walk_attack_v1','ai_zombie_walk_attack_v2','ai_zombie_walk_attack_v3','ai_zombie_walk_attack_v4','ai_zombie_run_attack_v1','ai_zombie_run_attack_v2','ai_zombie_run_attack_v3',
             'ai_zombie_attack_v1','ai_zombie_death_v1','ai_zombie_idle_v1','ai_zombie_traverse_v1','ai_zombie_traverse_v2',
             'ai_zombie_door_tear_low','ai_zombie_door_tear_high','ai_zombie_door_tear_left','ai_zombie_door_tear_right']:
    p=find('web-anims/'+name+'.json')
    if p: animations[name]=animation(p.relative_to(DATA).parts[0],name)
presentation = dict(animations=animations, effects={}, actors=dict(body='c_ger_honorguard_body1',head='c_ger_zombie_head1'),
                    powerups=dict(full_ammo='zombie_ammocan',insta_kill='zombie_skull',double_points='zombie_x2_icon',nuke='zombie_bomb',carpenter='zombie_carpenter'),
                    box=dict(openAngle=105,openTime=.5,floatHeight=40,riseTime=3,offerTime=12,closeTime=.5,cooldown=3,cycleDelays=[.05]*20+[.1]*10+[.2]*5+[.3]*3))
import prepare_fidelity
prepare_fidelity.GAME = GAME
for name in ['misc/fx_zombie_powerup_on','misc/fx_zombie_powerup_grab','env/light/fx_ray_sun_sm_short',
             'explosions/fx_grenadeexp_concrete','explosions/fx_grenade_flash']:
    p=find('web-fx/'+name+'.json')
    if p:
        effect=prepare_fidelity.load_effect(p,SEARCH,effect_blending='grenade' in name)
        if name.endswith('fx_grenadeexp_concrete'): effect['name']='explosions/grenadeexp_concrete'
        presentation['effects'][effect['name']]=effect

# Recover dependencies skipped as fastfile placeholders from the native IWDs.
wanted = {m.get(k,'').lstrip(',') for m in world['materials'].values() for k in ['diffuse','normal'] if m.get(k)}
for z in SEARCH:
    for p in (DATA/z/'model_export').glob('*_lod0.glb'):
        b=p.read_bytes();gltf=json.loads(b[20:20+int.from_bytes(b[12:16],'little')])
        wanted.update(Path(i['uri']).stem.lstrip(',') for i in gltf.get('images',[]) if i.get('uri','').endswith('.dds'))
art = ['loadscreen_zombie_theater','menu_zombie_theater','scorebar_zom_1','ammocounterback','hud_us_grenade',
       'specialty_juggernaut_zombies','specialty_fastreload_zombies','specialty_doubletap_zombies','specialty_quickrevive_zombies',*[f'chalkmarks_{i}' for i in range(1,6)],
       'overlay_low_health','hit_direction']
for name in sorted(wanted | set(art)):
    if find('images/'+name+'.dds') or '$identity' in name: continue
    raw=archive_bytes('images/'+name+'.iwi')
    if raw:
        p=DATA/'bo1-kino/images'/(name+'.iwi');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
        subprocess.run([str(ROOT/'.tools/oat/ImageConverter.exe'),'--no-color',str(p)],check=True,stdout=subprocess.DEVNULL)
hud=OUTPUT/'hud';hud.mkdir(exist_ok=True)
for name in art:
    p=find('images/'+name+'.dds')
    if p: subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(p),'-frames:v','1',str(hud/(name+'.png'))],check=True)

aliases = {v for w in [*weapons.values(),grenade] for k,v in w.items() if k.endswith('SoundPlayer') and isinstance(v,str) and v}
aliases.update(line.split()[-1] for w in weapons.values() for line in w.get('notetrackSoundMap','').splitlines() if line.split())
remap = dict(mx_splash_screen='mus_zombie_splash_screen',mx_zombie_wave_1='mus_theater_underscore',chalk='mus_zombie_round_start',round_over='mus_zombie_round_over',
             cha_ching='zmb_cha_ching',no_cha_ching='zmb_no_cha_ching',repair_boards='zmb_repair_boards',remove_boards='zmb_break_boards',
             switch_flip='zmb_switch_flip',electrical_surge='zmb_turn_on',grenade_explode='wpn_grenade_explode',melee_hit='wpn_melee_knife_hit_body',
             lid_open='zmb_lid_open',lid_close='zmb_lid_close',music_box='zmb_music_box',spawn_powerup='zmb_spawn_powerup',spawn_powerup_loop='zmb_spawn_powerup_loop',powerup_grabbed='zmb_powerup_grabbed',
             full_ammo='zmb_full_ammo',insta_kill='zmb_insta_kill',double_point='zmb_points_loop',nuke='evt_nuked',
             mx_jugger_sting='mus_perks_jugganog_sting',mx_speed_sting='mus_perks_speed_sting',mx_doubletap_sting='mus_perks_doubletap_sting',mx_revive_sting='mus_perks_revive_sting',mx_packa_sting='mus_perks_packa_sting',
             perks_power_on='zmb_perks_power_on',packa_rollers_loop='zmb_perks_packa_loop',packa_weap_upgrade='zmb_perks_packa_upgrade',packa_weap_ready='zmb_perks_packa_ready',ticktock_loop='zmb_perks_packa_ticktock',packa_deny='zmb_perks_packa_deny')
aliases.update(remap.values());aliases.update(['evt_teleporter_activate_start','evt_teleporter_activate_finish','evt_teleporter','wpn_knife_pull_plr','zmb_perks_packa_upgrade'])
aliases.update(['zmb_vocals_zombie_ambience','zmb_vocals_zombie_sprint','zmb_vocals_zombie_attack','zmb_vocals_zombie_teardown','zmb_vocals_zombie_taunt','zmb_vocals_zombie_behind',
                'zmb_vocals_zombie_death','zmb_vocals_zombie_crawler','zmb_zombie_spawn','zmb_attack_whoosh','fly_fall_zombie','evt_player_swiped',
                # The game_over music state.
                'mus_zombie_game_over'])
aliases.update(['zmb_vox_ann_maxammo','zmb_vox_ann_instakill','zmb_vox_ann_doublepoints','zmb_vox_ann_nuke','zmb_vox_ann_carpenter','zmb_vox_ann_magicbox'])
aliases.update(line.split()[-1] for w in gestures.values() for line in w.get('notetrackSoundMap','').splitlines() if line.split())
# T5 viewmodel clips name their sounds in notetracks ("sndnt#fly_colt45_mag_in"):
# reload magazine out/in, bolts and gear rattle. reloadSound is left empty.
for name in {v for w in [*weapons.values(),grenade,*gestures.values()] for k,v in w.items() if k.endswith('Anim') and isinstance(v,str) and v}:
    p=find('web-anims/'+name+'.json')
    if p: aliases.update(n['name'][6:] for n in json.loads(p.read_text()).get('notifies',[]) if n['name'].startswith('sndnt#'))
aliases.update(p.stem for z in ['bo1-kino','bo1-common'] for p in (DATA/z/'web-sounds').glob('*.json') if re.search(r'zmb_.*(jugg|speed|revive|doubletap|packa|perk|powerup)|mus_theatre|mus_perks',p.stem))
sounds={};sound_output=OUTPUT/'sounds';sound_output.mkdir(exist_ok=True);cache={}
def convert_audio(entry):
    filename=entry['file'].replace('\\','/').lstrip(',/')
    if filename in cache: return cache[filename]
    out=sound_output/(str(len(cache))+'.wav')
    raw=archive_bytes(filename) or archive_bytes('sound/'+filename)
    p=ROOT/'.cache/bo1-audio.boa'
    if raw:
        p.write_bytes(raw)
        r=subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(p),'-c:a','pcm_s16le',str(out)],capture_output=True)
    else:
        meta=find('web-audio/'+filename+'.json')
        if not meta: cache[filename]=None;return None
        m=json.loads(meta.read_text());raw=meta.with_suffix('.bin').read_bytes();r=None
        if m['format']==7:
            # T5 loaded WMA2 packets are headerless. Match the original sample
            # count as well as successful decoding; a decoder's exit code alone
            # can accept corrupt packets and produce a truncated sound.
            for align in ([4096,2230,2048,1487,1024] if m['channels']==2 else [2230,1487,2048,4096,1024]):
                if len(raw)%align: continue
                fmt=struct.pack('<HHIIHH',0x161,m['channels'],m['rate'],12000 if m['channels']==2 else 6000,align,16)
                body=b'XWMA'+b'fmt '+struct.pack('<I',len(fmt))+fmt+b'data'+struct.pack('<I',len(raw))+raw
                p.write_bytes(b'RIFF'+struct.pack('<I',len(body))+body)
                r=subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(p),'-c:a','pcm_s16le',str(out)],capture_output=True)
                if r.returncode==0 and not r.stderr:
                    with wave.open(str(out)) as w: count=w.getnframes()
                    if abs(count-m['frames'])<=2048: break
                r=None
        elif m['format']==6:
            header=bytearray(2096);struct.pack_into('<IIIII',header,0,1,m['frames'],m['rate'],m['channels'],2096);struct.pack_into('<I',header,21,m['blockSize']>>8)
            p.write_bytes(header+raw)
            r=subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-f','boa','-i',str(p),'-c:a','pcm_s16le',str(out)],capture_output=True)
    if not r or r.returncode or r.stderr or not out.exists() or out.stat().st_size<100:
        cache[filename]=None;return None
    cache[filename]='/data/'+out.relative_to(DATA).as_posix();return cache[filename]
for alias in sorted(aliases):
    p=find('web-sounds/'+alias+'.json')
    if not p: continue
    entries=[]
    for entry in json.loads(p.read_text())[:16 if alias.startswith(('zmb_vocals_zombie','zmb_attack_whoosh')) else 2]:
        url=convert_audio(entry)
        if url: entries.append(dict(entry,url=url,volume=entry['volume'],pitch=entry['pitch']))
    if entries: sounds[alias]=entries
for alias,native in remap.items():
    if native in sounds: sounds[alias]=sounds[native]
# BO1's underscore alias is spelled "theatre" in the actual sound bank.
if 'mx_zombie_wave_1' not in sounds:
    alias=next((a for a in sounds if 'underscore' in a),None)
    if alias:sounds['mx_zombie_wave_1']=sounds[alias]

power_doors={e['target'] for e in entities if e.get('script_noteworthy')=='electric_door'}
power_targets=['theater_curtains','theater_curtains_clip',*power_doors]
power_targets += [e['targetname'] for e in entities if e.get('classname')=='script_brushmodel' and any(e.get('targetname','').startswith(t) for t in power_doors)]
manifest = dict(format='bo1-kino-solo-v1',game='black-ops',startWeapon='m1911_zm',variables=variables,weapons=weapons,grenade=grenade,gestures=gestures,entities=entities,sounds=sounds,
                weaponNames={n:n.replace('_upgraded_zm',' (Pack-a-Punch)').replace('_zm','').replace('_',' ').upper() for n in weapons},
                map=dict(id='kino',negotiationBegin=17,negotiationEnd=18,initialZone='foyer_zone',connections=connections,volumes=volumes,goals=goals,initialBox=initial_box,
                         boxWeapons=[n for n in base_names if n!='m1911_zm'],powerTargets=sorted(set(power_targets)),
                         teleportDestination=point(next(e for e in entities if e.get('targetname')=='projroom_teleport_player0')),
                         teleportReturn=point(next(e for e in entities if e.get('targetname')=='theater_teleport_player0'))),
                provenance=dict(world='maps/zombie_theater.d3dbsp',rules='maps/zombie_theater.gsc',runtime='Black Ops browser reimplementation using locally installed T5 assets'))
(OUTPUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
# Character voice lines are a separate, lazily decoded table (tools/prepare_voice.py).
import prepare_voice
prepare_voice.prepare_kino(OUTPUT/'manifest.json')
import prepare_dive
prepare_dive.prepare()
import prepare_player_animations
prepare_player_animations.prepare()
(OUTPUT/'presentation.json').write_text(json.dumps(presentation,separators=(',',':')))
print(json.dumps(dict(entities=len(entities),windows=len(goals),weapons=len(weapons),animations=len(animations),sounds=len(sounds),undecodedSounds=sum(v is None for v in cache.values()),hud=[p.name for p in hud.glob('*.png')]),indent=2))
