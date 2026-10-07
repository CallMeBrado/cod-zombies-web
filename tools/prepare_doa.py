"""Prepare Dead Ops Arcade's native arenas, weapons, actors, HUD and sound."""
from pathlib import Path
from zipfile import ZipFile
import json, re, struct, subprocess, wave, hashlib
from inspect_game import parse_entities
import prepare_fidelity

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops')
ZONES = ['bo1-doa-patch', 'bo1-doa', 'bo1-doa-english', 'bo1-doa-common', 'bo1-common', 'bo1-base', 'bo1-ui']
OUT = DATA / 'gameplay/bo1-doa'
OUT.mkdir(parents=True, exist_ok=True)
def find(relative):
    return next((DATA / z / relative for z in ZONES if (DATA / z / relative).is_file()), None)
def read(relative):
    p = find(relative)
    if not p: raise RuntimeError('Missing original Dead Ops asset: ' + relative)
    return json.loads(p.read_text())
def point(e): return list(map(float, e['origin'].split()))
entities = parse_entities(DATA / 'bo1-doa/maps/zombietron.d3dbsp.ents')
worldfile = DATA / 'bo1-doa/web-world/zombietron.json'
world = json.loads(worldfile.read_text())
for name, info in world['materials'].items():
    if info.get('diffuse'): continue
    native = read('materials/' + name.lstrip(',') + '.json')
    for key, semantic in [('diffuse', 'colorMap'), ('normal', 'normalMap')]:
        if not info.get(key): info[key] = next((t['image'] for t in native.get('textures', []) if t['semantic'] == semantic), None)
    if not info.get('diffuse'): raise RuntimeError('Missing color map: ' + name)
worldfile.write_text(json.dumps(world, separators=(',', ':')))
collision = read('web-world/zombietron.collision.json')
arenas = []
for name in ['island', 'town', 'prison', 'temple', 'factory', 'rooftop', 'street', 'bunker', 'snow', 'jungle']:
    center = point(next(e for e in entities if e.get('targetname') == name + '_center'))
    spawn = point(next(e for e in entities if e.get('targetname') == name + '_spawnpoint'))
    spawners = [dict(position=point(e), side=e.get('script_parameters', 'top')) for e in entities if e.get('targetname') == name + '_spawner']
    exits = []
    for e in entities:
        if e.get('script_noteworthy') != name + '_exit': continue
        at = point(e); model = collision['models'][int(e['model'][1:])]
        hulls = [collision['brushes'][i] for i in model['brushes']]
        exits.append(dict(position=at, side=e['script_parameters'], target=e.get('target'),
                          mins=[min(h['mins'][k] for h in hulls) + at[k] for k in range(3)],
                          maxs=[max(h['maxs'][k] for h in hulls) + at[k] for k in range(3)]))
    arenas.append(dict(id=name, center=center, spawn=spawn, spawners=spawners, exits=exits,
                       bounds=dict(mins=[min(x['position'][k] for x in exits)-48 for k in range(2)],
                                   maxs=[max(x['position'][k] for x in exits)+48 for k in range(2)])))
script = find('maps/zombietron.gsc').read_text()
variables = {k: float(v) for k, v in re.findall(r'set_zombie_var\(\s*"([^"]+)"\s*,\s*([\d.]+)', script)}
weapons = {}
for name in ['m60_zt', 'minigun_zt', 'spas_zt', 'china_lake_zt', 'rpg_zt', 'ray_gun_zt', 'm2_flamethrower_zt']:
    values = find('weapons/' + name).read_text().split('\\')
    weapons[name] = {k: float(v) if re.fullmatch(r'-?\d+(?:\.\d*)?', v) else v for k, v in zip(values[1::2], values[2::2])}
models = dict(player='c_usa_blackops_body3_fb_zt', zombie='c_ger_honorguard_body1_zt', head='c_ger_zombie_head1_zt',
              ape='c_rus_simianaut_body', dog='zombie_wolf', sergei='c_rus_sergei_fb',
              quad='c_zom_quad_body', engineer='char_ger_zombeng_body1_1')
pickups = dict(gold='zombietron_gold_coin', silver='zombietron_silver_coin', ruby='zombietron_ruby',
               diamond='zombietron_diamond', bomb='zombie_bomb', booster='zombietron_lightning_bolt',
               speed='p_rus_boots', life='c_usa_blackops_body1_fb', chicken='anim_chicken',
               tank='t5_veh_tank_t55_mini_static', heli='t5_veh_helo_hind_mini', turret='zombie_auto_turret',
               monkey='weapon_zombie_monkey_bomb_zt', barrel='p_glo_barrel_metal_blue', tesla='zombietron_electric_ball', teddy='zombie_teddybear')
available = {p.stem for z in ZONES for p in (DATA/z/'web-anims').glob('*.json')}
def choose(*names): return next((n for n in names if n in available), None)
animations = dict(playerIdle=choose('pb_stand_idle', 'pb_stand_alert', 'pb_stand_hold_idle', 'pb_beltfed_idle'),
                  playerRun=choose('pb_combatrun_forward_loop', 'pb_beltfed_run', 'pb_stand_run'),
                  walk=choose('ai_zombie_walk_v1'), run=choose('ai_zombie_run_v1'),
                  death=choose('ai_zombie_death_v1'), attack=choose('ai_zombie_attack_v1'),
                  apeIdle=choose('ai_zombie_simianaut_idle'), apeRun=choose('ai_zombie_simianaut_run'),
                  apeAttack=choose('ai_zombie_simianaut_ground_pound'),
                  dogRun=choose('zombie_dog_run'), dogDeath=choose('zombie_dog_death'),
                  quadRun=choose('ai_zombie_quad_crawl_sprint_3'), quadDeath=choose('ai_zombie_quad_death'),quadAttack=choose('ai_zombie_quad_attack'))
