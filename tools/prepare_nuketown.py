"""Prepare Nuketown's original T6 assets and script-derived map rules on E:."""
from pathlib import Path
from collections import defaultdict
import csv, json, re, subprocess
from PIL import Image
from inspect_game import parse_entities
from prepare_fidelity import animation, load_effect

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'local-data'
SEARCH=['bo2-nuketown-patch','bo2-nuketown','bo2-nuketown-english','bo2-base','bo2-common','bo2-english','bo2-menu','bo2-ui-base','bo2-ui']
OUT=DATA/'gameplay/bo2-nuketown'; OUT.mkdir(parents=True,exist_ok=True)
def find(name): return next((DATA/z/name for z in SEARCH if (DATA/z/name).is_file()),None)
def point(e): return list(map(float,e['origin'].split()))
def write(name,value): (OUT/name).write_text(json.dumps(value,separators=(',',':')))
def weapon(name):
    p=find('weapons/'+name)
    if not p: raise RuntimeError('Missing native Nuketown weapon: '+name)
    v=p.read_text().split('\\')
    return {k:float(n) if re.fullmatch(r'-?\d+(?:\.\d*)?',n) else n for k,n in zip(v[1::2],v[2::2])}
subprocess.run(['python','-B',str(ROOT/'tools/prepare_bo2_world.py'),'--zone','bo2-nuketown','--asset','zm_nuked','--search',','.join(SEARCH)],cwd=ROOT,check=True)
E=parse_entities(DATA/'bo2-nuketown/maps/mp/zm_nuked.d3dbsp.ents')
C=json.loads((DATA/'bo2-nuketown/web-world/zm_nuked.collision.json').read_text())
script=(DATA/'bo2-nuketown-scripts/t6/maps/mp/zm_nuked.gsc').read_text()
registry={n:(up,int(cost)) for n,up,cost in re.findall(r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,\s*"([^"\n]*)"\s*,\s*[^,\n]+,\s*(\d+)',script)}
unsupported={'knife_zm','fivesevendw_zm','knife_ballistic_zm','knife_ballistic_bowie_zm','knife_ballistic_no_melee_zm','cymbal_monkey_zm','claymore_zm','frag_grenade_zm','sticky_grenade_zm','tazer_knuckles_zm'}
included=re.findall(r'include_weapon\(\s*"([^"]+)"\s*(?:,\s*(\d+))?',script)
box=[n for n,flag in included if flag!='0' and n not in unsupported and find('weapons/'+n)]
base={n for n in registry if n not in unsupported and find('weapons/'+n)}
names=base|{registry[n][0] for n in base if registry[n][0] and find('weapons/'+registry[n][0])}
W={n:weapon(n) for n in sorted(names)}; knife=weapon('knife_zm')
arms=['c_zom_suit_viewhands','c_zom_hazmat_viewhands_light']*2
for n,w in W.items():
    if n.startswith(('ray_gun','raygun_mark2')): w['startAmmo']+=w['clipSize']
    else: w['startAmmo']=(w['startAmmo']+1)*w['clipSize']; w['maxAmmo']*=w['clipSize']
    w.update(handsModel=arms[0],knifeModel=knife['gunModel'],meleeSwipeSoundPlayer='wpn_knife_pull_plr')
    for k in ['meleeAnim','meleeChargeAnim','meleeDamage','meleeDelay','meleeChargeDelay','meleeTime','meleeChargeTime','meleeChargeRange']: w[k]=knife[k]
    for k,f in [('lastShotAnim','fireAnim'),('adsFireAnim','fireAnim'),('adsLastShotAnim','lastShotAnim'),('emptyIdleAnim','idleAnim')]:
        if not w.get(k): w[k]=w.get(f,'')
    if registry.get(n,('',0))[0] in W: w['upgrade']=registry[n][0]
    if not w.get('locHead'): w['locHead']=1
