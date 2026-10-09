"""Prepare owned Mob of the Dead assets and script-derived solo rules on E:."""
from pathlib import Path
from collections import defaultdict
import csv, json, re, subprocess, shutil, math, struct
from PIL import Image
from inspect_game import parse_entities
from prepare_fidelity import animation, load_effect

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'local-data'
SEARCH=['bo2-mob-patch','bo2-mob-classic','bo2-mob','bo2-mob-english','bo2-mob-load','bo2-base','bo2-common','bo2-english','bo2-menu','bo2-ui-base','bo2-ui']
OUT=DATA/'gameplay/bo2-mob'; OUT.mkdir(parents=True,exist_ok=True)
def find(n):return next((DATA/z/n for z in SEARCH if (DATA/z/n).is_file()),None)
def write(n,v):(OUT/n).write_text(json.dumps(v,separators=(',',':')),encoding='utf-8')
def point(e):return list(map(float,e['origin'].split()))
def text(p):return ' '.join(str(round(v,3)) for v in p)
def weapon(n):
    p=find('weapons/'+n)
    if not p:raise FileNotFoundError('Original Mob weapon unavailable: '+n)
    v=p.read_text(encoding='utf-8').split('\\')
    return {k:float(x) if re.fullmatch(r'-?\d+(?:\.\d*)?',x) else x for k,x in zip(v[1::2],v[2::2])}

subprocess.run(['python','-B',str(ROOT/'tools/prepare_bo2_world.py'),'--zone','bo2-mob','--asset','zm_prison','--search',','.join(SEARCH)],cwd=ROOT,check=True)
original=parse_entities(DATA/'bo2-mob/maps/mp/zm_prison.d3dbsp.ents')
C=json.loads((DATA/'bo2-mob/web-world/zm_prison.collision.json').read_text(encoding='utf-8'))
nodes=json.loads((DATA/'bo2-mob/web-world/zm_prison.paths.json').read_text(encoding='utf-8'))['nodes']
scripts=DATA/'bo2-mob-scripts/t6/maps/mp';script=(scripts/'zm_prison.gsc').read_text(encoding='utf-8')
by=defaultdict(list)
for e in original:by[e.get('targetname','')].append(e)
def hulls(e):
    o=point(e)
    return [dict(mins=[v+o[k] for k,v in enumerate(C['brushes'][i]['mins'])],maxs=[v+o[k] for k,v in enumerate(C['brushes'][i]['maxs'])],planes=[[*p[:3],p[3]+sum(p[k]*o[k] for k in range(3))] for p in C['brushes'][i]['planes']]) for i in C['models'][int(e['model'][1:])]['brushes']]

registry={n:(up,int(cost)) for n,up,cost in re.findall(r'add_zombie_weapon_prison\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*[^,\n]+,\s*(\d+)',script)}
unsupported={'fivesevendw_zm','knife_zm','knife_zm_alcatraz','spoon_zm_alcatraz','spork_zm_alcatraz','frag_grenade_zm','claymore_zm','willy_pete_zm','bouncing_tomahawk_zm'}
base={n for n in registry if n not in unsupported and find('weapons/'+n)}
names=base|{registry[n][0] for n in base if registry[n][0] and find('weapons/'+registry[n][0])}|{'lightning_hands_zm'}
W={n:weapon(n) for n in sorted(names)}
arms=['c_zom_oleary_shortsleeve_viewhands','c_zom_deluca_longsleeve_viewhands','c_zom_handsome_sleeveless_viewhands','c_zom_arlington_coat_viewhands']
knife=weapon('knife_zm_alcatraz')
for n,w in W.items():
    if n.startswith(('ray_gun','raygun_mark2')):w['startAmmo']+=w['clipSize']
    else:w['startAmmo']=(w['startAmmo']+1)*w['clipSize'];w['maxAmmo']*=w['clipSize']
    w.update(handsModel=arms[0],knifeModel=knife['gunModel'],meleeSwipeSoundPlayer='wpn_knife_pull_plr')
    for k in ['meleeAnim','meleeChargeAnim','meleeDamage','meleeDelay','meleeChargeDelay','meleeTime','meleeChargeTime','meleeChargeRange']:w[k]=knife[k]
    for k,f in [('lastShotAnim','fireAnim'),('adsFireAnim','fireAnim'),('adsLastShotAnim','lastShotAnim'),('emptyIdleAnim','idleAnim')]:
        if not w.get(k):w[k]=w.get(f,'')
    if registry.get(n,('',0))[0] in W:w['upgrade']=registry[n][0]
    if not w.get('locHead'):w['locHead']=1
