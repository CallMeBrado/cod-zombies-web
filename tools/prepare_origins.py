"""Prepare Origins's original T6 assets and script-derived map rules on E:."""
from pathlib import Path
from collections import defaultdict
import csv, json, re, subprocess, shutil, math
from PIL import Image
from inspect_game import parse_entities
from prepare_fidelity import animation, load_effect

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'local-data'
SEARCH=['bo2-origins-patch','bo2-origins','bo2-origins-english','bo2-base','bo2-common','bo2-english','bo2-menu','bo2-ui-base','bo2-ui']
OUT=DATA/'gameplay/bo2-origins'; OUT.mkdir(parents=True,exist_ok=True)
def find(name): return next((DATA/z/name for z in SEARCH if (DATA/z/name).is_file()),None)

# Shared pickup models used by the T6 rules can live in another owned zone.
def prepare_shared_assets():
    groups=[('Fire Sale pickup',['model_export/zombie_firesale_lod0.glb','xmodel/zombie_firesale.json',
            'materials/specialty_firesale_zombies.json','images/specialty_firesale_zombies.dds']),
            ('Carpenter pickup',['model_export/zombie_carpenter_lod0.glb','xmodel/zombie_carpenter.json'])]
    for label,files in groups:
        if all(find(f) for f in files): continue
        source=next((DATA/z for z in ['bo2-nuketown','bo2-buried','bo2-tranzit'] if all((DATA/z/f).is_file() for f in files)),None)
        if source is None: raise FileNotFoundError('Original BO2 '+label+' unavailable. Extract Buried first.')
        for name in files:
            if find(name): continue
            target=DATA/'bo2-origins'/name; target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source/name,target)
        print('Prepared original BO2 '+label+' from '+source.name,flush=True)

prepare_shared_assets()
def point(e): return list(map(float,e['origin'].split()))
def angles(e): return list(map(float,(e.get('angles') or '0 0 0').split()))
def text(p): return ' '.join(str(round(v,3)) for v in p)
def write(name,value): (OUT/name).write_text(json.dumps(value,separators=(',',':')),encoding='utf-8')
def weapon(name):
    p=find('weapons/'+name)
    if not p: raise RuntimeError('Missing native Origins weapon: '+name)
    v=p.read_text(encoding='utf-8').split('\\')
    return {k:float(n) if re.fullmatch(r'-?\d+(?:\.\d*)?',n) else n for k,n in zip(v[1::2],v[2::2])}
subprocess.run(['python','-B',str(ROOT/'tools/prepare_bo2_world.py'),'--zone','bo2-origins','--asset','zm_tomb','--search',','.join(SEARCH)],cwd=ROOT,check=True)
original=parse_entities(DATA/'bo2-origins/maps/mp/zm_tomb.d3dbsp.ents')
by=defaultdict(list)
for e in original:
    if e.get('targetname'): by[e['targetname']].append(e)
C=json.loads((DATA/'bo2-origins/web-world/zm_tomb.collision.json').read_text(encoding='utf-8'))
script=(DATA/'bo2-origins-scripts/t6/maps/mp/zm_tomb.gsc').read_text(encoding='utf-8')
def hulls(e):
    origin=point(e)
    return [dict(mins=[v+origin[k] for k,v in enumerate(C['brushes'][i]['mins'])],maxs=[v+origin[k] for k,v in enumerate(C['brushes'][i]['maxs'])],
                 planes=[[*p[:3],p[3]+sum(p[k]*origin[k] for k in range(3))] for p in C['brushes'][i]['planes']])
            for i in C['models'][int(e['model'][1:])]['brushes']]