# The loading movie is also the original map selection artwork.
hud = OUT/'hud'; hud.mkdir(exist_ok=True)
movie = GAME/'main/video/zombietron_load.bik'
subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-ss','2','-i',str(movie),'-frames:v','1',str(hud/'loadscreen_zombietron.png')],check=True)
for name in ['zom_icon_player_life', 'hud_zombie_bomb', 'hud_lightning_bolt', 'zom_icon_community_pot', 'zom_icon_community_pot_strip']:
    p = find('images/' + name + '.dds')
    if p: subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(p),'-frames:v','1',str(hud/(name+'.png'))],check=True)
archives = {}
for archive in sorted((GAME/'main').glob('*.iwd')):
    with ZipFile(archive) as z:
        for name in z.namelist(): archives[name.casefold()] = (archive, name)
def archive_bytes(name):
    where = archives.get(name.casefold())
    if where:
        with ZipFile(where[0]) as z: return z.read(where[1])
sounds = {}; cache = {}; soundout = OUT/'sounds'; soundout.mkdir(exist_ok=True)
def convert_audio(entry):
    filename = entry['file'].replace('\\','/').lstrip(',/')
    if filename in cache: return cache[filename]
    out = soundout/(hashlib.sha256(filename.encode()).hexdigest()[:16]+'.wav')
    if out.exists() and out.stat().st_size > 100:
        cache[filename] = '/data/'+out.relative_to(DATA).as_posix(); return cache[filename]
    p = ROOT/'.cache/doa-audio.boa'; p.parent.mkdir(exist_ok=True)
    raw = archive_bytes(filename) or archive_bytes('sound/'+filename); r = None
    if raw:
        p.write_bytes(raw)
        r = subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(p),'-c:a','pcm_s16le',str(out)],capture_output=True)
    else:
        meta = find('web-audio/'+filename+'.json')
        if not meta: cache[filename] = None; return None
        m = json.loads(meta.read_text()); raw = meta.with_suffix('.bin').read_bytes()
        if m['format'] == 7:
            for align in ([4096,2230,2048,1487,1024] if m['channels']==2 else [2230,1487,2048,4096,1024]):
                if len(raw)%align: continue
                fmt = struct.pack('<HHIIHH',0x161,m['channels'],m['rate'],12000 if m['channels']==2 else 6000,align,16)
                body = b'XWMA'+b'fmt '+struct.pack('<I',len(fmt))+fmt+b'data'+struct.pack('<I',len(raw))+raw
                p.write_bytes(b'RIFF'+struct.pack('<I',len(body))+body)
                r = subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(p),'-c:a','pcm_s16le',str(out)],capture_output=True)
                if r.returncode==0 and not r.stderr:
                    with wave.open(str(out)) as w: count=w.getnframes()
                    if abs(count-m['frames'])<=2048: break
                r=None
        elif m['format'] == 6:
            header=bytearray(2096);struct.pack_into('<IIIII',header,0,1,m['frames'],m['rate'],m['channels'],2096);struct.pack_into('<I',header,21,m['blockSize']>>8)
            p.write_bytes(header+raw)
            r=subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-f','boa','-i',str(p),'-c:a','pcm_s16le',str(out)],capture_output=True)
    if not r or r.returncode or not out.exists() or out.stat().st_size<100: cache[filename]=None; return None
    cache[filename]='/data/'+out.relative_to(DATA).as_posix();return cache[filename]
aliases = {p.stem for p in (DATA/'bo1-doa/web-sounds').glob('*.json') if p.stem.startswith(('mus_zmbtron','zmb_','wpn_'))}
for i, alias in enumerate(sorted(aliases)):
    entries = []
    for entry in read('web-sounds/'+alias+'.json')[:1 if alias.startswith('mus_') else 2]:
        url = convert_audio(entry)
        if url: entries.append(dict(entry, url=url))
    if entries: sounds[alias] = entries
    if i%40==0: print('Dead Ops sounds:', i, '/', len(aliases), flush=True)
manifest = dict(format='bo1-dead-ops-v1', game='black-ops', engine='dead-ops', entities=entities, arenas=arenas,
                weapons=weapons, models=models, actorHeads=dict(quad='c_zom_quad_head'), pickups=pickups, animations=animations, variables=variables, sounds=sounds)
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
prepare_fidelity.GAME = GAME
effects = {}
for name in ['misc/fx_zombie_powerup_on_zt', 'misc/fx_zombie_powerup_on_silver_zt', 'misc/fx_zombie_powerup_on_red_zt',
             'explosions/fx_grenadeexp_concrete', 'explosions/fx_grenade_flash']:
    p = find('web-fx/'+name+'.json')
    if p:
        effect = prepare_fidelity.load_effect(p, ZONES, effect_blending='grenade' in name)
        effects[name] = effect
def image_url(name):
    p = find('images/'+name+'.dds')
    return '/data/'+p.relative_to(DATA).as_posix() if p else None
gore = dict(burst=image_url('fxt_bio_bloodburst'),drops=image_url('fxt_bio_blooddrops'),
            decals=[image_url('~-gblood_spatter0'+str(i)+'_col') for i in range(1,4)])
if not gore['burst'] or not gore['drops'] or not all(gore['decals']): gore = None
(OUT/'presentation.json').write_text(json.dumps(dict(effects=effects,gore=gore),separators=(',',':')))
print(json.dumps(dict(arenas=len(arenas),weapons=len(weapons),sounds=len(sounds),animations=animations),indent=2))
