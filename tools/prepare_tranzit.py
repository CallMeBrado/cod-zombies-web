"""Prepare TranZit's original T6 assets and script-derived map rules on E:."""
from pathlib import Path
from collections import defaultdict
import csv, json, re, subprocess, shutil
from PIL import Image
from inspect_game import parse_entities
from prepare_fidelity import animation, load_effect

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'local-data'
SEARCH=['bo2-tranzit-patch','bo2-tranzit-classic','bo2-tranzit','bo2-tranzit-english',
        *['bo2-tranzit-'+p for p in ['busstation','diner','farm','powerstation','town','cornfield','forest','forest2','tunnel','labs','bridge']],
        'bo2-base','bo2-common','bo2-english','bo2-menu','bo2-ui-base','bo2-ui']
OUT=DATA/'gameplay/bo2-tranzit'; OUT.mkdir(parents=True,exist_ok=True)
def find(name): return next((DATA/z/name for z in SEARCH if (DATA/z/name).is_file()),None)

# TranZit's fastfiles omit the Fire Sale pickup. The shared browser rules
# enable it, so include BO2's original model/material/image from an owned map.
def prepare_shared_assets():
    groups=[('Fire Sale pickup',['model_export/zombie_firesale_lod0.glb','xmodel/zombie_firesale.json',
            'materials/specialty_firesale_zombies.json','images/specialty_firesale_zombies.dds']),
            ('Mustang & Sally empty putaway',['web-anims/viewmodel_m1911_dw_putaway_empty.json'])]
    for label,files in groups:
        if all(find(f) for f in files): continue
        source=next((DATA/z for z in ['bo2-nuketown','bo2-buried'] if all((DATA/z/f).is_file() for f in files)),None)
        if source is None: raise FileNotFoundError('Original BO2 '+label+' unavailable. Extract Buried first.')
        for name in files:
            if find(name): continue
            target=DATA/'bo2-common'/name; target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source/name,target)
        print('Prepared original BO2 '+label+' from '+source.name,flush=True)

prepare_shared_assets()
def point(e): return list(map(float,e['origin'].split()))
def write(name,value): (OUT/name).write_text(json.dumps(value,separators=(',',':')))
def weapon(name):
    p=find('weapons/'+name)
    if not p: raise RuntimeError('Missing native TranZit weapon: '+name)
    v=p.read_text().split('\\')
    return {k:float(n) if re.fullmatch(r'-?\d+(?:\.\d*)?',n) else n for k,n in zip(v[1::2],v[2::2])}
subprocess.run(['python','-B',str(ROOT/'tools/prepare_bo2_world.py'),'--zone','bo2-tranzit','--asset','zm_transit','--search',','.join(SEARCH)],cwd=ROOT,check=True)
original=parse_entities(DATA/'bo2-tranzit/maps/mp/zm_transit.d3dbsp.ents')
# Survival/Grief/unused race rows occupy the same world, but their objects
# and spawn points must never appear in classic TranZit.
E=[dict(e) for e in original if (not e.get('script_gameobjectname') or e['script_gameobjectname']=='zclassic')
   and (e.get('targetname')!='initial_spawn_points' or 'zclassic_transit' in e.get('script_string',''))
   and (e.get('targetname')!='zm_perk_machine' or 'zclassic_perks_transit' in e.get('script_string',''))
   and (e.get('targetname')!='weapon_upgrade' or not e.get('script_string') or 'zclassic' in e['script_string'])]
