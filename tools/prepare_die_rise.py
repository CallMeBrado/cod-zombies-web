"""Prepare Die Rise's original T6 assets and script-derived map rules on E:."""
from pathlib import Path
from collections import defaultdict
import csv, json, re, subprocess, shutil, math
from PIL import Image
from inspect_game import parse_entities
from prepare_fidelity import animation, load_effect

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'local-data'
SEARCH=['bo2-die-rise-patch','bo2-die-rise','bo2-die-rise-english','bo2-base','bo2-common','bo2-english','bo2-menu','bo2-ui-base','bo2-ui']
OUT=DATA/'gameplay/bo2-die-rise'; OUT.mkdir(parents=True,exist_ok=True)
def find(name): return next((DATA/z/name for z in SEARCH if (DATA/z/name).is_file()),None)

# Die Rise's fastfiles omit the Fire Sale pickup and the Mustang & Sally empty
# putaway the shared browser rules use; take BO2's originals from an owned map.
def prepare_shared_assets():
    groups=[('Fire Sale pickup',['model_export/zombie_firesale_lod0.glb','xmodel/zombie_firesale.json',
            'materials/specialty_firesale_zombies.json','images/specialty_firesale_zombies.dds']),
            ('Mustang & Sally empty putaway',['web-anims/viewmodel_m1911_dw_putaway_empty.json'])]
    for label,files in groups:
        if all(find(f) for f in files): continue
        source=next((DATA/z for z in ['bo2-nuketown','bo2-buried','bo2-tranzit'] if all((DATA/z/f).is_file() for f in files)),None)
        if source is None: raise FileNotFoundError('Original BO2 '+label+' unavailable. Extract Buried first.')
        for name in files:
            if find(name): continue
            target=DATA/'bo2-common'/name; target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source/name,target)
        print('Prepared original BO2 '+label+' from '+source.name,flush=True)

prepare_shared_assets()
def point(e): return list(map(float,e['origin'].split()))
def angles(e): return list(map(float,(e.get('angles') or '0 0 0').split()))
def text(p): return ' '.join(str(round(v,3)) for v in p)
def write(name,value): (OUT/name).write_text(json.dumps(value,separators=(',',':')))
def weapon(name):
    p=find('weapons/'+name)
    if not p: raise RuntimeError('Missing native Die Rise weapon: '+name)
    v=p.read_text().split('\\')
    return {k:float(n) if re.fullmatch(r'-?\d+(?:\.\d*)?',n) else n for k,n in zip(v[1::2],v[2::2])}
subprocess.run(['python','-B',str(ROOT/'tools/prepare_bo2_world.py'),'--zone','bo2-die-rise','--asset','zm_highrise','--search',','.join(SEARCH)],cwd=ROOT,check=True)
original=parse_entities(DATA/'bo2-die-rise/maps/mp/zm_highrise.d3dbsp.ents')
by=defaultdict(list)
for e in original:
    if e.get('targetname'): by[e['targetname']].append(e)
C=json.loads((DATA/'bo2-die-rise/web-world/zm_highrise.collision.json').read_text())
script=(DATA/'bo2-die-rise-scripts/t6/maps/mp/zm_highrise.gsc').read_text()
def hulls(e):
    origin=point(e)
    return [dict(mins=[v+origin[k] for k,v in enumerate(C['brushes'][i]['mins'])],maxs=[v+origin[k] for k,v in enumerate(C['brushes'][i]['maxs'])],
                 planes=[[*p[:3],p[3]+sum(p[k]*origin[k] for k in range(3))] for p in C['brushes'][i]['planes']])
            for i in C['models'][int(e['model'][1:])]['brushes']]

# Classic (rooftop) only; the static perk rows at z 1120 are staging rows the
# classic mode replaces with its elevator machines (init_elevator_perks).
E=[dict(e) for e in original if (not e.get('script_gameobjectname') or e['script_gameobjectname']=='zclassic')
   and e.get('targetname')!='zm_perk_machine' and not (e.get('targetname') or '').startswith('sq_')]