W['lightning_hands_zm'].update(handsModel='c_zom_ghost_viewhands',mobGhostHands=True)
grenade=dict(weapon('frag_grenade_zm'),handsModel=arms[0])
gestures={k:dict(weapon(n),name=n,handsModel=arms[0]) for k,n in {'death_throe':'death_throe_zm','specialty_armorvest':'zombie_perk_bottle_jugg','specialty_fastreload':'zombie_perk_bottle_sleight','specialty_rof':'zombie_perk_bottle_doubletap','specialty_deadshot':'zombie_perk_bottle_deadshot','specialty_grenadepulldeath':'zombie_perk_bottle_cherry','zombie_builder':'zombie_builder_zm','knuckle_crack':'zombie_knuckle_crack','mob_revive':'syrette_afterlife_zm'}.items() if find('weapons/'+n)}
if 'death_throe' in gestures:gestures['death_throe']['gunModel']='t6_wpn_none_view'
if 'mob_revive' in gestures:gestures['mob_revive']['handsModel']='c_zom_ghost_viewhands';gestures['mob_revive']['mobGhostHands']=True

E=[dict(e) for e in original if not e.get('script_gameobjectname') or e['script_gameobjectname']=='zclassic']
parts={};shockDoors={};powerFlags={'specialty_armorvest':'juggernog_on','specialty_fastreload':'sleight_on','specialty_rof':'doubletap_on','specialty_deadshot':'deadshot_on','specialty_grenadepulldeath':'electric_cherry_on'}
for e in list(E):
    t=e.get('targetname','');s=e.get('script_noteworthy','');c=e.get('classname','')
    if c.startswith('actor_'):E.remove(e);continue
    if s in ['spawn_location','riser_location']:
        e.update(nativeNoteworthy='find_flesh' if s=='spawn_location' and e.get('script_string')=='find_flesh' else s,script_noteworthy='zombie_spawner')
    if 'magicbox' in c.lower():e.update(classname='script_model',model='p6_anim_zm_al_magic_box',targetname=s.replace('_zbarrier',''))
    if t=='treasure_chest_use':e['target']=s
    if c.startswith('zbarrier') and 'magicbox' not in c.lower():
        for i in range(1,7):
            if e.get('zbarrierboardmodel'+str(i)):E.append(dict(classname='script_model',targetname=t,model=e['zbarrierboardmodel'+str(i)],origin=e['origin'],angles=e.get('angles','0 0 0'),closedAnim=e['zbarrierboardanim'+str(i)],nativeBoard=str(i)))
    if t=='weapon_upgrade':
        n=e['zombie_weapon_upgrade'];cost=registry.get(n,('',250 if n=='frag_grenade_zm' else 1000))[1];e.update(zombie_cost=str(cost),script_ammo_clip=str(cost//2))
    if t=='zm_perk_machine':
        if 'zclassic_perks_prison' not in e.get('script_string',''):E.remove(e);continue
        perk=s;key='mob_machine_'+perk
        # The level's perk-asset override uses prison-specific broken machines.
        e['model']={'specialty_rof':'p6_zm_al_vending_doubletap2_on','specialty_armorvest':'p6_zm_al_vending_jugg_on','specialty_fastreload':'p6_zm_al_vending_sleight_on','specialty_deadshot':'p6_zm_al_vending_ads_on','specialty_weapupgrade':'p6_zm_al_vending_pap_on'}.get(perk,e['model'])
        if not find('model_export/'+e['model']+'_lod0.glb') and find('model_export/'+e['model']+'_on_lod0.glb'):e['model']+='_on'
        E.append(dict(classname='script_model',targetname=key,model=e['model'],origin=e['origin'],angles=e.get('angles','0 0 0'),mobMachine=perk))
        e.update(targetname='zombie_vending_upgrade' if perk=='specialty_weapupgrade' else 'zombie_vending',target=key,powerFlag=powerFlags.get(perk,''),origin=text([*point(e)[:2],point(e)[2]+35]))
    if s=='afterlife_door':
        link=next(x for x in by[e['target']] if x.get('classname')=='script_struct' and x.get('target'))
        shockDoors[link['target']]=dict(target=e['target'],flag=e.get('script_flag'),cost=e['zombie_cost'])
    if t=='afterlife_interact' or s=='afterlife_door_shock_box':e.update(mobPanel=e.get('script_string',e['targetname']),mobPanelId=e['targetname']+'_'+e['guid'])
    if t.startswith(('plane_','refuelable_plane_fuel','alcatraz_shield_zm_','packasplat_')) and c=='script_struct' and e.get('model'):
        if t in ['plane_cloth','plane_fueltanks','plane_engine','plane_steering','plane_rigging'] or t.startswith(('refuelable_plane_fuel','alcatraz_shield_zm_','packasplat_')):
            group=t;e.update(classname='script_model',mobItem=group,itemGroup=group,itemId='mob_part_'+str(len(parts.setdefault(group,[]))))
            e['itemId']=group+'_'+e['guid']+'_'+str(len(parts[group]));parts[group].append(e['itemId']);e['targetname']=e['itemId']
    if t=='quest_key1_p6_zm_al_key':e.update(classname='script_model',mobItem='wardens_key',itemGroup='wardens_key',itemId='mob_wardens_key')
    if t=='plane_craftable':e['mobPlane']=True
    if t in ['grief_clips','no_afterlife_move'] and c=='script_brushmodel':e['mobInitiallyOpen']=True

volumes=[dict(name=e['targetname'],spawners=e.get('target',e['targetname']+'_spawners'),hulls=hulls(e)) for e in E if e.get('script_noteworthy')=='player_volume']
goals={e['target']:dict(zone=e['script_string'],spawners=next((v['spawners'] for v in volumes if v['name']==e['script_string']),e['script_string']+'_spawners')) for e in E if e.get('targetname')=='exterior_goal'}
for e in list(E):
    if e.get('targetname')!='exterior_goal':continue
    spec=next(s for s in original if s.get('classname')=='node_negotiation_begin' and s.get('targetname')==e['target'])
    n=next(n for n in nodes if n['type']==17 and n['target']==spec['target'] and math.dist(n['origin'],point(spec))<1)
    end=next(nodes[l['node']] for l in n['links'] if l['negotiation'])
    key='mob_window_entry_'+e['target']
    E.extend([dict(classname='script_struct',targetname='traverse',target=key,origin=text([*n['origin'][:2],n['origin'][2]-16]),angles=spec.get('angles','0 0 0')),dict(classname='script_struct',targetname=key,origin=text([*end['origin'][:2],end['origin'][2]-16]))])
animations={}
def add_anim(n):
    p=find('web-anims/'+n+'.json')
    if not p:return False
    if n not in animations:animations[n]=animation(p.relative_to(DATA).parts[0],n)
    return True
for z in reversed(SEARCH):
    for p in (DATA/z/'web-anims').glob('ai_zombie_*.json'):
        if re.match(r'ai_zombie_(?:walk_v|run_v|sprint_v|attack_v|attack_forward_v|walk_attack_v|run_attack_v|idle_v|traverse_v|door_tear|traverse_ground_)',p.stem):add_anim(p.stem)
if not add_anim('ai_zombie_idle_v1'):
    p=find('web-anims/ai_zombie_idle_v1_delta.json')
    if p:target=DATA/'bo2-mob/web-anims/ai_zombie_idle_v1.json';target.write_bytes(p.read_bytes());add_anim('ai_zombie_idle_v1')
traversals={}
for i,n in enumerate(nodes):
    if n['type']!=17:continue
    spec=next((e for e in original if e.get('classname')=='node_negotiation_begin' and e.get('target')==n['target'] and math.dist(point(e),n['origin'])<1),{})
    alias=spec.get('animscript','').removeprefix('zm_');name='ai_zombie_traverse_v1' if alias.startswith('mantle_over_40') else 'ai_zombie_'+alias
    if not add_anim(name):name='ai_zombie_traverse_'+alias
    if add_anim(name):traversals[i]=dict(animation=name,arc=40 if alias.startswith('mantle') else 0)
brutusMap={'ai_zombie_walk_v1':'ai_zombie_cellbreaker_walk_a','ai_zombie_run_v1':'ai_zombie_cellbreaker_run_a','ai_zombie_sprint_v1':'ai_zombie_cellbreaker_sprint_a','ai_zombie_idle_v1':'ai_zombie_cellbreaker_idle_a','ai_zombie_attack_v1':'ai_zombie_cellbreaker_attack_swingleft','ai_zombie_attack_v2':'ai_zombie_cellbreaker_attack_swingright_a','ai_zombie_death_v1':'ai_zombie_cellbreaker_death'}
brutusMap={k:v for k,v in brutusMap.items() if add_anim(v)}
presentation=dict(animations=animations,effects={},actors=dict(body='c_zom_guard_body',head='c_zom_zombie_hellcatraz_head'),actorVariants={'brutus':dict(body='c_zom_cellbreaker_fb',count=2,attachments=[dict(model='c_zom_cellbreaker_helmet',tag='j_head')],animations=brutusMap)},powerups=dict(full_ammo='zombie_ammocan',insta_kill='zombie_skull',double_points='zombie_x2_icon',nuke='zombie_bomb',carpenter='zombie_carpenter',fire_sale='zombie_firesale'),box=dict(openAngle=105,openTime=.5,floatHeight=40,riseTime=3,offerTime=12,closeTime=.5,cooldown=3,teddyModel='zombie_teddybear',cycleDelays=[.05]*20+[.1]*10+[.2]*5+[.3]*3))
# Native pickups shared with the owned base map must also be in this pack.
for name in ['zombie_firesale','zombie_carpenter','zombie_teddybear']:
    for suffix,folder in [('_lod0.glb','model_export'),('.json','xmodel')]:
        relative=folder+'/'+name+suffix
        if find(relative):continue
        source=next((DATA/z/relative for z in ['bo2-buried','bo2-nuketown','bo2-origins'] if (DATA/z/relative).is_file()),None)
        if not source:raise FileNotFoundError('Original shared pickup unavailable: '+name)
        target=DATA/'bo2-mob'/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    # A shared GLB also needs its original material and texture dependencies.
    shared=['bo2-buried','bo2-patch','bo2-nuketown','bo2-origins','bo2-common','bo2-base']
    def shared_copy(relative):
        if find(relative):return
        source=next((DATA/z/relative for z in shared if (DATA/z/relative).is_file()),None)
        if not source:raise FileNotFoundError('Shared native dependency unavailable: '+relative)
        target=DATA/'bo2-mob'/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    buf=find('model_export/'+name+'_lod0.glb').read_bytes();gltf=json.loads(buf[20:20+struct.unpack_from('<I',buf,12)[0]])
    for image in gltf.get('images',[]):
        if image.get('uri') and not image['uri'].startswith('data:') and '$identity' not in image['uri']:shared_copy('images/'+image['uri'].split('/')[-1].lstrip(','))
    for material in gltf.get('materials',[]):
        if not material.get('name'):continue
        relative='materials/'+material['name'].lstrip(',')+'.json';shared_copy(relative)
        for texture in json.loads(find(relative).read_text(encoding='utf-8')).get('textures',[]):
            if texture['semantic']=='colorMap':shared_copy('images/'+texture['image'].lstrip(',')+'.dds')
effects=['misc/fx_zombie_powerup_on','maps/zombie_alcatraz/fx_alcatraz_afterlife_damage','maps/zombie_alcatraz/fx_alcatraz_player_revive','maps/zombie_alcatraz/fx_alcatraz_afterlife_start','maps/zombie_alcatraz/fx_alcatraz_brut_spawn','maps/zombie_alcatraz/fx_alcatraz_powerup','explosions/fx_grenadeexp_concrete','misc/fx_zombie_eye_single']
for name in effects:
    p=find('fx/'+name+'.json')
    if p:
        fx=load_effect(p,SEARCH,effect_blending=True)
        if 'grenadeexp_concrete' in fx['name']:fx['name']='explosions/grenadeexp_concrete'
        presentation['effects'][fx['name']]=fx
hud=OUT/'hud';hud.mkdir(exist_ok=True)
art=['overlay_low_health','hit_direction_zm','hud_us_grenade','scorebar_zom_5','waypoint_revive_afterlife','afterlife_reticle','hud_zombie_afterlife_icon','minimap_icon_electric_cherry',*[f'chalkmarks_{i}' for i in range(1,6)]]
art+=sorted({p.stem for z in SEARCH for p in (DATA/z/'images').glob('specialty_*zombies.dds')})
art+=sorted({p.stem for z in SEARCH for p in (DATA/z/'images').glob('*prison*.dds') if any(t in p.stem for t in ['menu','loadscreen','scorebar'])})
for name in art:
    p=find('images/'+name+'.dds')
    if p:
        with Image.open(p) as img:img.convert('RGBA').save(hud/(name+'.png'))
# The original movie supplies the lobby/loading preview if it has no separate art.
subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-ss','4','-i',str(Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops II/video/zm_prison_load.webm')),'-frames:v','1',str(hud/'mob-load.png')],check=True)