C=json.loads((DATA/'bo2-tranzit/web-world/zm_transit.collision.json').read_text())
script=(DATA/'bo2-tranzit-scripts/t6/maps/mp/zm_transit.gsc').read_text()
registry={n:(up,int(cost)) for n,up,cost in re.findall(r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,\s*"([^"\n]*)"\s*,\s*[^,\n]+,\s*(\d+)',script)}
unsupported={'knife_zm','fivesevendw_zm','knife_ballistic_zm','knife_ballistic_bowie_zm','knife_ballistic_no_melee_zm','cymbal_monkey_zm','claymore_zm','frag_grenade_zm','sticky_grenade_zm','emp_grenade_zm','tazer_knuckles_zm','jetgun_zm','riotshield_zm','screecher_arms_zm'}
included=re.findall(r'include_weapon\(\s*"([^"]+)"\s*(?:,\s*(\d+))?',script)
box=[n for n,flag in included if flag!='0' and n not in unsupported and find('weapons/'+n)]
base={n for n in registry if n not in unsupported and find('weapons/'+n)}
names=base|{registry[n][0] for n in base if registry[n][0] and find('weapons/'+registry[n][0])}
W={n:weapon(n) for n in sorted(names)}; knife=weapon('knife_zm')
arms=['c_zom_oldman_viewhands','c_zom_reporter_viewhands','c_zom_farmgirl_viewhands','c_zom_engineer_viewhands']
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
    'specialty_rof':'zombie_perk_bottle_doubletap','specialty_quickrevive':'zombie_perk_bottle_revive','specialty_longersprint':'zombie_perk_bottle_marathon',
    'zombie_builder':'zombie_builder_zm','knuckle_crack':'zombie_knuckle_crack'}.items() if find('weapons/'+n)}