registry={n:(up,int(cost)) for n,up,cost in re.findall(r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,\s*"([^"\n]*)"\s*,\s*[^,\n]+,\s*(\d+)',script)}
registry['raygun_mark2_zm']=('raygun_mark2_upgraded_zm',10000)
unsupported={'knife_zm','fivesevendw_zm','knife_ballistic_zm','knife_ballistic_bowie_zm','knife_ballistic_no_melee_zm','cymbal_monkey_zm','claymore_zm','frag_grenade_zm','sticky_grenade_zm','emp_grenade_zm','tazer_knuckles_zm','equip_springpad_zm'}
included=re.findall(r'include_weapon\(\s*"([^"]+)"\s*(?:,\s*(\d+))?',script)
box=[n for n,flag in included if flag!='0' and n not in unsupported and find('weapons/'+n)]
base={n for n in registry if n not in unsupported and find('weapons/'+n)}
names=base|{registry[n][0] for n in base if registry[n][0] and find('weapons/'+registry[n][0])}|{'slipgun_zm','slipgun_upgraded_zm'}
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
# The Sliquifier's bolt bursts into goo where it lands (slip_bolt_zm).
for n in ['slipgun_zm','slipgun_upgraded_zm']:
    if n in W: W[n].update(projExplosionEffect='impacts/fx_liquifier_explo_gen',projExplosionSound='wpn_slipgun_explode')
if 'slipgun_zm' in W: W['slipgun_zm']['upgrade']='slipgun_upgraded_zm'
grenade=weapon('frag_grenade_zm'); grenade['handsModel']=arms[0]
gestures={k:dict(weapon(n),name=n,handsModel=arms[0]) for k,n in {
    'death_throe':'death_throe_zm','specialty_armorvest':'zombie_perk_bottle_jugg','specialty_fastreload':'zombie_perk_bottle_sleight',
    'specialty_rof':'zombie_perk_bottle_doubletap','specialty_quickrevive':'zombie_perk_bottle_revive','specialty_additionalprimaryweapon':'zombie_perk_bottle_additionalprimaryweapon',
    'specialty_finalstand':'zombie_perk_bottle_whoswho','zombie_builder':'zombie_builder_zm','knuckle_crack':'zombie_knuckle_crack'}.items() if find('weapons/'+n)}
if 'death_throe' in gestures: gestures['death_throe']['gunModel']='viewmodel_usa_no_model'

equipment={'springpad_zm':dict(name='Trample Steam',model='p6_anim_zm_buildable_tramplesteam',animation='o_zombie_buildable_tramplesteam_compressed_idle',launchAnimation='o_zombie_buildable_tramplesteam_launch',health=1200,parts=4),
           'slipgun_zm':dict(name='Sliquifier',model='t6_wpn_zmb_slipgun_world',health=1,parts=4,weapon='slipgun_zm')}
for kind,d in equipment.items():
    for k in ['animation','launchAnimation']:
        if d.get(k) and not find('web-anims/'+d[k]+'.json'): d.pop(k)