def sound_hash(n):
    v=5381
    for c in n.lower():v=(ord(c)+0x1003f*v)&0xffffffff
    return '@'+format(v,'08x')
aliases={}
requestedHashes={v for w in [*W.values(),grenade,*gestures.values()] for k,v in w.items() if 'Sound' in k and isinstance(v,str)}
requestedNames={'wpn_knife_pull_plr','wpn_lightninghand_loop_plr'}
for w in [*W.values(),grenade,*gestures.values()]:
    for k,v in w.items():
        ap=find('web-anims/'+v+'.json') if k.endswith('Anim') and isinstance(v,str) and v else None
        if ap:requestedNames.update(n['name'][6:] for n in json.loads(ap.read_text()).get('notifies',[]) if n['name'].startswith('sndnt#'))
for z in reversed(SEARCH):
    for p in (DATA/z/'soundbank').glob('*.aliases.csv'):
        groups=defaultdict(list)
        for row in csv.DictReader(p.open()):
            relative=row['FileSource'].replace('\\','/').removeprefix('raw/');f=find(relative) or find(relative+'.wav') or find(relative+'.flac')
            if not f and (row['Name'] in requestedNames or sound_hash(row['Name']) in requestedHashes):
                for zone in ['bo2-buried','bo2-tranzit','bo2-origins']:
                    source=next((DATA/zone/(relative+s) for s in ['', '.wav','.flac'] if (DATA/zone/(relative+s)).is_file()),None)
                    if source:
                        target=DATA/'bo2-mob'/source.relative_to(DATA/zone);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);f=target;break
            if f:groups[row['Name']].append(dict(url='/data/'+f.relative_to(DATA).as_posix(),volume=min(1,float(row['VolMax'] or 100)/100),pitch=2**(float(row['PitchMax'] or 0)/1200)))
        aliases.update(groups)