if 'death_throe' in gestures: gestures['death_throe']['gunModel']='viewmodel_usa_no_model'
for e in list(E):
    if 'MagicBox' in e.get('classname',''):
        e.update(classname='script_model',model='p6_anim_zm_magic_box',targetname=e['script_noteworthy'].replace('_zbarrier',''))
    if e.get('targetname')=='treasure_chest_use': e['target']=e['script_noteworthy']
    if e.get('targetname','').endswith('_spawners') and any(n in e.get('script_noteworthy','').split() for n in ['riser_location','spawn_location']):
        e.update(nativeNoteworthy='riser_location' if 'riser_location' in e['script_noteworthy'] else 'spawn_location',script_noteworthy='zombie_spawner')
    if e.get('targetname')=='zm_perk_machine':
        key='tranzit_machine_'+e['script_noteworthy'];native=dict(e)
        E.append(dict(native,classname='script_model',targetname=key))
        e.update(classname='script_struct',targetname='zombie_vending_upgrade' if e['script_noteworthy']=='specialty_weapupgrade' else 'zombie_vending',target=key)
        e.pop('model',None)
    if e.get('targetname')=='powerswitch_buildable_trigger_power': e['targetname']='tranzit_power'
    if e.get('classname')=='script_vehicle': e['classname']='script_struct'
    if e.get('targetname','').startswith('buildable_'): e['tranzitBuilt']=e['targetname'].removeprefix('buildable_')
    if e.get('classname','').startswith('zbarrier') and 'MagicBox' not in e['classname']:
        if 'BusWindow' in e['classname']: e['classname']='script_struct'; continue
        for i in range(1,7):
            if e.get('zbarrierboardmodel'+str(i)):
                E.append(dict(classname='script_model',targetname=e['targetname'],model=e['zbarrierboardmodel'+str(i)],origin=e['origin'],angles=e.get('angles','0 0 0'),closedAnim=e['zbarrierboardanim'+str(i)],nativeBoard=str(i)))
    if e.get('targetname')=='weapon_upgrade':
        n=e['zombie_weapon_upgrade']; cost=registry.get(n,('',250 if n=='sticky_grenade_zm' else 1000))[1]
        e.update(zombie_cost=str(cost),script_ammo_clip=str(cost//2))
    if e.get('targetname') in ['tazer_upgrade','bowie_upgrade']:
        e.update(targetname='weapon_upgrade',zombie_weapon_upgrade='tazer_knuckles_zm' if e['targetname']=='tazer_upgrade' else 'bowie_knife_zm',zombie_cost='6000' if e['targetname']=='tazer_upgrade' else '3000')
    if e.get('targetname')=='bowie_upgrade':e.update(targetname='weapon_upgrade',zombie_weapon_upgrade='bowie_knife_zm',zombie_cost='3000')
    if e.get('targetname')=='claymore_purchase':e.update(targetname='weapon_upgrade',zombie_weapon_upgrade='claymore_zm',zombie_cost='1000')

volumes=[]
for e in E:
    if e.get('script_noteworthy')!='player_volume': continue
    origin=point(e); hulls=[]
    for i in C['models'][int(e['model'][1:])]['brushes']:
        b=C['brushes'][i]; hulls.append(dict(mins=[v+origin[k] for k,v in enumerate(b['mins'])],maxs=[v+origin[k] for k,v in enumerate(b['maxs'])],planes=[[*p[:3],p[3]+sum(p[k]*origin[k] for k in range(3))] for p in b['planes']]))
    volumes.append(dict(name=e['targetname'],spawners=e.get('target',e['targetname']+'_spawners'),hulls=hulls))
def hulls(e):
    origin=point(e)
    return [dict(mins=[v+origin[k] for k,v in enumerate(C['brushes'][i]['mins'])],maxs=[v+origin[k] for k,v in enumerate(C['brushes'][i]['maxs'])],
                 planes=[[*p[:3],p[3]+sum(p[k]*origin[k] for k in range(3))] for p in C['brushes'][i]['planes']])
            for i in C['models'][int(e['model'][1:])]['brushes']]
hazards=[dict(origin=point(e),hulls=hulls(e)) for e in E if e.get('targetname')=='lava_damage' and e.get('model','').startswith('*')]
fogVolumes=[dict(origin=point(e),hulls=hulls(e)) for e in E if e.get('targetname')=='screecher_volume' and e.get('model','').startswith('*')]
route=[];node=next(e for e in original if e.get('targetname')=='BUS_START');seen=set()
while node and node.get('targetname') not in seen:
    seen.add(node['targetname']);route.append(dict(position=point(node),yaw=float(node['angles'].split()[1]) if node.get('angles') else None,
        speed=float(node.get('speed',19))*17.6,stop=node.get('script_noteworthy') if node.get('script_notify')=='reached_stop_point' else None))
    node=next((e for e in original if e.get('targetname')==node.get('target') and e.get('classname','').startswith('info_vehicle')),None)
if node is None or len(route)<100:raise RuntimeError('Incomplete native bus loop')
equipment={'turbine':dict(name='Turbine',model='p6_anim_zm_buildable_turbine',animation='o_zombie_buildable_turbine_fullpower',health=1200,parts=3),
           'powerswitch':dict(name='Power switch',model='p6_zm_buildable_pswitch_body',health=1,parts=3),
           'pap':dict(name='Pack-a-Punch',model='p6_anim_zm_buildable_pap',health=1,parts=3),
           'riotshield_zm':dict(name='Zombie Shield',model='t6_wpn_zmb_shield_world',health=15,parts=2),
           'turret':dict(name='Turret',model='p6_anim_zm_buildable_turret',health=1200,parts=3),
           'electric_trap':dict(name='Electric Trap',model='p6_anim_zm_buildable_etrap',health=1200,parts=3),
           'cattlecatcher':dict(name='Bus plow',model='veh_t6_civ_bus_zombie_cow_catcher',health=1,parts=1),
           'bushatch':dict(name='Roof hatch',model='veh_t6_civ_bus_zombie_roof_hatch',health=1,parts=1),
           'busladder':dict(name='Bus ladder',model='com_stepladder_large_closed',health=1,parts=1)}
# One native candidate per part each game. Shared battery rows belong to the
# bench indicated by claim_location, rather than appearing as duplicate pickups.
partGroups={}
for e in list(E):
    kind=next((k for k in equipment if e.get('classname')=='script_struct' and e.get('targetname','').startswith(k+'_') and e.get('model')),None)
    if not kind:continue
    if e.get('model')=='p6_zm_buildable_battery':kind='electric_trap' if e.get('claim_location')=='etrap_battery' else 'pap'
    group=kind+':'+e['model'];key='tranzit_part_'+str(len(partGroups.setdefault(group,[])))+'_'+str(E.index(e))
    partGroups[group].append(key);e.update(classname='script_model',targetname=key,tranzitPart=kind,partModel=e['model'],partGroup=group,itemId=key)
for e in E:
    kind=next((k for k in equipment if e.get('targetname')==k+'_buildable_trigger'),None)
    if kind:e['tranzitBench']=kind
    if e.get('targetname')=='bus_driver_head':e['classname']='script_struct'
    if e.get('targetname') in ['powerswitch_p6_zm_buildable_pswitch_body','powerswitch_p6_zm_buildable_pswitch_hand','powerswitch_p6_zm_buildable_pswitch_lever'] and e.get('classname')=='script_model':e['tranzitBuilt']='powerswitch'
# Native negotiation endpoints also define the window crossings.
nodes=json.loads((DATA/'bo2-tranzit/web-world/zm_transit.paths.json').read_text())['nodes']
for i,n in enumerate(nodes):
    if n['type']!=17:continue
    end=next((nodes[l['node']] for l in n['links'] if l['negotiation']),None)
    if end:
        key='tranzit_traverse_'+str(i)
        E.extend([dict(classname='script_struct',targetname='traverse',target=key,origin=' '.join(map(str,[*n['origin'][:2],n['origin'][2]-16])),angles='0 '+str(n['angle'])+' 0'),dict(classname='script_struct',targetname=key,origin=' '.join(map(str,[*end['origin'][:2],end['origin'][2]-16])))])
goals={}
for e in E:
    if e.get('targetname')!='exterior_goal':continue
    crossing=min((x for x in E if x.get('targetname')=='traverse'),key=lambda x:sum((a-b)**2 for a,b in zip(point(x),point(e))))
    end=point(next(x for x in E if x.get('targetname')==crossing['target']))
    zone=min(volumes,key=lambda v:min(sum(max(h['mins'][k]-end[k],0,end[k]-h['maxs'][k])**2 for k in range(3)) for h in v['hulls']))
    goals[e['target']]=dict(zone=zone['name'],spawners=zone['spawners'])
animations={}
for z in reversed(SEARCH):
    for p in (DATA/z/'web-anims').glob('ai_zombie_*.json'):
        if re.match(r'ai_zombie_(?:walk_v|run_v|sprint_v|attack_v|attack_forward_v|walk_attack_v|run_attack_v|idle_v|traverse_v|traverse_garage|jump_|traverse_ground_(?:v1_walk|v1_run|climbout_fast)$|door_tear)',p.stem): animations[p.stem]=animation(z,p.stem)
idle=find('web-anims/ai_zombie_idle_v1_delta.json')
if idle:
    (DATA/'bo2-tranzit/web-anims/ai_zombie_idle_v1.json').write_bytes(idle.read_bytes()); animations['ai_zombie_idle_v1']=animation('bo2-tranzit','ai_zombie_idle_v1')
specialClips={'denizen':{'ai_zombie_walk_v1':'ai_zombie_screecher_run','ai_zombie_run_v2':'ai_zombie_screecher_run','ai_zombie_attack_v1':'ai_zombie_screecher_headpull','ai_zombie_death_v1':'ai_zombie_screecher_death_v1'},
              'avogadro':{'ai_zombie_walk_v1':'ai_zombie_avogadro_walk_v1','ai_zombie_attack_v1':'ai_zombie_avogadro_walk_v1_twitch'}}
for clips in specialClips.values():
    for name in clips.values():
        p=find('web-anims/'+name+'.json')
        if p:animations[name]=animation(p.relative_to(DATA).parts[0],name)
presentation=dict(animations=animations,effects={},actors=dict(body='c_zom_zombie2_body01',head='c_zom_zombie_head_k'),powerups=dict(full_ammo='zombie_ammocan',insta_kill='zombie_skull',double_points='zombie_x2_icon',nuke='zombie_bomb',carpenter='zombie_carpenter',fire_sale='zombie_firesale'),box=dict(openAngle=105,openTime=.5,floatHeight=40,riseTime=3,offerTime=12,closeTime=.5,cooldown=3,teddyModel='zombie_teddybear',cycleDelays=[.05]*20+[.1]*10+[.2]*5+[.3]*3))
presentation['actorVariants']={'denizen':dict(body='c_zom_screecher_fb',count=4,animations=specialClips['denizen']),
    'avogadro':dict(body='c_zom_zombie2_body01',head='c_zom_zombie_head_k',count=1,tint=[.1,.75,1],opacity=.6,animations=specialClips['avogadro'])}
for z in reversed(SEARCH):
    for p in (DATA/z/'web-fx').rglob('*.json'):
        # Common combat and map-specific perk landing/riser effects.
        if not re.search(r'powerup|grenade|blood|wall_buy|transit|perk|pap|raygun|ray_gun|magicbox|sun_sm_short|screecher|avog|electric',str(p)): continue
        fx=load_effect(p,SEARCH,effect_blending=True)
        if 'grenadeexp_concrete' in fx['name']: fx['name']='explosions/grenadeexp_concrete'
        presentation['effects'][fx['name']]=fx
hud=OUT/'hud'; hud.mkdir(exist_ok=True)
art=['overlay_low_health','hit_direction_zm','menu_zm_transit_zclassic_transit','menu_zm_map_transit_large','hud_us_grenade','scorebar_zom_5','specialty_juggernaut_zombies','specialty_fastreload_zombies','specialty_doubletap_zombies','specialty_quickrevive_zombies','specialty_marathon_zombies',*[f'chalkmarks_{i}' for i in range(1,6)]]
for n in art:
    p=find('images/'+n+'.dds')
    if p:
        with Image.open(p) as img: img.convert('RGBA').save(hud/(n+'.png'))
poster=next((hud/(n+'.png') for n in ['menu_zm_transit_zclassic_transit','menu_zm_map_transit_large'] if (hud/(n+'.png')).exists()),None)
if poster: (hud/'tranzit-load.png').write_bytes(poster.read_bytes())
else: raise RuntimeError('Missing original TranZit loading art')
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
remap.update(mx_zombie_wave_1='mus_transit_underscore',mx_stamin_sting='mus_perks_stamin_sting',zmb_bus_horn='zmb_bus_horn_warn',zmb_bus_engine_loop='zmb_bus_exterior_loop')
required.update(remap.values()); required.update(['mus_zombie_game_over','mus_fire_sale'])
sounds={}
for n,rows in aliases.items():
    if n not in required and not re.match(r'(zmb_|zombie_|evt_|mus_perks|vox_ann_|vox_bus_|fly_step_|wpn_knife|wpn_grenade)',n): continue
    unique=list({r['url']:r for r in rows}.values()); sounds[n]=unique[:12] if re.match(r'zmb_vocals_|fly_step_',n) else rows[:2]
for n,native in remap.items():
    if native in aliases: sounds[n]=aliases[native][:2]
voice={n:rows[:1] for n,rows in aliases.items() if re.match(r'vox_plr_[0-3]_(?:ammo_low|ammo_out|level_start|nomoney|revive_down|revive_up|perk_|powerup_|kill_|wpck_).*_[01]$',n)}
def gore_texture(n):
    p=find('materials/'+n+'.json'); image=next(t['image'] for t in json.loads(p.read_text())['textures'] if t['semantic']=='colorMap')
    return '/data/'+find('images/'+image.lstrip(',')+'.dds').relative_to(DATA).as_posix()
presentation['gore']=dict(neckModel='c_zom_zombie2_body01_g_behead',neckMount='body',headSound='zmb_zombie_head_gib',burst=gore_texture('gfx_fxt_bio_bloodburst'),drops=gore_texture('gfx_fxt_bio_blooddrops'),decals=[gore_texture('wc/gfx_impact_blood_spatter%02d'%n) for n in [1,2,3]])
variables=json.loads((DATA/'gameplay/bo2-buried/manifest.json').read_text())['variables'].copy()
manifest=dict(format='bo2-tranzit-solo-v1',game='black-ops-2',startWeapon='m1911_zm',variables=variables,weapons=W,grenade=grenade,gestures=gestures,entities=E,sounds=sounds,voice=voice,characterNames=['Russman','Stuhlinger','Misty','Marlton'],characterArms=arms,
    playerBodies=[dict(body='c_zom_player_'+n+'_fb') for n in ['oldman','reporter','farmgirl','engineer']],weaponNames={n:n.replace('_upgraded_zm',' (Pack-a-Punch)').replace('_zm','').replace('_',' ').upper() for n in W},
    map=dict(id='tranzit',initialZone='zone_pri',initialZones=['zone_pri','zone_station_ext','zone_tow','zone_far','zone_pow',*[f'zone_trans_{i}' for i in range(1,12)],'zone_amb_tunnel','zone_amb_forest','zone_amb_cornfield','zone_amb_power2town','zone_amb_bridge'],
       connections=re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"',script),volumes=volumes,goals=goals,negotiationBegin=17,negotiationEnd=18,initialBox='start_chest',boxWeapons=sorted(set(box)),boxMoves=True,boxExclusive=[['ray_gun_zm','raygun_mark2_zm']],powerTargets=[],initialDisabled=['bus_door_blocker'],openRisers=True,fallDeathZ=-1700,
       bus=dict(model='veh_t6_civ_bus_zombie',driver='p6_anim_zm_bus_driver',route=route,waitMin=40,waitMax=180,originZOffset=-28),hazards=hazards,fogVolumes=fogVolumes,partGroups=partGroups,
       propModels=['veh_t6_civ_bus_zombie','p6_anim_zm_bus_driver','p6_anim_zm_magic_box_fake','zombie_teddybear'],propAnimations=['ai_zombie_bus_driver_idle',*['o_zombie_magic_box_'+n for n in ['open','close','arrive','leave']]],
       boxClips={n:max(1,json.loads(find('web-anims/o_zombie_magic_box_'+n+'.json').read_text())['frames'])/json.loads(find('web-anims/o_zombie_magic_box_'+n+'.json').read_text())['fps'] for n in ['open','close','arrive','leave']}),
    wallCosts={n:c for n,(_,c) in registry.items()},meleeUpgrades={n:weapon(n) for n in ['bowie_knife_zm','tazer_knuckles_zm']},equipment=equipment,
    playerAnimations=sorted({p.stem for z in SEARCH for p in (DATA/z/'web-anims').glob('pb_*.json') if re.match(r'pb_(?:stand_alert|stand_ads|sprint|combatrun|combatwalk|crouch_alert|crouch_run|prone_aim|prone_crawl|dive_prone|laststand)',p.stem)}),
    provenance=dict(world='maps/mp/zm_transit.d3dbsp',rules='owned decompiled zm_transit*.gsc',runtime='shared T6 browser reconstruction'))
traversals={}
nodes=json.loads((DATA/'bo2-tranzit/web-world/zm_transit.paths.json').read_text())['nodes']
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
print(json.dumps(dict(entities=len(E),weapons=len(W),volumes=len(volumes),barriers=len(goals),busNodes=len(route),partGroups=len(partGroups),sounds=len(sounds))))