leaperSpawns=[];keySpawns=[];partGroups={}
for e in list(E):
    t=e.get('targetname') or ''
    if 'MagicBox' in e.get('classname',''):
        e.update(classname='script_model',model='p6_anim_zm_magic_box',targetname=e['script_noteworthy'].replace('_zbarrier',''))
    if t=='treasure_chest_use': e['target']=e['script_noteworthy']
    if t.endswith('_spawners'):
        kind=e.get('script_noteworthy','')
        if kind=='leaper_location':
            leaperSpawns.append(dict(group=t,origin=point(e),yaw=angles(e)[1],elevator=e.get('name'),emerge=e.get('script_parameters')));E.remove(e);continue
        if kind=='dog_location': E.remove(e);continue
        if kind in ('spawn_location','riser_location','faller_location'):
            # Fallers climb out of the elevator shafts at the hallway floor; they
            # are risers on that floor, held back while a car is at the door.
            e.update(nativeNoteworthy='riser_location' if kind!='spawn_location' else 'find_flesh' if e.get('script_string')=='find_flesh' else 'spawn_location',script_noteworthy='zombie_spawner')
            if kind=='faller_location': e.update(fallerElevator=(e.get('name') or '').replace('elevator_','bldg'))
    if t=='use_elec_switch': e['targetname']='use_power_switch'
    if t=='elec_switch': e['targetname']='die_rise_power_lever'
    if e.get('classname','').startswith('zbarrier') and 'MagicBox' not in e['classname']:
        for i in range(1,7):
            if e.get('zbarrierboardmodel'+str(i)):
                E.append(dict(classname='script_model',targetname=e['targetname'],model=e['zbarrierboardmodel'+str(i)],origin=e['origin'],angles=e.get('angles','0 0 0'),closedAnim=e['zbarrierboardanim'+str(i)],nativeBoard=str(i)))
    if t=='weapon_upgrade':
        n=e['zombie_weapon_upgrade']; cost=registry.get(n,('',250 if n=='sticky_grenade_zm' else 1000))[1]
        e.update(zombie_cost=str(cost),script_ammo_clip=str(cost//2))
    if t in ['tazer_upgrade','bowie_upgrade']:
        e.update(targetname='weapon_upgrade',zombie_weapon_upgrade='tazer_knuckles_zm' if t=='tazer_upgrade' else 'bowie_knife_zm',zombie_cost='6000' if t=='tazer_upgrade' else '3000')
    if t=='claymore_purchase': e.update(targetname='weapon_upgrade',zombie_weapon_upgrade='claymore_zm',zombie_cost='1000')
    # One native candidate per buildable part each game.
    kind=next((k for k in equipment if e.get('classname')=='script_struct' and t.startswith(k+'_') and e.get('model')),None)
    if kind:
        group=kind+':'+e['model'];key='rise_part_'+str(len(partGroups.setdefault(group,[])))+'_'+str(E.index(e))
        partGroups[group].append(key);e.update(classname='script_model',targetname=key,risePart=kind,partGroup=group,itemId=key)
    bench=next((k for k in equipment if t==k+'_buildable_trigger'),None)
    if bench: e['riseBench']=bench
    if t=='keys_zm_P6_zm_hr_key':
        key='rise_key_'+str(len(keySpawns));keySpawns.append(key);e.update(classname='script_model',targetname=key,model='p6_zm_hr_key',riseKey=True,itemId=key)
    if t=='elevator_key_console_trigger': e.update(targetname='rise_elevator_call',position=None)
    if t=='escape_pod_key_console_trigger': e['targetname']='rise_pod_console'
for e in E: e.pop('position',None)
if not find('model_export/p6_zm_hr_key_lod0.glb'):
    for e in E:
        if e.get('riseKey'): e['model']='P6_zm_hr_key'

# init_elevator(): each body's stops are its own script_location plus the
# structs its target chain names. Every car but 3c repeats stop "1" last.
ELEVATORS={'1b':{},'1c':{'force':1},'1d':{},'3':{'pair':'3b'},'3b':{'pair':'3'},'3c':{'force':3},'3d':{'force':1}}
elevators=[]
for name,cfg in ELEVATORS.items():
    body=by['elevator_bldg'+name+'_body'][0];o=point(body)
    if name=='3b': o[2]+=8  # main(): elev_bldg3b.origin += (0,0,8)
    floors={body['script_location']:o[2]};t=body.get('target');seen=set()
    while t and t not in seen:
        seen.add(t);s=next(x for x in by[t] if x.get('classname')=='script_struct')
        floors.setdefault(s['script_location'],point(s)[2]);t=s.get('target')
    if name!='3c': floors[str(len(floors))]=floors['1']
    slot=next(x for x in original if x.get('script_noteworthy')=='zm_random_machine' and x.get('script_parameters')=='bldg'+name)
    spot=next(x for x in by[slot['target']] if x.get('classname')=='script_struct')
    trigger=next((x for x in by.get('elevator_bldg'+name+'_trigger',[])),None)
    elevators.append(dict(name=name,body='elevator_bldg'+name+'_body',origin=o,yaw=angles(body)[1],floors=floors,start=body['script_location'],
        force=cfg.get('force'),pair=cfg.get('pair'),slot=dict(origin=point(spot),angles=spot.get('angles','0 0 0'),building='green' if name.startswith('1') else 'blue'),
        quickRevive=slot.get('targetname')=='force_quick_revive',trigger=hulls(trigger) if trigger else []))
for e in E:
    if e.get('targetname','').startswith('elevator_bldg') and e['targetname'].endswith('_body') and e['targetname']!='elevator_bldg1a_body': e['riseElevator']=e['targetname'][len('elevator_bldg'):-len('_body')]
# The machines that ride the cars (init_elevator_perks: Quick Revive on 1b,
# Who's Who and Speed Cola on the other green cars, the rest on blue cars).
machines=[('specialty_quickrevive','zombie_vending_revive_on','green',10),('specialty_finalstand','p6_zm_vending_chugabud_on','green',-3),('specialty_fastreload','zombie_vending_sleight_on','green',14),
          ('specialty_additionalprimaryweapon','zombie_vending_three_gun_on','blue',8),('specialty_armorvest','zombie_vending_jugg_on','blue',6),('specialty_rof','zombie_vending_doubletap2_on','blue',5),('specialty_weapupgrade','p6_anim_zm_buildable_pap_on','blue',0)]
first=elevators[0]['slot']
for perk,m,building,offset in machines:
    key='rise_machine_'+perk
    E.append(dict(classname='script_model',targetname=key,model=m if find('model_export/'+m+'_lod0.glb') else m.removesuffix('_on'),origin=text(first['origin']),angles=first['angles'],riseMachine=perk))
    E.append(dict(classname='script_struct',targetname='zombie_vending_upgrade' if perk=='specialty_weapupgrade' else 'zombie_vending',target=key,origin=text([*first['origin'][:2],first['origin'][2]+35]),angles=first['angles'],script_noteworthy=perk,riseMachine=perk))
perkMachines=[dict(perk=p,building=b,offset=o) for p,_,b,o in machines]
pod=by['elevator_bldg1a_body'][0];podBottom=point(next(x for x in by[pod['target']] if x.get('classname')=='script_struct'))
escapePod=dict(body='elevator_bldg1a_body',home=point(pod),bottom=podBottom,yaw=angles(pod)[1],trigger=hulls(by['escape_pod_trigger'][0]),doorClip='elevator_bldg1a_body_door_clip')

volumes=[]
for e in E:
    if e.get('script_noteworthy')!='player_volume': continue
    volumes.append(dict(name=e['targetname'],spawners=e.get('target',e['targetname']+'_spawners'),hulls=hulls(e)))
killVolumes=[dict(hulls=hulls(e),kind=e['targetname']) for e in E if e.get('targetname') in ('instant_death','instant_death_escape_pod_shaft','zombie_fell_off') and e.get('model','').startswith('*')]
# Barrier crossings are the native mantle negotiations at each exterior goal.
nodes=json.loads((DATA/'bo2-die-rise/web-world/zm_highrise.paths.json').read_text())['nodes']
specs={}
for i,n in enumerate(nodes):
    if n['type']!=17: continue
    specs[i]=next((e for e in original if e.get('classname')=='node_negotiation_begin' and e.get('target')==n['target'] and sum((a-b)**2 for a,b in zip(point(e),n['origin']))<1),{})
goals={}
for e in [e for e in E if e.get('targetname')=='exterior_goal']:
    g=point(e);best=None
    for i,spec in specs.items():
        if not spec.get('animscript','').startswith('zm_mantle_over_40'):continue
        d=math.dist(nodes[i]['origin'],g)
        if best is None or d<best[0]: best=(d,i)
    if best is None or best[0]>160: print('Warning: no barrier crossing near '+e['target']+' ('+str(round(best[0] if best else -1))+')'); continue
    i=best[1];end=next((nodes[l['node']] for l in nodes[i]['links'] if l['negotiation']),None)
    if not end: continue
    key='rise_traverse_'+str(i);n=nodes[i]
    E.extend([dict(classname='script_struct',targetname='traverse',target=key,origin=text([*n['origin'][:2],n['origin'][2]-16]),angles='0 '+str(n['angle'])+' 0'),dict(classname='script_struct',targetname=key,origin=text([*end['origin'][:2],end['origin'][2]-16]))])
    # Each spawn_location names the barricade it attacks (script_string);
    # the goal belongs to that spawner's zone.
    owner=next((x['targetname'] for x in E if x.get('nativeNoteworthy')=='spawn_location' and x.get('script_string')==e.get('script_string')),None)
    zone=next((v for v in volumes if v['spawners']==owner),None)
    if zone is None:
        p=end['origin'];zone=min(volumes,key=lambda v:min(sum(max(h['mins'][k]-p[k],0,p[k]-h['maxs'][k])**2 for k in range(3)) for h in v['hulls']))
    goals[e['target']]=dict(zone=zone['name'],spawners=zone['spawners'],barricade=e.get('script_string'))

animations={}
def add_animation(name):
    if name in animations: return True
    p=find('web-anims/'+name+'.json')
    if not p: return False
    animations[name]=animation(p.relative_to(DATA).parts[0],name);return True
for z in reversed(SEARCH):
    for p in (DATA/z/'web-anims').glob('ai_zombie_*.json'):
        if re.match(r'ai_zombie_(?:walk_v|run_v|sprint_v|attack_v|attack_forward_v|walk_attack_v|run_attack_v|idle_v|traverse_v|door_tear|traverse_ground_(?:v1_walk|v1_run|climbout_fast)$|leaper_(?:run_f|attack_v|death_v))',p.stem): add_animation(p.stem)
idle=find('web-anims/ai_zombie_idle_v1_delta.json')
if idle and not find('web-anims/ai_zombie_idle_v1.json'):
    (DATA/'bo2-die-rise/web-anims/ai_zombie_idle_v1.json').write_bytes(idle.read_bytes())
add_animation('ai_zombie_idle_v1')
# The native traversal animscript for each negotiation (zm_<alias>).
SPECIAL={'mantle_over_40':'ai_zombie_traverse_v1','mantle_over_40_hurdle':'ai_zombie_traverse_v1','jump_up_antenna':'ai_zombie_jump_up_grabbed_antenna',
         'dierise_counter_to_stools':'ai_zombie_traverse_round_counter_to_stools','dierise_counter_from_stools':'ai_zombie_traverse_round_counter_from_stools',
         'dierise_escape_hallway':'ai_zombie_traverse_dierise_escape_corridor','dierise_chrest_jump_up':'ai_zombie_traverse_dierise_chrest_interior_low_to_high',
         'dierise_chrest_jump_down':'ai_zombie_traverse_dierise_chrest_interior_high_to_low','dierise_chrest_jump_up_2':'ai_zombie_traverse_dierise_chrest_interior_alt_low_to_high',
         'dierise_chrest_jump_down_2':'ai_zombie_traverse_dierise_chrest_interior_alt_high_to_low'}
traversals={};fallbacks=0
for i,spec in specs.items():
    alias=spec.get('animscript','').removeprefix('zm_')
    if not alias or 'elevator' in alias: continue
    end=next((nodes[l['node']] for l in nodes[i]['links'] if l['negotiation']),None)
    if not end: continue
    name=SPECIAL.get(alias) or ('ai_zombie_traverse_'+alias if alias.startswith('dierise_') else 'ai_zombie_'+alias)
    if not add_animation(name):
        rise=end['origin'][2]-nodes[i]['origin'][2];fallbacks+=1
        name=next(n for n in (['ai_zombie_jump_up_127','ai_zombie_jump_up_175'] if rise>40 else ['ai_zombie_jump_down_96','ai_zombie_jump_down_127'] if rise<-40 else ['ai_zombie_traverse_v1']) if add_animation(n))
    traversals[i]=dict(animation=name,arc=40 if alias.startswith('mantle') else 12 if 'up' in alias else 0)
presentation=dict(animations=animations,effects={},actors=dict(body='c_zom_zombie_civ_shorts_body',head='c_zom_zombie_chinese_head1'),powerups=dict(full_ammo='zombie_ammocan',insta_kill='zombie_skull',double_points='zombie_x2_icon',nuke='zombie_bomb',carpenter='zombie_carpenter',fire_sale='zombie_firesale'),box=dict(openAngle=105,openTime=.5,floatHeight=40,riseTime=3,offerTime=12,closeTime=.5,cooldown=3,teddyModel='zombie_teddybear',cycleDelays=[.05]*20+[.1]*10+[.2]*5+[.3]*3))
leaperClips={'ai_zombie_walk_v1':'ai_zombie_leaper_run_f','ai_zombie_attack_v1':'ai_zombie_leaper_attack_v1','ai_zombie_attack_v2':'ai_zombie_leaper_attack_v2','ai_zombie_death_v1':'ai_zombie_leaper_death_v1','ai_zombie_death_v2':'ai_zombie_leaper_death_v2'}
leaperClips={k:v for k,v in leaperClips.items() if add_animation(v)}
presentation['actorVariants']={'leaper':dict(body='c_zom_leaper_body',head='c_zom_leaper_head',neckModel='c_zom_leaper_body_g_behead',count=10,animations=leaperClips)}
for z in reversed(SEARCH):
    for p in (DATA/z/'web-fx').rglob('*.json'):
        if not re.search(r'powerup|grenade|blood|wall_buy|highrise|perk|pap|raygun|ray_gun|magicbox|sun_sm_short|leaper|elevator|liquifier|fx_zmb_goo|key_glint|slipgun|electric|switch',str(p)): continue
        fx=load_effect(p,SEARCH,effect_blending=True)
        if 'grenadeexp_concrete' in fx['name']: fx['name']='explosions/grenadeexp_concrete'
        presentation['effects'][fx['name']]=fx
hud=OUT/'hud'; hud.mkdir(exist_ok=True)
art=['overlay_low_health','hit_direction_zm','menu_zm_highrise_zclassic_rooftop','menu_zm_map_signpost_highrise','hud_us_grenade','scorebar_zom_5','specialty_juggernaut_zombies','specialty_fastreload_zombies','specialty_doubletap_zombies','specialty_quickrevive_zombies','specialty_mulekick_zombies','specialty_chugabud_zombies',*[f'chalkmarks_{i}' for i in range(1,6)]]
for n in art:
    p=find('images/'+n+'.dds')
    if p:
        with Image.open(p) as img: img.convert('RGBA').save(hud/(n+'.png'))
poster=next((hud/(n+'.png') for n in ['menu_zm_highrise_zclassic_rooftop','menu_zm_map_signpost_highrise'] if (hud/(n+'.png')).exists()),None)
if poster: (hud/'die-rise-load.png').write_bytes(poster.read_bytes())
else: raise RuntimeError('Missing original Die Rise loading art')
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
remap=dict(mx_splash_screen='mus_zombie_splash_screen',mx_zombie_wave_1='mus_highrise_underscore',chalk='mus_zombie_round_start',round_over='mus_zombie_round_over',cha_ching='zmb_cha_ching',no_cha_ching='zmb_no_cha_ching',repair_boards='zmb_repair_boards',remove_boards='zmb_break_boards',grenade_explode='wpn_grenade_explode_default',grenade_explode_bass='wpn_grenade_explode_lfe',grenade_bounce_concrete='wpn_grenade_bounce_concrete',melee_hit='wpn_melee_knife_hit_body',lid_open='zmb_lid_open',lid_close='zmb_lid_close',music_box='zmb_music_box',spawn_powerup='zmb_spawn_powerup',spawn_powerup_loop='zmb_spawn_powerup_loop',powerup_grabbed='zmb_powerup_grabbed',full_ammo='zmb_full_ammo',insta_kill='zmb_insta_kill',double_point='zmb_points_loop',nuke='evt_nuked',mx_jugger_sting='mus_perks_jugganog_sting',mx_speed_sting='mus_perks_speed_sting',mx_doubletap_sting='mus_perks_doubletap_sting',mx_revive_sting='mus_perks_revive_sting',mx_packa_sting='mus_perks_packa_sting',perks_power_on='zmb_perks_power_on',packa_rollers_loop='zmb_perks_packa_loop',packa_weap_upgrade='zmb_perks_packa_upgrade',packa_weap_ready='zmb_perks_packa_ready',ticktock_loop='zmb_perks_packa_ticktock',packa_deny='zmb_perks_packa_deny')
remap.update(mx_mule_sting='mus_perks_mulekick_sting',mx_whoswho_sting='mus_perks_whoswho_sting',dog_start='mus_zombie_dog_start',dog_end='mus_zombie_dog_end',switch_flip='zmb_switch_flip',electrical_surge='zmb_turn_on')
required.update(remap.values()); required.update(['mus_zombie_game_over','mus_fire_sale','amb_alarm_bell','evt_poweron_front'])
sounds={}
for n,rows in aliases.items():
    if n not in required and not re.match(r'(zmb_|zombie_|evt_|mus_perks|vox_ann_|vox_zmba_|fly_step_|wpn_knife|wpn_grenade|wpn_slipgun)',n): continue
    unique=list({r['url']:r for r in rows}.values()); sounds[n]=unique[:12] if re.match(r'zmb_vocals_|fly_step_',n) else rows[:2]
for n,native in remap.items():
    if native in aliases: sounds[n]=aliases[native][:2]
voice={n:rows[:1] for n,rows in aliases.items() if re.match(r'vox_plr_[0-3]_(?:ammo_low|ammo_out|level_start|nomoney|revive_down|revive_up|perk_|powerup_|kill_|wpck_).*_[01]$',n)}
def gore_texture(n):
    p=find('materials/'+n+'.json'); image=next(t['image'] for t in json.loads(p.read_text())['textures'] if t['semantic']=='colorMap')
    return '/data/'+find('images/'+image.lstrip(',')+'.dds').relative_to(DATA).as_posix()
presentation['gore']=dict(neckModel='c_zom_zombie_scientist_body_g_behead',neckMount='body',headSound='zmb_zombie_head_gib',burst=gore_texture('gfx_fxt_bio_bloodburst'),drops=gore_texture('gfx_fxt_bio_blooddrops'),decals=[gore_texture('wc/gfx_impact_blood_spatter%02d'%n) for n in [1,2,3]])
variables=json.loads((DATA/'gameplay/bo2-buried/manifest.json').read_text())['variables'].copy()
# highrise_zone_init(); the fourth argument marks a one-way adjacency.
connections=[[a,b,flag,bool(one)] for a,b,flag,one in re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*(?:,\s*(\d))?\s*\)',script)]
shafts=re.search(r'init_elevator_shaft_zones\(\)\s*\{\s*a_zones = array\(([^)]*)\)',script)
initialZones=['zone_green_start','zone_orange_level3a','zone_green_level3d','zone_blue_level2a',*re.findall(r'"([^"]+)"',shafts.group(1))]
clip=lambda n:json.loads(find('web-anims/'+n+'.json').read_text())
manifest=dict(format='bo2-die-rise-solo-v1',game='black-ops-2',startWeapon='m1911_zm',variables=variables,weapons=W,grenade=grenade,gestures=gestures,entities=E,sounds=sounds,voice=voice,characterNames=['Russman','Stuhlinger','Misty','Marlton'],characterArms=arms,
    playerBodies=[dict(body='c_zom_player_'+n+'_dlc1_fb') for n in ['oldman','reporter','farmgirl','engineer']],weaponNames={n:n.replace('_upgraded_zm',' (Pack-a-Punch)').replace('_zm','').replace('_',' ').upper() for n in W},
    map=dict(id='die-rise',initialZone='zone_green_start',kinematicPaths=True,initialZones=initialZones,connections=connections,volumes=volumes,goals=goals,negotiationBegin=17,negotiationEnd=18,initialBox='start_chest',boxWeapons=sorted(set(box)),boxMoves=True,
       boxExclusive=[['ray_gun_zm','raygun_mark2_zm']],powerTargets=[],initialDisabled=[escapePod['doorClip'],'elevator_delete','leaper_traversal_clip','zombie_traversal_clip'],openRisers=True,elevators=elevators,escapePod=escapePod,perkMachines=perkMachines,partGroups=partGroups,keySpawns=keySpawns,
       leaperSpawns=leaperSpawns,killVolumes=killVolumes,leaperHealth=[400,900,1300,1600],leapersPerPlayer=6,
       propModels=['p6_anim_zm_magic_box_fake','zombie_teddybear'],propAnimations=['o_zombie_magic_box_'+n for n in ['open','close','arrive','leave']],
       boxClips={n:max(1,clip('o_zombie_magic_box_'+n)['frames'])/clip('o_zombie_magic_box_'+n)['fps'] for n in ['open','close','arrive','leave']}),
    wallCosts={n:c for n,(_,c) in registry.items()},meleeUpgrades={n:weapon(n) for n in ['bowie_knife_zm','tazer_knuckles_zm'] if find('weapons/'+n)},equipment=equipment,
    playerAnimations=sorted({p.stem for z in SEARCH for p in (DATA/z/'web-anims').glob('pb_*.json') if re.match(r'pb_(?:stand_alert|stand_ads|sprint|combatrun|combatwalk|crouch_alert|crouch_run|prone_aim|prone_crawl|dive_prone|laststand)',p.stem)}),
    provenance=dict(world='maps/mp/zm_highrise.d3dbsp',rules='owned decompiled zm_highrise*.gsc',runtime='shared T6 browser reconstruction'))
manifest['map']['traversals']=traversals
manifest['map']['wallbuyEffects']={n:'maps/zombie/fx_zmb_wall_buy_'+fx for n,fx in {'m14_zm':'m14','rottweil72_zm':'olympia','870mcs_zm':'870mcs','m16_zm':'m16','mp5k_zm':'mp5k','ak74u_zm':'ak74u','beretta93r_zm':'berreta93r','pdw57_zm':'pdw57','svu_zm':'svuas','an94_zm':'an94','sticky_grenade_zm':'semtex'}.items()}
write('manifest.json',manifest); write('presentation.json',presentation)
print(json.dumps(dict(entities=len(E),weapons=len(W),volumes=len(volumes),barriers=len(goals),elevators=len(elevators),traversals=len(traversals),traversalFallbacks=fallbacks,leaperSpawns=len(leaperSpawns),keys=len(keySpawns),partGroups=len(partGroups),sounds=len(sounds),animations=len(animations))))
