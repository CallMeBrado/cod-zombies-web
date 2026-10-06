"""Prepare owned Buried T6 assets and script-derived gameplay data on E:."""
from pathlib import Path
from collections import defaultdict
import json,re,csv,math,subprocess,hashlib,struct
from PIL import Image
from inspect_game import parse_entities
from prepare_fidelity import animation,load_effect

ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'local-data'
SEARCH=['bo2-patch','bo2-classic','bo2-buried','bo2-base','bo2-common','bo2-english','bo2-dlc','bo2-menu','bo2-ui-base','bo2-ui']
OUTPUT=DATA/'gameplay/bo2-buried';OUTPUT.mkdir(parents=True,exist_ok=True)
SCRIPTS=DATA/'bo2-scripts/t6/maps/mp'
def find(relative):return next((DATA/z/relative for z in SEARCH if (DATA/z/relative).is_file()),None)
def script(name):return (SCRIPTS/(name+'.gsc')).read_text()
def weapon(name):
    p=find('weapons/'+name)
    if not p:raise RuntimeError('Missing owned T6 weapon: '+name)
    v=p.read_text().split('\\');values=dict(zip(v[1::2],v[2::2]))
    return {k:float(v) if re.fullmatch(r'-?\d+(?:\.\d*)?',v) else v for k,v in values.items()}
def point(e):return list(map(float,e['origin'].split()))
def distance(a,b):return sum((x-y)**2 for x,y in zip(a,b))
def write(name,value):(OUTPUT/name).write_text(json.dumps(value,separators=(',',':')))

subprocess.run(['python','-B',str(ROOT/'tools/prepare_bo2_world.py')],cwd=ROOT,check=True)
entities=parse_entities(DATA/'bo2-buried/maps/mp/zm_buried.d3dbsp.ents')
collision=json.loads((DATA/'bo2-buried/web-world/zm_buried.collision.json').read_text())
paths=json.loads((DATA/'bo2-buried/web-world/zm_buried.paths.json').read_text())
native_script=script('zm_buried')
# Grief-only spawn/weapon rows must not pollute the processing-room survival map.
entities=[e for e in entities if e.get('script_noteworthy')!='zgrief_street']
for i,node in enumerate(paths['nodes']):
    if node['type']!=17:continue
    end=next((paths['nodes'][l['node']] for l in node['links'] if l['negotiation']),None)
    if not end:continue
    key='buried_traverse_'+str(i)
    entities.extend([dict(classname='script_struct',targetname='traverse',target=key,origin=' '.join(map(str,[*node['origin'][:2],node['origin'][2]-16])),angles=f"0 {node['angle']} 0"),dict(classname='script_struct',targetname=key,origin=' '.join(map(str,[*end['origin'][:2],end['origin'][2]-16])))])
# Native T6 zbarriers own six separate animated board models. Adapt their
# placement, keeping their authored clips so boards finish in their repaired pose.
for barrier in [e for e in entities if e.get('classname','').startswith('zbarrier')]:
    if 'MagicBox' in barrier['classname']:
        barrier['classname']='script_model';barrier['model']='p6_anim_zm_magic_box'
        barrier['targetname']=barrier.get('script_noteworthy','').replace('_zbarrier','');continue
    if 'hide_pieces' in barrier['classname']:continue
    for i in range(1,7):
        if not barrier.get('zbarrierboardmodel'+str(i)):continue
        entities.append(dict(classname='script_model',targetname=barrier['targetname'],model=barrier['zbarrierboardmodel'+str(i)],origin=barrier['origin'],angles=barrier.get('angles','0 0 0'),closedAnim=barrier['zbarrierboardanim'+str(i)],nativeBoard=str(i)))