hashes={sound_hash(n):n for n in aliases};required=set()
for w in [*W.values(),grenade,*gestures.values()]:
    for k,v in list(w.items()):
        if 'Sound' in k and isinstance(v,str) and v.startswith('@'):w[k]=hashes.get(v,v)
    w['notetrackSoundMap']='\n'.join(' '.join(hashes.get(t,t) for t in line.split()) for line in str(w.get('notetrackSoundMap','')).splitlines())
    required.update(v for k,v in w.items() if 'Sound' in k and isinstance(v,str) and v in aliases)
    required.update(line.split()[-1] for line in w['notetrackSoundMap'].splitlines() if line.strip())
remap=dict(mx_splash_screen='mus_zombie_splash_screen',mx_zombie_wave_1='mus_alcatraz_underscore',chalk='mus_zombie_round_start',round_over='mus_zombie_round_over',cha_ching='zmb_cha_ching',no_cha_ching='zmb_no_cha_ching',repair_boards='zmb_repair_boards',remove_boards='zmb_break_boards',grenade_explode='wpn_grenade_explode_default',grenade_explode_bass='wpn_grenade_explode_lfe',grenade_bounce_concrete='wpn_grenade_bounce_concrete',melee_hit='wpn_melee_knife_hit_body',lid_open='zmb_lid_open',lid_close='zmb_lid_close',music_box='zmb_music_box',spawn_powerup='zmb_spawn_powerup',spawn_powerup_loop='zmb_spawn_powerup_loop',powerup_grabbed='zmb_powerup_grabbed',full_ammo='zmb_full_ammo',insta_kill='zmb_insta_kill',double_point='zmb_points_loop',nuke='evt_nuked',mx_jugger_sting='mus_perks_jugganog_sting',mx_speed_sting='mus_perks_speed_sting',mx_doubletap_sting='mus_perks_doubletap_sting',mx_packa_sting='mus_perks_packa_sting',mx_deadshot_sting='mus_perks_deadshot_sting',mx_cherry_sting='mus_perks_cherry_sting',perks_power_on='zmb_perks_power_on',packa_rollers_loop='zmb_perks_packa_loop',packa_weap_upgrade='zmb_perks_packa_upgrade',packa_weap_ready='zmb_perks_packa_ready',ticktock_loop='zmb_perks_packa_ticktock',packa_deny='zmb_perks_packa_deny')
required.update(remap.values())
required.update(requestedNames)
sounds={n:list({r['url']:r for r in rows}.values())[:(8 if re.match(r'zmb_vocals_|fly_step_',n) else 2)] for n,rows in aliases.items() if n in required or re.match(r'(zmb_|zombie_|evt_|mus_perks|mus_alcatraz|vox_ann_|wpn_knife|wpn_grenade|fly_step_)',n)}
for n,native in remap.items():
    if native in aliases:sounds[n]=aliases[native][:2]