# Preserve only the classic map entities. Script staging actors are not props.
E=[dict(e) for e in original if not e.get('script_gameobjectname') or e['script_gameobjectname']=='zclassic']
registry={n:(up,int(cost)) for n,up,cost in re.findall(r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,\s*"([^"\n]*)"\s*,\s*[^,\n]+,\s*(\d+)',script)}
registry['raygun_mark2_zm']=('raygun_mark2_upgraded_zm',10000)
unsupported={'knife_zm','fivesevendw_zm','knife_ballistic_zm','knife_ballistic_bowie_zm','knife_ballistic_no_melee_zm','cymbal_monkey_zm','claymore_zm','frag_grenade_zm','sticky_grenade_zm','emp_grenade_zm','tazer_knuckles_zm','equip_springpad_zm','tomb_shield_zm','beacon_zm'}
included=re.findall(r'include_weapon\(\s*"([^"]+)"\s*(?:,\s*(\d+))?',script)
box=[n for n,flag in included if flag!='0' and n not in unsupported and find('weapons/'+n)]
base={n for n in registry if n not in unsupported and find('weapons/'+n)}
names=base|{registry[n][0] for n in base if registry[n][0] and find('weapons/'+registry[n][0])}|{f'staff_{s}{v}_zm' for s in ['air','fire','lightning','water'] for v in ['', '_upgraded']}
W={n:weapon(n) for n in sorted(names)}; knife=weapon('knife_zm')
arms=['c_zom_dempsey_viewhands','c_zom_nikolai_viewhands','c_zom_takeo_viewhands','c_zom_richtofen_viewhands']
for n,w in W.items():
    if n.startswith(('ray_gun','raygun_mark2','staff_','c96_upgraded')): w['startAmmo']+=w['clipSize']
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
    'specialty_rof':'zombie_perk_bottle_doubletap','specialty_quickrevive':'zombie_perk_bottle_revive','specialty_additionalprimaryweapon':'zombie_perk_bottle_additionalprimaryweapon',
    'specialty_longersprint':'zombie_perk_bottle_marathon','specialty_deadshot':'zombie_perk_bottle_deadshot','specialty_flakjacket':'zombie_perk_bottle_nuke','specialty_grenadepulldeath':'zombie_perk_bottle_cherry','zombie_builder':'zombie_builder_zm','knuckle_crack':'zombie_knuckle_crack'}.items() if find('weapons/'+n)}
if 'death_throe' in gestures: gestures['death_throe']['gunModel']='viewmodel_usa_no_model'

# Staff projectiles use bespoke elemental damage rather than the generic
# explosive-gun path. Keep all native viewmodels, ammo and animation names.
for n,w in W.items():
    if n.startswith('staff_'):
        w['originsElement']=n.split('_')[1]
        w['weaponType']='bullet'
        w.pop('upgrade',None)  # Staff upgrades are quests, not Pack-a-Punch.