for e in entities:
    item=e.get('targetname','')
    if item in ['keys_zm_p6_zm_bu_sloth_key','booze_p6_zm_bu_booze','candy_p6_zm_bu_sloth_candy_bowl','chalk_p6_zm_bu_chalk']:
        e['itemId']='buried_item_'+str(entities.index(e));e['nativeItemTarget']=item
        e['targetname']=e['itemId'];e['classname']='script_model'
        if item=='chalk_p6_zm_bu_chalk':e['zombie_weapon_upgrade']=e['script_noteworthy']
    if e.get('targetname')=='use_elec_switch':e.update(nativeTargetname='use_elec_switch',targetname='use_power_switch')
    if e.get('targetname')=='elec_switch':e.update(nativeTargetname='elec_switch',targetname='power_switch')
    if e.get('targetname')=='zm_perk_machine':
        native=e['targetname'];tag='zombie_vending_upgrade' if e['script_noteworthy']=='specialty_weapupgrade' else 'zombie_vending'
        machine='buried_machine_'+str(len(entities))+e['script_noteworthy']
        entities.append(dict(e,classname='script_model',targetname=machine))
        e.update(nativeTargetname=native,targetname=tag,classname='script_struct',target=machine);e.pop('model',None)
    if e.get('targetname')=='treasure_chest_use':e['target']=e['script_noteworthy']
    if e.get('targetname','').endswith('_spawners') and e.get('script_noteworthy') in ['spawn_location','riser_location','faller_location']:
        e['nativeNoteworthy']=e['script_noteworthy'];e['script_noteworthy']='zombie_spawner'

equipment={
 'turbine':dict(name='Turbine',model='p6_anim_zm_buildable_turbine',animation='o_zombie_buildable_turbine_fullpower',health=1200,parts=3),
 'springpad_zm':dict(name='Trample Steam',model='p6_anim_zm_buildable_tramplesteam',animation='o_zombie_buildable_tramplesteam_compressed_idle',launchAnimation='o_zombie_buildable_tramplesteam_launch',health=1200,parts=4),
 'headchopper_zm':dict(name='Head Chopper',model='t6_wpn_zmb_chopper',animation='o_zmb_chopper_slice_slow',health=1200,parts=4),
 'subwoofer_zm':dict(name='Subsurface Resonator',model='t6_wpn_zmb_subwoofer',health=60,parts=4)}
for e in entities:
    kind=next((k for k in equipment if e.get('classname')=='script_struct' and e.get('targetname','').startswith(k+'_') and e.get('model')),None)
    if kind:e.update(classname='script_model',buriedPart=kind,itemId='buried_part_'+e['targetname'])
    if e.get('targetname')=='maze_blocker':e.update(classname='script_model',nativeMaze=e['script_noteworthy'],targetname='buried_maze_'+e['script_noteworthy'])
    if any(x.get('targetname')=='chalk_buildable_trigger' and x.get('target')==e.get('targetname') for x in entities):e['classname']='script_model';e['chalkMark']='1'

# The original hedge gate's rigid GLB bounds, restored from Y up to Z up.
gate=find('model_export/p6_zm_bu_hedge_gate_lod0.glb').read_bytes()
gate_json=json.loads(gate[20:20+struct.unpack_from('<I',gate,12)[0]])
a=next(a for a in gate_json['accessors'] if a.get('min') and a['type']=='VEC3')
lo,hi=a['min'],a['max'];bounds=([lo[0],-hi[2],lo[1]],[hi[0],-lo[2],hi[1]])
maze_hulls=[]
for e in entities:
    if not e.get('nativeMaze'):continue
    origin=point(e);yaw=math.radians(float(e.get('angles','0 0 0').split()[1]));co,si=math.cos(yaw),math.sin(yaw)
    corners=[(x*co-y*si+origin[0],x*si+y*co+origin[1],z+origin[2]) for x in [bounds[0][0],bounds[1][0]] for y in [bounds[0][1],bounds[1][1]] for z in [bounds[0][2],bounds[1][2]]]
    mins=[min(p[k] for p in corners) for k in range(3)];maxs=[max(p[k] for p in corners) for k in range(3)]
    maze_hulls.append(dict(mins=mins,maxs=maxs,target=e['targetname'],contents=1,planes=[]))

volumes=[]
for e in entities:
    if e.get('script_noteworthy')!='player_volume':continue
    origin=point(e);model=collision['models'][int(e['model'][1:])];hulls=[]
    for index in model['brushes']:
        b=collision['brushes'][index]
        hulls.append(dict(mins=[v+origin[k] for k,v in enumerate(b['mins'])],maxs=[v+origin[k] for k,v in enumerate(b['maxs'])],planes=[[*p[:3],p[3]+sum(p[k]*origin[k] for k in range(3))] for p in b['planes']]))
    if hulls:volumes.append(dict(name=e['targetname'],spawners=e.get('target',e['targetname']+'_spawners'),hulls=hulls))