grenade=weapon('frag_grenade_zm'); grenade['handsModel']=arms[0]
gestures={k:dict(weapon(n),name=n,handsModel=arms[0]) for k,n in {
    'death_throe':'death_throe_zm','specialty_armorvest':'zombie_perk_bottle_jugg','specialty_fastreload':'zombie_perk_bottle_sleight',
    'specialty_rof':'zombie_perk_bottle_doubletap','specialty_quickrevive':'zombie_perk_bottle_revive','knuckle_crack':'zombie_knuckle_crack'}.items() if find('weapons/'+n)}
if 'death_throe' in gestures: gestures['death_throe']['gunModel']='viewmodel_usa_no_model'
for e in list(E):
    if 'MagicBox' in e.get('classname',''):
        e.update(classname='script_model',model='p6_anim_zm_magic_box',targetname=e['script_noteworthy'].replace('_zbarrier',''))
    if e.get('targetname')=='treasure_chest_use': e['target']=e['script_noteworthy']
    if e.get('targetname','').endswith('_spawners') and e.get('script_noteworthy')=='riser_location':
        e.update(nativeNoteworthy='riser_location',script_noteworthy='zombie_spawner')
    if e.get('targetname')=='weapon_upgrade':
        n=e['zombie_weapon_upgrade']; cost=registry.get(n,('',250 if n=='sticky_grenade_zm' else 1000))[1]
        e.update(zombie_cost=str(cost),script_ammo_clip=str(cost//2))
    if e.get('targetname') in ['tazer_upgrade','bowie_upgrade']:
        e.update(targetname='weapon_upgrade',zombie_weapon_upgrade='tazer_knuckles_zm' if e['targetname']=='tazer_upgrade' else 'bowie_knife_zm',zombie_cost='6000' if e['targetname']=='tazer_upgrade' else '3000')
    # Deleted by fake_lighting_cleanup() and moved by scripts, never props.
    if e.get('targetname')=='nuke_reflection': e['classname']='script_struct'

volumes=[]
for e in E:
    if e.get('script_noteworthy')!='player_volume': continue
    origin=point(e); hulls=[]
    for i in C['models'][int(e['model'][1:])]['brushes']:
        b=C['brushes'][i]; hulls.append(dict(mins=[v+origin[k] for k,v in enumerate(b['mins'])],maxs=[v+origin[k] for k,v in enumerate(b['maxs'])],planes=[[*p[:3],p[3]+sum(p[k]*origin[k] for k in range(3))] for p in b['planes']]))
    volumes.append(dict(name=e['targetname'],spawners=e.get('target',e['targetname']+'_spawners'),hulls=hulls))
landings=[]
for mark in E:
    if mark.get('script_noteworthy')!='zm_random_machine': continue
    at=next(e for e in E if e.get('targetname')==mark['target']); path=[]
    node=next((e for e in E if e.get('targetname')=='perk_arrival_path_'+mark['script_int']),None); seen=set()
    while node and node.get('targetname') not in seen:
        seen.add(node.get('targetname')); path.append(dict(position=point(node),speed=float(node.get('speed',60))))
        node=next((e for e in E if e.get('targetname')==node.get('target')),None) if node.get('target') else None
    landings.append(dict(id=int(mark['script_int']),origin=point(at),angles=at.get('angles','0 0 0'),blocker=at.get('target'),soloRevive=mark.get('targetname')=='solo_revive',path=path))
machines=[('specialty_quickrevive','zombie_vending_revive_on'),('specialty_fastreload','zombie_vending_sleight_on'),('specialty_rof','zombie_vending_doubletap2_on'),('specialty_armorvest','zombie_vending_jugg_on'),('specialty_weapupgrade','p6_anim_zm_buildable_pap_on')]
for i,(perk,m) in enumerate(machines):
    at=landings[i]; key='nuketown_machine_'+str(i)
    E.append(dict(classname='script_model',targetname=key,model=m,origin=' '.join(map(str,at['origin'])),angles=at['angles'],nuketownMachine=perk))
    E.append(dict(classname='script_struct',targetname='zombie_vending_upgrade' if i==4 else 'zombie_vending',target=key,origin=' '.join(map(str,[*at['origin'][:2],at['origin'][2]+35])),angles=at['angles'],script_noteworthy=perk))
animations={}
for z in reversed(SEARCH):
    for p in (DATA/z/'web-anims').glob('ai_zombie_*.json'):
        if re.match(r'ai_zombie_(?:walk_v|run_v|sprint_v|attack_v|attack_forward_v|walk_attack_v|run_attack_v|idle_v|traverse_v|traverse_garage|jump_|traverse_ground_(?:v1_walk|v1_run|climbout_fast)$|door_tear)',p.stem): animations[p.stem]=animation(z,p.stem)
idle=find('web-anims/ai_zombie_idle_v1_delta.json')
if idle:
    (DATA/'bo2-nuketown/web-anims/ai_zombie_idle_v1.json').write_bytes(idle.read_bytes()); animations['ai_zombie_idle_v1']=animation('bo2-nuketown','ai_zombie_idle_v1')
presentation=dict(animations=animations,effects={},actors=dict(body='c_zom_dlc0_zom_haz_body1',head='c_zom_dlc0_zom_head1'),powerups=dict(full_ammo='zombie_ammocan',insta_kill='zombie_skull',double_points='zombie_x2_icon',nuke='zombie_bomb',fire_sale='zombie_firesale'),box=dict(openAngle=105,openTime=.5,floatHeight=40,riseTime=3,offerTime=12,closeTime=.5,cooldown=3,cycleDelays=[.05]*20+[.1]*10+[.2]*5+[.3]*3))
for z in reversed(SEARCH):
    for p in (DATA/z/'web-fx').rglob('*.json'):
        # Common combat and map-specific perk landing/riser effects.
        if not re.search(r'powerup|grenade|blood|wall_buy|nuked|perk|pap|raygun|ray_gun|magicbox|sun_sm_short',str(p)): continue
        fx=load_effect(p,SEARCH,effect_blending=True)
        if 'grenadeexp_concrete' in fx['name']: fx['name']='explosions/grenadeexp_concrete'
        presentation['effects'][fx['name']]=fx
hud=OUT/'hud'; hud.mkdir(exist_ok=True)
art=['overlay_low_health','hit_direction_zm','loadscreen_zm_nuked','loadscreen_nuketown','loadscreen_nuked','menu_zm_nuketown_select','menu_zm_map_nuked','menu_zm_map_nuked_large','hud_us_grenade','scorebar_zom_5','specialty_juggernaut_zombies','specialty_fastreload_zombies','specialty_doubletap_zombies','specialty_quickrevive_zombies',*[f'chalkmarks_{i}' for i in range(1,6)]]
for n in art:
    p=find('images/'+n+'.dds')
    if p:
        with Image.open(p) as img: img.convert('RGBA').save(hud/(n+'.png'))
poster=next((hud/(n+'.png') for n in ['loadscreen_zm_nuked','loadscreen_nuketown','loadscreen_nuked','menu_zm_nuketown_select','menu_zm_map_nuked_large','menu_zm_map_nuked'] if (hud/(n+'.png')).exists()),None)
if poster: (hud/'nuketown-load.png').write_bytes(poster.read_bytes())
else: raise RuntimeError('Missing original Nuketown loading art')
def sound_hash(n):
    v=5381
    for c in n.lower(): v=(ord(c)+0x1003f*v)&0xffffffff
    return '@'+format(v,'08x')
aliases={}
for z in reversed(SEARCH):
    for p in (DATA/z/'soundbank').glob('*.aliases.csv'):
        groups=defaultdict(list)
        for row in csv.DictReader(p.open()):
            relative=row['FileSource'].replace('\\','/').removeprefix('raw/'); f=find(relative) or find(relative+'.wav') or find(relative+'.flac')
            if f: groups[row['Name']].append(dict(url='/data/'+f.relative_to(DATA).as_posix(),volume=min(1,float(row['VolMax'] or 100)/100),pitch=2**(float(row['PitchMax'] or 0)/1200)))
        aliases.update(groups)
hashes={sound_hash(n):n for n in aliases}; required=set()
for w in [*W.values(),grenade,*gestures.values()]:
    for k,v in list(w.items()):
        if 'Sound' in k and isinstance(v,str) and v.startswith('@'): w[k]=hashes.get(v,v)
    w['notetrackSoundMap']='\n'.join(' '.join(hashes.get(t,t) for t in line.split()) for line in str(w.get('notetrackSoundMap','')).splitlines())
    required.update(v for k,v in w.items() if 'Sound' in k and isinstance(v,str) and v in aliases)
    required.update(line.split()[-1] for line in w['notetrackSoundMap'].splitlines() if line.strip())
    for k,v in w.items():
        p=find('web-anims/'+v+'.json') if k.endswith('Anim') and isinstance(v,str) and v else None
        if p: required.update(n['name'][6:] for n in json.loads(p.read_text()).get('notifies',[]) if n['name'].startswith('sndnt#'))
remap=dict(mx_splash_screen='mus_zombie_splash_screen',mx_zombie_wave_1='mus_nuked_underscore',chalk='mus_zombie_round_start',round_over='mus_zombie_round_over',cha_ching='zmb_cha_ching',no_cha_ching='zmb_no_cha_ching',repair_boards='zmb_repair_boards',remove_boards='zmb_break_boards',grenade_explode='wpn_grenade_explode_default',grenade_explode_bass='wpn_grenade_explode_lfe',grenade_bounce_concrete='wpn_grenade_bounce_concrete',melee_hit='wpn_melee_knife_hit_body',lid_open='zmb_lid_open',lid_close='zmb_lid_close',music_box='zmb_music_box',spawn_powerup='zmb_spawn_powerup',spawn_powerup_loop='zmb_spawn_powerup_loop',powerup_grabbed='zmb_powerup_grabbed',full_ammo='zmb_full_ammo',insta_kill='zmb_insta_kill',double_point='zmb_points_loop',nuke='evt_nuked',mx_jugger_sting='mus_perks_jugganog_sting',mx_speed_sting='mus_perks_speed_sting',mx_doubletap_sting='mus_perks_doubletap_sting',mx_revive_sting='mus_perks_revive_sting',mx_packa_sting='mus_perks_packa_sting',perks_power_on='zmb_perks_power_on',packa_rollers_loop='zmb_perks_packa_loop',packa_weap_upgrade='zmb_perks_packa_upgrade',packa_weap_ready='zmb_perks_packa_ready',ticktock_loop='zmb_perks_packa_ticktock',packa_deny='zmb_perks_packa_deny')
required.update(remap.values()); required.update(['mus_zombie_game_over','mus_fire_sale','mus_fire_sale_rich'])
sounds={}
for n,rows in aliases.items():
    if n not in required and not re.match(r'(zmb_|zombie_|evt_|mus_perks|vox_ann_|fly_step_|wpn_knife|wpn_grenade)',n): continue
    unique=list({r['url']:r for r in rows}.values()); sounds[n]=unique[:12] if re.match(r'zmb_vocals_|fly_step_',n) else rows[:2]
for n,native in remap.items():
    if native in aliases: sounds[n]=aliases[native][:2]
def gore_texture(n):
    p=find('materials/'+n+'.json'); image=next(t['image'] for t in json.loads(p.read_text())['textures'] if t['semantic']=='colorMap')
    return '/data/'+find('images/'+image.lstrip(',')+'.dds').relative_to(DATA).as_posix()
presentation['gore']=dict(neckModel='c_zom_dlc0_zom_haz_body1_behead',neckMount='body',headSound='zmb_zombie_head_gib',burst=gore_texture('gfx_fxt_bio_bloodburst'),drops=gore_texture('gfx_fxt_bio_blooddrops'),decals=[gore_texture('wc/gfx_impact_blood_spatter%02d'%n) for n in [1,2,3]])
presentation['actorVariants']={'blue':dict(body=presentation['actors']['body'],head='c_zom_dlc0_zom_head1_blueeyes',neckModel=presentation['gore']['neckModel'],count=24,animations={n:n for n in animations})}
variables=json.loads((DATA/'gameplay/bo2-buried/manifest.json').read_text())['variables'].copy()
manifest=dict(format='bo2-nuketown-solo-v1',game='black-ops-2',startWeapon='m1911_zm',variables=variables,weapons=W,grenade=grenade,gestures=gestures,entities=E,sounds=sounds,voice={},characterNames=['CIA Agent','CDC Soldier','CIA Agent','CDC Soldier'],characterArms=arms,playerBodies=[dict(body=n) for n in ['c_zom_player_cia_fb','c_zom_player_cdc_fb']*2],weaponNames={n:n.replace('_upgraded_zm',' (Pack-a-Punch)').replace('_zm','').replace('_',' ').upper() for n in W},map=dict(id='nuketown',initialZone='culdesac_yellow_zone',initialZones=['culdesac_yellow_zone','culdesac_green_zone'],connections=re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"',script),volumes=volumes,goals={},negotiationBegin=17,negotiationEnd=18,initialBox='start_chest1',boxWeapons=sorted(set(box)),boxMoves=True,boxExclusive=[['ray_gun_zm','raygun_mark2_zm']],powerTargets=[],openRisers=True,perkLandings=landings,propModels=[m for _,m in machines]+['p6_anim_zm_magic_box_fake','zombie_teddybear'],propAnimations=['o_zombie_magic_box_'+n for n in ['open','close','arrive','leave']],boxClips={n:max(1,json.loads(find('web-anims/o_zombie_magic_box_'+n+'.json').read_text())['frames'])/json.loads(find('web-anims/o_zombie_magic_box_'+n+'.json').read_text())['fps'] for n in ['open','close','arrive','leave']}),wallCosts={n:c for n,(_,c) in registry.items()},meleeUpgrades={n:weapon(n) for n in ['bowie_knife_zm','tazer_knuckles_zm']},equipment={},playerAnimations=sorted({p.stem for z in SEARCH for p in (DATA/z/'web-anims').glob('pb_*.json') if re.match(r'pb_(?:stand_alert|stand_ads|sprint|combatrun|combatwalk|crouch_alert|crouch_run|prone_aim|prone_crawl|dive_prone|laststand)',p.stem)}),provenance=dict(world='maps/mp/zm_nuked.d3dbsp',rules='owned decompiled zm_nuked.gsc and zm_nuked_perks.gsc',runtime='shared T6 browser reconstruction'))
traversals={}
nodes=json.loads((DATA/'bo2-nuketown/web-world/zm_nuked.paths.json').read_text())['nodes']
for i,node in enumerate(nodes):
    if node['type']!=17: continue
    spec=next((e for e in E if e.get('classname')=='node_negotiation_begin' and e.get('target')==node['target'] and sum((a-b)**2 for a,b in zip(point(e),node['origin']))<1),None)
    if not spec: continue
    alias=spec.get('animscript','').removeprefix('zm_')
    name={'mantle_over_40':'ai_zombie_traverse_v1','traverse_garage_door':'ai_zombie_traverse_garage_roll','jump_up_to_climb':'ai_zombie_jump_up_2_climb'}.get(alias,'ai_zombie_'+alias)
    if name in animations: traversals[i]=dict(animation=name,arc=40 if alias=='mantle_over_40' else 12 if alias.startswith('jump_up') else 0)
manifest['map']['traversals']=traversals
manifest['map']['wallbuyEffects']={n:'maps/zombie/fx_zmb_wall_buy_'+fx for n,fx in {'m14_zm':'m14','rottweil72_zm':'olympia','870mcs_zm':'870mcs','m16_zm':'m16','mp5k_zm':'mp5k','ak74u_zm':'ak74u','beretta93r_zm':'berreta93r','bowie_knife_zm':'bowie'}.items()}
write('manifest.json',manifest); write('presentation.json',presentation)
print(json.dumps(dict(entities=len(E),risers=sum(e.get('script_noteworthy')=='zombie_spawner' for e in E),volumes=len(volumes),weapons=len(W),sounds=len(sounds),landings=len(landings))))