generators=[dict(id=int(e['script_int']),name=e['script_noteworthy'],origin=point(e),angles=angles(e),guardSpawns=[point(s) for s in by[e['target']]]) for e in by['s_generator']]
perkPower={'specialty_quickrevive':1,'specialty_fastreload':3,'specialty_armorvest':4,'specialty_longersprint':5,'specialty_additionalprimaryweapon':0,'specialty_weapupgrade':7}
randomPower={'starting_bunker':1,'trenches_right':2,'trenches_left':3,'nml':4,'farmhouse':5,'church':6}
parts={};shovels={};digSpots=[];mechSpawns=[];itemIndex=0
for e in list(E):
    t=e.get('targetname','');s=e.get('script_noteworthy','');c=e.get('classname','')
    if 'magicbox' in c.lower():
        # Origins has its own stone chest and lid rig.
        e.update(classname='script_model',model='p6_anim_zm_tm_magic_box',targetname=s.replace('_zbarrier',''))
    if t=='treasure_chest_use': e['target']=s
    if s in ['spawn_location','riser_location'] and 'spawner' in t:
        e.update(nativeNoteworthy='find_flesh' if s=='spawn_location' and e.get('script_string')=='find_flesh' else s,script_noteworthy='zombie_spawner')
    if s=='mechz_location': mechSpawns.append(dict(origin=point(e),group=t))
    if s in ['dog_location','mechz_location','capture_zombie'] or c.startswith('actor_'): E.remove(e);continue
    if c.startswith('zbarrier') and 'magicbox' not in c.lower():
        for i in range(1,7):
            if e.get('zbarrierboardmodel'+str(i)):
                E.append(dict(classname='script_model',targetname=t,model=e['zbarrierboardmodel'+str(i)],origin=e['origin'],angles=e.get('angles','0 0 0'),closedAnim=e['zbarrierboardanim'+str(i)],nativeBoard=str(i)))
    if t=='weapon_upgrade':
        n=e['zombie_weapon_upgrade'];cost=registry.get(n,('',250 if n=='sticky_grenade_zm' else 1000))[1]
        e.update(zombie_cost=str(cost),script_ammo_clip=str(cost//2))
    if t=='zm_perk_machine':
        key='origins_machine_'+s;m=e['model']
        if find('model_export/'+m+'_on_lod0.glb'):m+='_on'
        if s=='specialty_weapupgrade':E=[x for x in E if x.get('targetname')!='pap_cs']
        E.append(dict(classname='script_model',targetname=key,model=m,origin=e['origin'],angles=e.get('angles','0 0 0'),originsMachine=s))
        e.update(targetname='zombie_vending_upgrade' if s=='specialty_weapupgrade' else 'zombie_vending',target=key,generator=perkPower.get(s,0),origin=text([*point(e)[:2],point(e)[2]+35]))
    if t=='random_perk_machine':
        key='origins_wunderfizz_'+e['script_string'];e['targetname']=key
        E.append(dict(classname='script_struct',targetname='origins_wunderfizz',target=key,generator=randomPower[e['script_string']],origin=text([*point(e)[:2],point(e)[2]+35])))
    if t=='s_generator':e.update(targetname='origins_generator',generator=int(e['script_int']))
    kind=None;group=None
    if t=='shovel_location':kind='shovel';group='shovel_'+s
    if t=='dig_spot':kind='dig'
    if t.startswith('gramophone_vinyl_'):kind='record';group=t.removesuffix('_alt')
    if s=='elemental_staff_piece':kind='staffPart';group=t
    if kind:
        key='origins_item_'+str(itemIndex);itemIndex+=1
        e.update(classname='script_model',targetname=key,originsItem=kind,itemId=key,itemGroup=group or key,nativeTarget=t)
        parts.setdefault(group or key,[]).append(key)
        if kind=='dig':digSpots.append(key)
    if t.startswith('craftable_staff_'):
        e['originsStaff']=t.removeprefix('craftable_');key='origins_craft_'+e['originsStaff']
        E.append(dict(classname='script_struct',targetname='origins_staff_bench',target=t,staff=e['originsStaff'],origin=text([*point(e)[:2],point(e)[2]+30])))
    if t=='stargate_gramophone_pos':
        e.update(targetname='origins_portal',portal=int(e['script_int']))

volumes=[dict(name=e['targetname'],spawners=e.get('target',e['targetname']+'_spawners'),hulls=hulls(e)) for e in E if e.get('script_noteworthy')=='player_volume']
nodes=json.loads((DATA/'bo2-origins/web-world/zm_tomb.paths.json').read_text(encoding='utf-8'))['nodes']
specs={i:next((e for e in original if e.get('classname')=='node_negotiation_begin' and e.get('target')==n['target'] and math.dist(point(e),n['origin'])<1),{}) for i,n in enumerate(nodes) if n['type']==17}
goals={}
for e in [e for e in E if e.get('targetname')=='exterior_goal']:
    options=[i for i,s in specs.items() if 'mantle_over_40' in s.get('animscript','')]
    if not options:continue
    i=min(options,key=lambda i:math.dist(nodes[i]['origin'],point(e)))
    end=next((nodes[l['node']] for l in nodes[i]['links'] if l['negotiation']),None)
    if not end or math.dist(nodes[i]['origin'],point(e))>170:continue
    n=nodes[i];key='origins_traverse_'+str(i)
    E.extend([dict(classname='script_struct',targetname='traverse',target=key,origin=text([*n['origin'][:2],n['origin'][2]-16]),angles='0 '+str(n['angle'])+' 0'),dict(classname='script_struct',targetname=key,origin=text([*end['origin'][:2],end['origin'][2]-16]))])
    owner=next((x['targetname'] for x in E if x.get('nativeNoteworthy')=='spawn_location' and x.get('script_string')==e.get('script_string')),None)
    zone=next((v for v in volumes if v['spawners']==owner),None)
    if zone is None:zone=min(volumes,key=lambda v:min(sum(max(h['mins'][k]-end['origin'][k],0,end['origin'][k]-h['maxs'][k])**2 for k in range(3)) for h in v['hulls']))
    goals[e['target']]=dict(zone=zone['name'],spawners=zone['spawners'],barricade=e.get('script_string'))

animations={}
def add_animation(name):
    if name in animations:return True
    p=find('web-anims/'+name+'.json')
    if not p:return False
    animations[name]=animation(p.relative_to(DATA).parts[0],name);return True
for z in reversed(SEARCH):
    for p in (DATA/z/'web-anims').glob('ai_zombie_*.json'):
        if re.match(r'ai_zombie_(?:walk_v|run_v|sprint_v|attack_v|attack_forward_v|walk_attack_v|run_attack_v|idle_v|traverse_v|door_tear|traverse_ground_(?:v1_walk|v1_run|climbout_fast)$)',p.stem):add_animation(p.stem)
idle=find('web-anims/ai_zombie_idle_v1_delta.json')
if idle and not find('web-anims/ai_zombie_idle_v1.json'):(DATA/'bo2-origins/web-anims/ai_zombie_idle_v1.json').write_bytes(idle.read_bytes())
add_animation('ai_zombie_idle_v1')
traversals={}
for i,spec in specs.items():
    alias=spec.get('animscript','').removeprefix('zm_')
    end=next((nodes[l['node']] for l in nodes[i]['links'] if l['negotiation']),None)
    if not end or not alias:continue
    name='ai_zombie_traverse_v1' if alias.startswith('mantle_over_40') else 'ai_zombie_'+alias
    if not add_animation(name):
        name='ai_zombie_traverse_'+alias
        if not add_animation(name):continue  # Do not invent unsupported negotiations.
    traversals[i]=dict(animation=name,arc=40 if alias.startswith('mantle') else 0)
presentation=dict(animations=animations,effects={},actors=dict(body='c_zom_tomb_german_body_1a',head='c_zom_tomb_german_head1'),powerups=dict(full_ammo='zombie_ammocan',insta_kill='zombie_skull',double_points='zombie_x2_icon',nuke='zombie_bomb',carpenter='zombie_carpenter',fire_sale='zombie_firesale'),box=dict(openAngle=105,openTime=.5,floatHeight=40,riseTime=3,offerTime=12,closeTime=.5,cooldown=3,teddyModel='zombie_teddybear',cycleDelays=[.05]*20+[.1]*10+[.2]*5+[.3]*3))
presentation['actorVariants']={}
for kind,body,head in [('crusader','c_zom_tomb_crusader_body_zc','c_zom_tomb_crusader_headz'),('panzer','c_zom_mech_body',None)]:
    presentation['actorVariants'][kind]=dict(body=body,head=head,count=4 if kind=='crusader' else 2,animations={})
presentation['actorVariants']['crusader']['animations']={n:n for n in animations}
presentation['actorVariants']['panzer']['attachments']=[dict(model=m,tag=t.lower()) for m,t in [
    ('c_zom_mech_armor_knee_left','J_Knee_Attach_LE'),('c_zom_mech_armor_knee_right','J_Knee_attach_RI'),
    ('c_zom_mech_armor_shoulder_left','J_ShoulderArmor_LE'),('c_zom_mech_armor_shoulder_right','J_ShoulderArmor_RI'),
    ('c_zom_mech_claw','tag_claw'),('c_zom_mech_faceplate','J_Helmet'),('c_zom_mech_powersupply_cap','tag_powersupply')]]
for z in reversed(SEARCH):
    for p in (DATA/z/'web-fx').rglob('*.json'):
        if not re.search(r'powerup|grenade|blood|wall_buy|perk|pap|raygun|ray_gun|magicbox|staff|capture|generator|dig_mound|mech|muzzleflash',str(p)):continue
        fx=load_effect(p,SEARCH,effect_blending=True)
        if 'grenadeexp_concrete' in fx['name']:fx['name']='explosions/grenadeexp_concrete'
        presentation['effects'][fx['name']]=fx
hud=OUT/'hud';hud.mkdir(exist_ok=True)
art=['overlay_low_health','hit_direction_zm','menu_zm_tomb_zclassic_tomb','menu_zm_map_signpost_tomb','hud_us_grenade','scorebar_zom_5',*[f'chalkmarks_{i}' for i in range(1,6)]]
art+=sorted({p.stem for z in SEARCH for p in (DATA/z/'images').glob('specialty_*zombies.dds')})
for n in art:
    p=find('images/'+n+'.dds')
    if p:
        with Image.open(p) as img:img.convert('RGBA').save(hud/(n+'.png'))
poster=next((hud/(n+'.png') for n in ['menu_zm_tomb_zclassic_tomb','menu_zm_map_signpost_tomb'] if (hud/(n+'.png')).exists()),None)
if not poster:raise RuntimeError('Missing original Origins loading art')
(hud/'origins-load.png').write_bytes(poster.read_bytes())


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
        if p: required.update(n['name'][6:] for n in json.loads(p.read_text(encoding='utf-8')).get('notifies',[]) if n['name'].startswith('sndnt#'))
remap=dict(mx_splash_screen='mus_zombie_splash_screen',mx_zombie_wave_1='mus_tomb_underscore',chalk='mus_zombie_round_start',round_over='mus_zombie_round_over',cha_ching='zmb_cha_ching',no_cha_ching='zmb_no_cha_ching',repair_boards='zmb_repair_boards',remove_boards='zmb_break_boards',grenade_explode='wpn_grenade_explode_default',grenade_explode_bass='wpn_grenade_explode_lfe',grenade_bounce_concrete='wpn_grenade_bounce_concrete',melee_hit='wpn_melee_knife_hit_body',lid_open='zmb_lid_open',lid_close='zmb_lid_close',music_box='zmb_music_box',spawn_powerup='zmb_spawn_powerup',spawn_powerup_loop='zmb_spawn_powerup_loop',powerup_grabbed='zmb_powerup_grabbed',full_ammo='zmb_full_ammo',insta_kill='zmb_insta_kill',double_point='zmb_points_loop',nuke='evt_nuked',mx_jugger_sting='mus_perks_jugganog_sting',mx_speed_sting='mus_perks_speed_sting',mx_doubletap_sting='mus_perks_doubletap_sting',mx_revive_sting='mus_perks_revive_sting',mx_packa_sting='mus_perks_packa_sting',perks_power_on='zmb_perks_power_on',packa_rollers_loop='zmb_perks_packa_loop',packa_weap_upgrade='zmb_perks_packa_upgrade',packa_weap_ready='zmb_perks_packa_ready',ticktock_loop='zmb_perks_packa_ticktock',packa_deny='zmb_perks_packa_deny')
remap.update(mx_zombie_wave_1='mus_underscore_trench',mx_mule_sting='mus_perks_mulekick_sting',mx_stamin_sting='mus_perks_stamin_sting',dog_start='mus_zombie_dog_start',dog_end='mus_zombie_dog_end',switch_flip='zmb_switch_flip',electrical_surge='zmb_turn_on')
required.update(remap.values()); required.update(['mus_zombie_game_over','mus_fire_sale','amb_alarm_bell','evt_poweron_front'])
sounds={}
for n,rows in aliases.items():
    if n not in required and not re.match(r'(zmb_|zombie_|evt_|mus_perks|vox_ann_|vox_zmba_|fly_step_|wpn_knife|wpn_grenade|wpn_staff|mus_tomb|mus_generator)',n): continue
    unique=list({r['url']:r for r in rows}.values()); sounds[n]=unique[:12] if re.match(r'zmb_vocals_|fly_step_',n) else rows[:2]
for n,native in remap.items():
    if native in aliases: sounds[n]=aliases[native][:2]
voice={n:rows[:1] for n,rows in aliases.items() if re.match(r'vox_plr_[0-3]_(?:ammo_low|ammo_out|level_start|nomoney|revive_down|revive_up|perk_|powerup_|kill_|wpck_).*_[01]$',n)}
def gore_texture(n):
    p=find('materials/'+n+'.json'); image=next(t['image'] for t in json.loads(p.read_text(encoding='utf-8'))['textures'] if t['semantic']=='colorMap')
    return '/data/'+find('images/'+image.lstrip(',')+'.dds').relative_to(DATA).as_posix()
presentation['gore']=dict(neckModel='c_zom_tomb_german_body_g_behead',neckMount='body',headSound='zmb_zombie_head_gib',burst=gore_texture('gfx_fxt_bio_bloodburst'),drops=gore_texture('gfx_fxt_bio_blooddrops'),decals=[gore_texture('wc/gfx_impact_blood_spatter%02d'%n) for n in [1,2,3]])
variables=json.loads((DATA/'gameplay/bo2-buried/manifest.json').read_text(encoding='utf-8'))['variables'].copy()
connections=[[a,b,flag,bool(one)] for a,b,flag,one in re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*(?:,\s*(\d))?\s*\)',script)]
panzerMap={'ai_zombie_walk_v1':'ai_zombie_mech_walk_basic','ai_zombie_run_v1':'ai_zombie_mech_run','ai_zombie_sprint_v1':'ai_zombie_mech_sprint',
           'ai_zombie_idle_v1':'ai_zombie_mech_idle','ai_zombie_attack_v1':'ai_zombie_mech_melee_a','ai_zombie_death_v1':'ai_zombie_mech_death'}
presentation['actorVariants']['panzer']['animations']={k:v for k,v in panzerMap.items() if add_animation(v)}
portalNames={1:('fire','fire'),2:('air','air'),3:('electric','elec'),4:('water','ice')}
portals=[]
for e in E:
    if e.get('targetname')!='origins_portal':continue
    i=e['portal'];arrival,record=portalNames[i];destination=by[arrival+'_teleport_player'][0];back=by[record+'_teleport_return'][0]
    exitTrigger=next(x for x in original if x.get('script_noteworthy')=='chamber_exit_trigger' and int(x.get('script_int',0))==i)
    portals.append(dict(id=i,record='gramophone_vinyl_'+record,to=point(destination),yaw=angles(destination)[1],back=point(back),backYaw=angles(back)[1],exit=point(exitTrigger)))
E.append(dict(classname='script_struct',targetname='origins_crypt',origin=by['chamber_entrance_position'][0]['origin']))
for p in portals:
    E.append(dict(classname='script_struct',targetname='origins_return',portal=p['id'],origin=text(p['exit'])))
boxPrefix='o_zombie_dlc4_magic_box_'
boxClips={n:animation(find('web-anims/'+boxPrefix+n+'.json').relative_to(DATA).parts[0],boxPrefix+n)['duration'] for n in ['open','close','arrive','leave']}
propAnimations=[boxPrefix+n for n in ['open','close','arrive','leave']]
propAnimations += [p.stem for p in (DATA/'bo2-origins/web-anims').glob('fxanim_zom_tomb_generator_*.json')]
propAnimations += [p.stem for p in (DATA/'bo2-origins/web-anims').glob('ai_zombie_mech_*.json') if any(x in p.stem for x in ['melee','walk','sprint','idle','ft_fire'])]
for n in propAnimations:
    if n.startswith('ai_zombie_'):add_animation(n)
manifest=dict(format='bo2-origins-solo-v1',game='black-ops-2',startWeapon='c96_zm',variables=variables,weapons=W,grenade=grenade,gestures=gestures,entities=E,sounds=sounds,voice=voice,
    characterNames=['Dempsey','Nikolai','Takeo','Richtofen'],characterArms=arms,playerBodies=[dict(body='c_zom_tomb_'+n+'_fb') for n in ['dempsey','nikolai','takeo','richtofen']],
    weaponNames={n:n.replace('_upgraded_zm',' (Pack-a-Punch)').replace('_zm','').replace('_',' ').upper() for n in W},equipment={},
    map=dict(id='origins',initialZone='zone_start',initialZones=['zone_start'],kinematicPaths=True,connections=connections,volumes=volumes,goals=goals,negotiationBegin=17,negotiationEnd=18,
        initialBox='bunker_tank_chest',boxWeapons=sorted(set(box)),boxMoves=True,boxExclusive=[['ray_gun_zm','raygun_mark2_zm']],powerTargets=[],initialDisabled=[],openRisers=True,
        traversals=traversals,generators=sorted(generators,key=lambda g:g['id']),parts=parts,digSpots=digSpots,mechSpawns=mechSpawns,portals=portals,
        mud=[h for e in original if e.get('targetname')=='player_slow_area' for h in hulls(e)],
        skyModel='skybox_dlc4_zm_tomb',propModels=['zombie_teddybear','skybox_dlc4_zm_tomb'],propAnimations=propAnimations,boxClips=boxClips,boxAnimationPrefix=boxPrefix,boxFakeModel=None),
    wallCosts={n:c for n,(_,c) in registry.items()},meleeUpgrades={},
    playerAnimations=sorted({p.stem for z in SEARCH for p in (DATA/z/'web-anims').glob('pb_*.json') if re.match(r'pb_(?:stand_alert|stand_ads|sprint|combatrun|combatwalk|crouch_alert|crouch_run|prone_aim|prone_crawl|dive_prone|laststand)',p.stem)}),
    provenance=dict(world='maps/mp/zm_tomb.d3dbsp',rules='owned decompiled zm_tomb*.gsc',runtime='shared T6 browser reconstruction'))
manifest['map']['wallbuyEffects']={n:'maps/zombie/fx_zmb_wall_buy_'+fx for n,fx in {'m14_zm':'m14','870mcs_zm':'870mcs','ak74u_zm':'ak74u','beretta93r_zm':'berreta93r','mp40_zm':'mp40','mp44_zm':'mp44','ballista_zm':'ballista','claymore_zm':'claymore'}.items()}
manifest['map']['staffEffects']={s:'weapon/zmb_staff/fx_zmb_staff_'+fx+'_impact' for s,fx in [('air','air'),('fire','fire'),('water','ice'),('lightning','elec')]}
write('manifest.json',manifest);write('presentation.json',presentation)
print(json.dumps(dict(entities=len(E),weapons=len(W),volumes=len(volumes),barriers=len(goals),generators=len(generators),traversals=len(traversals),sounds=len(sounds),animations=len(animations))))