def zone_at(p):
    return min(volumes,key=lambda v:min(sum(max(h['mins'][k]-p[k],0,p[k]-h['maxs'][k])**2 for k in range(3)) for h in v['hulls']))
goals={};traversals=[e for e in entities if e.get('targetname')=='traverse']
for e in entities:
    if e.get('targetname')!='exterior_goal':continue
    begin=min(traversals,key=lambda x:distance(point(x),point(e)));end=next(x for x in entities if x.get('targetname')==begin['target'])
    v=zone_at([*point(end)[:2],point(end)[2]+25]);goals[e['target']]=dict(zone=v['name'],spawners=v['spawners'])
connections=re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"',native_script)
registry={n:(upgrade,int(cost)) for n,upgrade,cost in re.findall(r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,\s*"([^"\n]*)"\s*,\s*[^,\n]+,\s*(\d+)',native_script)}
unsupported={'fivesevendw_zm','knife_ballistic_zm','knife_ballistic_bowie_zm','knife_ballistic_no_melee_zm','claymore_zm','cymbal_monkey_zm','frag_grenade_zm','tazer_knuckles_zm'}
base_names=[n for n in registry if n not in unsupported and find('weapons/'+n)]
names=set(base_names)|{registry[n][0] for n in base_names if find('weapons/'+registry[n][0])}
weapons={n:weapon(n) for n in sorted(names)};knife=weapon('knife_zm')
arms=['c_zom_oldman_viewhands','c_zom_reporter_viewhands','c_zom_farmgirl_viewhands','c_zom_engineer_viewhands']
for name,w in weapons.items():
    if name.startswith(('ray_gun','raygun_mark2')):w['startAmmo']+=w['clipSize']
    elif not name.startswith('slowgun'):w['startAmmo']=(w['startAmmo']+1)*w['clipSize'];w['maxAmmo']*=w['clipSize']
    w['handsModel']=arms[0];w['knifeModel']=knife['gunModel']
    for key in ['meleeAnim','meleeChargeAnim','meleeDamage','meleeDelay','meleeChargeDelay','meleeTime','meleeChargeTime','meleeChargeRange']:w[key]=knife[key]
    w['meleeSwipeSoundPlayer']='wpn_knife_pull_plr'
    for key,fallback in [('lastShotAnim','fireAnim'),('adsFireAnim','fireAnim'),('adsLastShotAnim','lastShotAnim'),('emptyIdleAnim','idleAnim')]:
        if not w.get(key):w[key]=w.get(fallback,'')
    upgrade=registry.get(name,('',0))[0]
    if upgrade in weapons:w['upgrade']=upgrade
    # T6 hashes sound references in weapon records. Resolve them below from
    # native alias names rather than inventing replacement weapon sounds.
    if not w.get('locHead'):w['locHead']=1