if not sounds.get('mx_zombie_wave_1'):
    candidate=next((n for n in aliases if re.match(r'mus_.*(?:underscore|round_1)',n)),None)
    if candidate:sounds['mx_zombie_wave_1']=aliases[candidate][:1]
voice={n:rows[:1] for n,rows in aliases.items() if re.match(r'vox_plr_[0-3]_',n)}
def gore_texture(n):
    p=find('materials/'+n+'.json');image=next(t['image'] for t in json.loads(p.read_text(encoding='utf-8'))['textures'] if t['semantic']=='colorMap')
    return '/data/'+find('images/'+image.lstrip(',')+'.dds').relative_to(DATA).as_posix()
presentation['gore']=dict(headSound='zmb_zombie_head_gib',burst=gore_texture('gfx_fxt_bio_bloodburst'),drops=gore_texture('gfx_fxt_bio_blooddrops'),decals=[gore_texture('wc/gfx_impact_blood_spatter%02d'%n) for n in [1,2,3]])
boxPrefix='o_zombie_dlc2_magic_box_';propAnimations=[boxPrefix+n for n in ['open','close','arrive','leave']]+['fxanim_zom_al_shock_box_on_anim','fxanim_zom_al_shock_box_off_anim']
propAnimations=[n for n in propAnimations if find('web-anims/'+n+'.json')]
connections=[[a,b,f] for a,b,f in re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"',script)]
variables=json.loads((DATA/'gameplay/bo2-buried/manifest.json').read_text())['variables'].copy()
manifest=dict(format='bo2-mob-solo-v1',game='black-ops-2',startWeapon='m1911_zm',variables=variables,weapons=W,grenade=grenade,gestures=gestures,entities=E,sounds=sounds,voice=voice,
    characterNames=['Finn O’Leary','Sal DeLuca','Billy Handsome','Albert Arlington'],characterArms=arms,playerBodies=[dict(body='c_zom_player_'+n+'_fb') for n in ['oleary','deluca','handsome','arlington']],equipment={},
    weaponNames={n:n.replace('_upgraded_zm',' (Pack-a-Punch)').replace('_zm','').replace('_',' ').upper() for n in W},
    map=dict(id='mob-of-the-dead',initialZone='zone_start',initialZones=['zone_start','zone_library'],kinematicPaths=True,connections=connections,volumes=volumes,goals=goals,negotiationBegin=17,negotiationEnd=18,
        initialBox='start_chest',boxWeapons=sorted(n for n in base if n not in ['m1911_zm','beretta93r_zm','rottweil72_zm','m14_zm','uzi_zm','mp5k_zm','blundersplat_zm','raygun_mark2_zm']),boxMoves=True,powerTargets=[],initialDisabled=[e['targetname'] for e in E if e.get('mobInitiallyOpen')],openRisers=True,traversals=traversals,
        parts=parts,shockDoors=shockDoors,corpseStarts=[point(e) for i in range(1,5) for e in by['corpse_starting_point_'+str(i)]],brutusSpawns=[point(e) for e in original if e.get('script_noteworthy')=='brutus_location'],
        afterlifeDoors=[e['targetname'] for e in E if e.get('targetname')=='afterlife_door' and e.get('classname')=='script_brushmodel'],
        bridgeSpawn=point(by['gg_bridge_player_respawn'][0]),gondolaStops=dict(roof=point(by['cellblock_gondola_platform_player_respawn'][0]),docks=point(by['dock_gondola_player_respawn'][0])),
        propModels=['c_zom_ghost_viewhands','c_zom_hero_ghost_fb','p6_zm_al_shock_box_on','skybox_zm_alcatraz'],propAnimations=propAnimations,boxAnimationPrefix=boxPrefix,boxFakeModel=None),
    wallCosts={n:c for n,(_,c) in registry.items()},meleeUpgrades={},playerAnimations=sorted({p.stem for z in SEARCH for p in (DATA/z/'web-anims').glob('pb_*.json') if re.match(r'pb_(?:stand_alert|stand_ads|sprint|combatrun|combatwalk|crouch_alert|crouch_run|prone_aim|prone_crawl|dive_prone|laststand)',p.stem)}),
    provenance=dict(world='maps/mp/zm_prison.d3dbsp',rules='owned zm_prison/zm_alcatraz/_zm_afterlife/_zm_ai_brutus scripts',runtime='shared T6 browser reconstruction'))
manifest['map']['wallbuyEffects']={n:'maps/zombie/fx_zmb_wall_buy_'+fx for n,fx in {'m14_zm':'m14','rottweil72_zm':'olympia','870mcs_zm':'870mcs','mp5k_zm':'mp5k','beretta93r_zm':'berreta93r','uzi_zm':'uzi','thompson_zm':'thompson'}.items()}
write('manifest.json',manifest);write('presentation.json',presentation)
print(json.dumps(dict(entities=len(E),weapons=len(W),volumes=len(volumes),barriers=len(goals),traversals=len(traversals),sounds=len(sounds),animations=len(animations))))