grenade=weapon('frag_grenade_zm');grenade['handsModel']=arms[0]
gesture_names={'specialty_armorvest':'zombie_perk_bottle_jugg','specialty_fastreload':'zombie_perk_bottle_sleight','specialty_rof':'zombie_perk_bottle_doubletap','specialty_quickrevive':'zombie_perk_bottle_revive','specialty_longersprint':'zombie_perk_bottle_marathon','specialty_additionalprimaryweapon':'zombie_perk_bottle_three_gun','specialty_nomotionsensor':'zombie_perk_bottle_vulture','knuckle_crack':'zombie_knuckle_crack'}
gestures={key:dict(weapon(name),name=name,handsModel=arms[0]) for key,name in gesture_names.items() if find('weapons/'+name)}
for e in entities:
    if e.get('targetname')=='weapon_upgrade':
        e['zombie_cost']=str(registry.get(e['zombie_weapon_upgrade'],('',1000))[1]);e['script_ammo_clip']=str(int(e['zombie_cost'])//2)
variables=json.loads((DATA/'gameplay/manifest.json').read_text())['variables'].copy()
variables.update({k:float(v) for k,v in re.findall(r'set_zombie_var\(\s*"([^"\n]+)"\s*,\s*([\d.]+)',script('zombies/_zm'))})
variables.update(zombie_score_start=500,zombie_health_start=150,zombie_health_increase=100,zombie_health_increase_percent=.1,zombie_max_ai=24,zombie_ai_per_player=6)

animations={}
for z in reversed(SEARCH):
    for p in (DATA/z/'web-anims').glob('ai_zombie_*.json'):
        if re.match(r'ai_zombie_(?:walk_v|run_v|sprint_v|attack_v|idle_v|traverse_v|door_tear)',p.stem):animations[p.stem]=animation(z,p.stem)
idle=find('web-anims/ai_zombie_idle_v1_delta.json')
if idle:
    (DATA/'bo2-buried/web-anims/ai_zombie_idle_v1.json').write_bytes(idle.read_bytes())
    animations['ai_zombie_idle_v1']=animation('bo2-buried','ai_zombie_idle_v1')
for alias,board in [('high',6),('low',1),('left',3),('right',4)]:
    original=find(f'web-anims/ai_zombie_boardtear_aligned_m_{board}_pull.json')
    name='ai_zombie_door_tear_'+alias
    if original:
        (DATA/'bo2-buried/web-anims'/f'{name}.json').write_bytes(original.read_bytes())
        animations[name]=animation('bo2-buried',name)
presentation=dict(animations=animations,effects={},actors=dict(body='c_zom_zombie_buried_miner_body1',head='c_zom_zombie_buried_male_head1'),powerups=dict(full_ammo='zombie_ammocan',insta_kill='zombie_skull',double_points='zombie_x2_icon',nuke='zombie_bomb',carpenter='zombie_carpenter'),box=dict(openAngle=105,openTime=.5,floatHeight=40,riseTime=3,offerTime=12,closeTime=.5,cooldown=3,cycleDelays=[.05]*20+[.1]*10+[.2]*5+[.3]*3))
for z in reversed(SEARCH):
    for p in (DATA/z/'web-fx').rglob('*.json'):
        effect=load_effect(p,SEARCH,effect_blending='grenade' in p.name)
        if 'grenadeexp_concrete' in effect['name']:effect['name']='explosions/grenadeexp_concrete'
        presentation['effects'][effect['name']]=effect

hud=OUTPUT/'hud';hud.mkdir(exist_ok=True)
art=['loadscreen_buried_zclassic_processing','menu_zm_map_buried_large','menu_zm_map_buried_blur','menu_zm_title_screen','hud_us_grenade','scorebar_zom_5','specialty_juggernaut_zombies','specialty_fastreload_zombies','specialty_doubletap_zombies','specialty_quickrevive_zombies','specialty_marathon_zombies','specialty_mulekick_zombies','specialty_vulture_zombies',*[f'chalkmarks_{i}' for i in range(1,6)]]
for name in art:
    p=find('images/'+name+'.dds')
    if p:
        with Image.open(p) as img:img.convert('RGBA').save(hud/(name+'.png'))

def sound_hash(name):
    value=5381
    for c in name.lower():value=ord(c)+0x1003f*value;value&=0xffffffff
    return value
aliases={};hashes={}
for z in reversed(SEARCH):
    for p in (DATA/z/'soundbank').glob('*.aliases.csv'):
        grouped=defaultdict(list)
        for row in csv.DictReader(p.open()):
            relative=row['FileSource'].replace('\\','/')
            if relative.startswith('raw/'):relative=relative[4:]
            file=find(relative) or find(relative+'.wav') or find(relative+'.flac')
            if not file:continue
            grouped[row['Name']].append(dict(url='/data/'+file.relative_to(DATA).as_posix(),volume=min(1,float(row['VolMax'] or 100)/100),pitch=2**(float(row['PitchMax'] or 0)/1200)))
        aliases.update(grouped)
for name in aliases:hashes['@'+format(sound_hash(name),'08x')]=name
for w in [*weapons.values(),grenade,*gestures.values()]:
    for k,v in list(w.items()):
        if 'Sound' in k and isinstance(v,str) and v.startswith('@'):w[k]=hashes.get(v,v)
    w['notetrackSoundMap']='\n'.join(' '.join(hashes.get(token,token) for token in line.split()) for line in str(w.get('notetrackSoundMap','')).splitlines())
remap=dict(mx_splash_screen='mus_zombie_splash_screen',mx_zombie_wave_1='mus_transit_underscore',chalk='mus_zombie_round_start',round_over='mus_zombie_round_over',cha_ching='zmb_cha_ching',no_cha_ching='zmb_no_cha_ching',repair_boards='zmb_repair_boards',remove_boards='zmb_break_boards',switch_flip='zmb_switch_flip',electrical_surge='zmb_poweron',grenade_explode='wpn_grenade_explode',melee_hit='wpn_melee_knife_hit_body',lid_open='zmb_lid_open',lid_close='zmb_lid_close',music_box='zmb_music_box',spawn_powerup='zmb_spawn_powerup',spawn_powerup_loop='zmb_spawn_powerup_loop',powerup_grabbed='zmb_powerup_grabbed',full_ammo='zmb_full_ammo',insta_kill='zmb_insta_kill',double_point='zmb_points_loop',nuke='evt_nuked',mx_jugger_sting='mus_perks_jugganog_sting',mx_speed_sting='mus_perks_speed_sting',mx_doubletap_sting='mus_perks_doubletap_sting',mx_revive_sting='mus_perks_revive_sting',mx_packa_sting='mus_perks_packa_sting',perks_power_on='zmb_perks_power_on',packa_rollers_loop='zmb_perks_packa_loop',packa_weap_upgrade='zmb_perks_packa_upgrade',packa_weap_ready='zmb_perks_packa_ready',ticktock_loop='zmb_perks_packa_ticktock',packa_deny='zmb_perks_packa_deny')
required=set(remap.values())
for w in [*weapons.values(),grenade,*gestures.values()]:
    required.update(v for k,v in w.items() if 'Sound' in k and isinstance(v,str) and v in aliases)
    required.update(line.split()[-1] for line in str(w.get('notetrackSoundMap','')).splitlines() if line.strip())
sounds={name:entries[:2] for name,entries in aliases.items() if name in required or re.match(r'(?:zmb_|zombie_|evt_|wpn_knife|wpn_grenade|mus_perks)',name)}
for name,native in remap.items():
    if native in aliases:sounds[name]=aliases[native][:2]
voice={name:entries[:1] for name,entries in aliases.items() if re.match(r'vox_plr_[0-3]_(?:ammo_low|ammo_out|level_start|nomoney|revive_down|revive_up|perk_|powerup_|kill_|wpck_).*_[01]$',name)}
body_names=['c_zom_player_oldman_fb','c_zom_player_reporter_dam_fb','c_zom_player_farmgirl_fb','c_zom_player_engineer_fb']
manifest=dict(format='bo2-buried-solo-v1',game='black-ops-2',startWeapon='m1911_zm',variables=variables,weapons=weapons,grenade=grenade,gestures=gestures,entities=entities,sounds=sounds,voice=voice,characterNames=['Russman','Stuhlinger','Misty','Marlton'],characterArms=arms,playerBodies=[dict(body=n) for n in body_names],weaponNames={n:n.replace('_upgraded_zm',' (Pack-a-Punch)').replace('_zm','').replace('_',' ').upper() for n in weapons},map=dict(id='buried',negotiationBegin=17,negotiationEnd=18,initialZone='zone_start',connections=connections,volumes=volumes,goals=goals,initialBox='start_chest',boxWeapons=[n for n in base_names if n!='m1911_zm'],powerTargets=[]),provenance=dict(world='maps/mp/zm_buried.d3dbsp',rules='owned decompiled maps/mp/zm_buried*.gsc',runtime='Black Ops II T6 browser reimplementation'))
manifest['wallCosts']={name:cost for name,(_,cost) in registry.items()}
manifest['map'].update(jailTargets=['pf749_auto11','sloth_cell_door'],arthurModel='c_zom_buried_sloth_fb',arthurAnimations=['ai_zombie_sloth_idle_jail','ai_zombie_sloth_idle','ai_zombie_sloth_walk','ai_zombie_sloth_run'])
manifest['map']['collisionHulls']=maze_hulls
manifest['map']['mazePermutations']=[['blocker_1','blocker_2','blocker_3','blocker_4'],['blocker_5','blocker_6','blocker_7','blocker_8','blocker_9'],['blocker_1','blocker_10','blocker_6','blocker_4','blocker_11'],['blocker_1','blocker_3','blocker_4','blocker_12'],['blocker_5','blocker_6','blocker_12','blocker_13'],['blocker_4','blocker_6','blocker_14']]
manifest['equipment']=equipment
triggers=[]
for e in entities:
    if e.get('targetname') not in ['hole_breakthrough','start_platform_trig','force_from_prone'] or not e.get('model','').startswith('*'):continue
    origin=point(e);hulls=[]
    for index in collision['models'][int(e['model'][1:])]['brushes']:
        b=collision['brushes'][index]
        hulls.append(dict(mins=[v+origin[k] for k,v in enumerate(b['mins'])],maxs=[v+origin[k] for k,v in enumerate(b['maxs'])],planes=[[*p[:3],p[3]+sum(p[k]*origin[k] for k in range(3))] for p in b['planes']]))
    triggers.append(dict(id=e['guid'],kind=e['targetname'],target=e.get('target'),position=origin,hulls=hulls))
# Player-only authored triggers do not change prepared NPC walking geometry.
manifest['environmentTriggers']=triggers
localized={}
for p in (DATA/'bo2-english/english/localizedstrings').glob('*.str'):
    localized.update(re.findall(r'REFERENCE\s+(\S+)\s+LANG_ENGLISH\s+"([^"\n]*)"',p.read_text()))
manifest['weaponNames']={n:localized.get(w.get('displayName'),manifest['weaponNames'][n]) for n,w in weapons.items()}
manifest['weaponNames']['tazer_knuckles_zm']='Galvaknuckles'
manifest['meleeUpgrades']={name:weapon(name) for name in ['bowie_knife_zm','tazer_knuckles_zm']}
manifest['playerAnimations']=sorted(set(manifest['playerAnimations'])) if 'playerAnimations' in manifest else []
presentation['actorVariants']={'ghost':dict(body='c_zom_zombie_buried_ghost_woman_fb',count=8,animations={'ai_zombie_walk_v1':'ai_zombie_ghost_walk','ai_zombie_attack_v1':'ai_zombie_attack_v1'})}
manifest['playerAnimations']=sorted({p.stem for z in SEARCH for p in (DATA/z/'web-anims').glob('pb_*.json') if re.match(r'pb_(?:stand_alert|stand_ads|sprint|combatrun|combatwalk|crouch_alert|crouch_run|prone_aim|prone_crawl|dive_prone|laststand)',p.stem)})
presentation['powerups'].update(vulture_ammo='p6_zm_perk_vulture_ammo',vulture_points='p6_zm_perk_vulture_points')
def gore_texture(material):
    source=find('materials/'+material+'.json')
    if not source:raise RuntimeError('Missing T6 blood material '+material)
    image=next(t['image'] for t in json.loads(source.read_text())['textures'] if t['semantic']=='colorMap')
    return '/data/'+find('images/'+image.lstrip(',')+'.dds').relative_to(DATA).as_posix()
presentation['gore']=dict(neckModel='c_zom_zombie_buried_civilian_g_behead',neckMount='body',headSound='zmb_zombie_head_gib',burst=gore_texture('gfx_fxt_bio_bloodburst'),drops=gore_texture('gfx_fxt_bio_blooddrops'),decals=[gore_texture('wc/gfx_impact_blood_spatter%02d'%n) for n in [1,2,3]])
remap_more=dict(zmb_attack='zmb_vocals_zombie_attack',amb_spooky_2d='zmb_vocals_zombie_ambience',death='zmb_vocals_zombie_death',mx_stamin_sting='mus_perks_staminup_sting',mx_mule_sting='mus_perks_mulekick_sting',mx_vulture_sting='mus_perks_vulture_sting',grenade_explode='wpn_grenade_explode_default',grenade_explode_bass='wpn_grenade_explode_lfe',grenade_bounce_concrete='wpn_grenade_bounce_concrete')
for name,native in remap_more.items():
    if native in aliases:sounds[name]=aliases[native][:2]
write('manifest.json',manifest);write('presentation.json',presentation)
print(json.dumps(dict(entities=len(entities),volumes=len(volumes),windows=len(goals),weapons=len(weapons),sounds=len(sounds),voice=len(voice),animations=len(animations),hud=len(list(hud.glob('*.png')))),indent=2))
