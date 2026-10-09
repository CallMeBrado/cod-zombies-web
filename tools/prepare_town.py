"""Prepare a bounded native Town Survival world, not classic TranZit rules."""
from pathlib import Path
import copy, json, re, shutil, math, csv
from PIL import Image
from inspect_game import parse_entities

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'local-data'
SOURCE=DATA/'bo2-tranzit/web-world'; WORLD=DATA/'bo2-town/web-world'
OUT=DATA/'gameplay/bo2-town'; WORLD.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
ASSET='zm_transit_town'
SEARCH=['bo2-town-mode','bo2-town-english','bo2-tranzit-patch','bo2-tranzit-classic','bo2-tranzit','bo2-tranzit-english',
        *['bo2-tranzit-'+p for p in ['town','busstation','diner','farm','powerstation','cornfield','forest','forest2','tunnel','labs','bridge']],
        'bo2-base','bo2-common','bo2-english','bo2-menu','bo2-ui-base','bo2-ui']
def find(n):return next((DATA/z/n for z in SEARCH if (DATA/z/n).is_file()),None)
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def write(p,x):p.write_text(json.dumps(x,separators=(',',':')),encoding='utf-8')
def point(e):return list(map(float,e['origin'].split()))
LOW=[-800,-3400,-800]; HIGH=[4200,2600,2000]
def overlap(lo,hi):return all(lo[k]<=HIGH[k] and hi[k]>=LOW[k] for k in range(3))
def nearby(e):return 'origin' in e and all(LOW[k]<=v<=HIGH[k] for k,v in enumerate(point(e)))

# Keep exact native triangles, UVs, blend states and baked lighting. Every
# submodel index stays stable because map entities address brush models by *N.
w=read(SOURCE/'zm_transit.json'); vertices=(SOURCE/w['vertices']).read_bytes(); indices=(SOURCE/w['indices']).read_bytes()
surfaces=[]; vout=bytearray(); iout=bytearray(); remap={}
brushSurface=set(i for b in w['brushModels'][1:] for i in range(b['firstSurface'],b['firstSurface']+b['surfaceCount']))
for i,s in enumerate(w['surfaces']):
    if i not in brushSurface and not overlap(*s['bounds']):continue
    row=dict(s);remap[i]=len(surfaces);row.update(firstVertex=len(vout)//32,baseIndex=len(iout)//2)
    vout.extend(vertices[s['firstVertex']*32:(s['firstVertex']+s['vertexCount'])*32]);iout.extend(indices[s['baseIndex']*2:(s['baseIndex']+s['triangleCount']*3)*2]);surfaces.append(row)
for b in w['brushModels']:
    kept=[remap[i] for i in range(b['firstSurface'],b['firstSurface']+b['surfaceCount']) if i in remap]
    b.update(firstSurface=kept[0] if kept else 0,surfaceCount=len(kept))
w.update(asset=ASSET,bounds=[LOW,HIGH],surfaces=surfaces,vertexCount=len(vout)//32,indexCount=len(iout)//2,
         vertices=ASSET+'.web.vertices.bin',indices=ASSET+'.web.indices.bin',staticModels=[s for s in w['staticModels'] if overlap(s['origin'],s['origin'])])
used={s['material'] for s in surfaces};w['materials']={k:v for k,v in w['materials'].items() if k in used};w.pop('dpvs',None)
(WORLD/w['vertices']).write_bytes(vout);(WORLD/w['indices']).write_bytes(iout)
write(WORLD/(ASSET+'.json'),w)
images=DATA/'bo2-town/images';images.mkdir(parents=True,exist_ok=True)
for p in (DATA/'bo2-tranzit/images').glob('*lightmap*.dds'):shutil.copy2(p,images/p.name)
shutil.copy2(SOURCE/'zm_transit.lights.json',WORLD/(ASSET+'.lights.json'))

c=read(SOURCE/'zm_transit.collision.json')
c['worldBrushes']=[i for i in c['worldBrushes'] if overlap(c['brushes'][i]['mins'],c['brushes'][i]['maxs'])]
c['staticModels']=[s for s in c['staticModels'] if overlap(s['mins'],s['maxs'])]
used={s['model'] for s in c['staticModels']};c['collisionMeshes']={k:v for k,v in c['collisionMeshes'].items() if k in used}
t=c['terrain'];verts=t['vertices'];ids=t['indices'];selected=[];contents=[]
for i in range(len(ids)//3):
    tri=ids[i*3:i*3+3];p=[verts[n] for n in tri]
    if overlap([min(v[k] for v in p) for k in range(3)],[max(v[k] for v in p) for k in range(3)]):selected.extend(tri);contents.append(t['contents'][i])
used=sorted(set(selected));mapping={n:i for i,n in enumerate(used)};t.update(vertices=[verts[i] for i in used],indices=[mapping[i] for i in selected],contents=contents)
# zm_transit_standard_town.gsc spawns this exact native collision model at
# (1363,471,0). It uses Collmap brushes, not render triangles or collSurfs.
native=read(find('xmodel/zm_collision_transit_town_survival.json'))['nativeCollision'];boundary=[]
for g in native['geoms']:
    assert g['type']==2 and g['offset']==[0,0,0], 'Unknown native Town collision transform'
    b=copy.deepcopy(g['brush']);o=[1363,471,0]
    b['mins']=[v+o[k] for k,v in enumerate(b['mins'])];b['maxs']=[v+o[k] for k,v in enumerate(b['maxs'])]
    b['planes']=[[*p[:3],p[3]+sum(p[k]*o[k] for k in range(3))] for p in b['planes']]
    boundary.append(copy.deepcopy(b));c['worldBrushes'].append(len(c['brushes']));c['brushes'].append(b)
assert len(boundary)==4
write(WORLD/(ASSET+'.collision.json'),c)

paths=read(SOURCE/'zm_transit.paths.json');old=paths['nodes'];used=[i for i,n in enumerate(old) if overlap(n['origin'],n['origin'])];nodeMap={n:i for i,n in enumerate(used)}
paths['nodes']=[dict(old[i],links=[dict(l,node=nodeMap[l['node']]) for l in old[i]['links'] if l['node'] in nodeMap]) for i in used]
write(WORLD/(ASSET+'.paths.json'),paths)

base=read(DATA/'gameplay/bo2-tranzit/manifest.json');presentation=read(DATA/'gameplay/bo2-tranzit/presentation.json')
# Survival owns shared weapon/knife sounds omitted by classic TranZit's
# earlier export. Resolve native aliases before packaging; never synthesize.
required={v for w in [*base['weapons'].values(),base['grenade'],*base['gestures'].values()] for k,v in w.items() if 'Sound' in k and isinstance(v,str)}
for bank in (DATA/'bo2-town-mode/soundbank').glob('*.aliases.csv'):
    aliases={}
    for row in csv.DictReader(bank.open()):
        name=row['Name']
        if name not in required and not re.match(r'wpn_knife|zmb_|mus_perks',name):continue
        relative=row['FileSource'].replace('\\','/').removeprefix('raw/');file=find(relative) or find(relative+'.wav') or find(relative+'.flac')
        if file:aliases.setdefault(name,[]).append(dict(url='/data/'+file.relative_to(DATA).as_posix(),volume=min(1,float(row['VolMax'] or 100)/100),pitch=2**(float(row['PitchMax'] or 0)/1200)))
    for name,rows in aliases.items():base['sounds'][name]=rows[:12] if name.startswith('zmb_vocals') else rows[:2]
original=parse_entities(DATA/'bo2-tranzit/maps/mp/zm_transit.d3dbsp.ents')
zones={'zone_tow','zone_town_north','zone_town_south','zone_town_east','zone_town_west','zone_town_barber','zone_ban','zone_bar'}
E=[]
for raw in original:
    if not nearby(raw):continue
    e=dict(raw);tag=e.get('targetname','');note=e.get('script_noteworthy','');cls=e.get('classname','');mode=e.get('script_gameobjectname','')
    if mode and mode not in ['zstandard','zsurvival']:continue
    if e.get('script_parameters')=='classic_only' or cls.startswith(('actor_','info_vehicle','script_vehicle')):continue
    if tag=='initial_spawn_points':continue
    if tag=='town_standard_player_spawns':e.update(classname='info_player_start',targetname='initial_spawn_points')
    if tag=='zm_perk_machine' and 'zstandard_perks_town' not in e.get('script_string',''):continue
    if tag in ['weapon_upgrade','tazer_upgrade','bowie_upgrade'] and note and 'zstandard_town' not in note:continue
    if tag=='treasure_chest_use' and note not in ['town_chest','town_chest_2']:continue
    if 'MagicBox' in cls:
        if note not in ['town_chest_zbarrier','town_chest_2_zbarrier']:continue
        e.update(classname='script_model',model='p6_anim_zm_magic_box',targetname=note.replace('_zbarrier',''))
    if tag=='treasure_chest_use':e['target']=note
    if note=='player_volume' and tag not in zones:continue
    if tag.endswith('_spawners'):
        if tag.removesuffix('_spawners') not in zones:continue
        native=next((n for n in ['riser_location','spawn_location'] if n in note.split()),None)
        if native:e.update(nativeNoteworthy=native,script_noteworthy='zombie_spawner')
    if tag=='zm_perk_machine':
        if note=='specialty_scavenger':continue # native solo_tombstone_removal
        key='town_machine_'+note;E.append(dict(e,classname='script_model',targetname=key))
        e.update(classname='script_struct',targetname='zombie_vending_upgrade' if note=='specialty_weapupgrade' else 'zombie_vending',target=key);e.pop('model',None)
    if cls.startswith('zbarrier') and 'MagicBox' not in cls:
        for i in range(1,7):
            if e.get('zbarrierboardmodel'+str(i)):E.append(dict(classname='script_model',targetname=tag,model=e['zbarrierboardmodel'+str(i)],origin=e['origin'],angles=e.get('angles','0 0 0'),closedAnim=e['zbarrierboardanim'+str(i)],nativeBoard=str(i)))
    if tag=='weapon_upgrade':
        n=e['zombie_weapon_upgrade'];cost=base['wallCosts'].get(n,250 if n=='sticky_grenade_zm' else 1000);e.update(zombie_cost=str(cost),script_ammo_clip=str(cost//2))
    if tag=='tazer_upgrade':e.update(targetname='weapon_upgrade',zombie_weapon_upgrade='tazer_knuckles_zm',zombie_cost='6000')
    # Classic bank transactions, buildables, fog enemies and electrical vault
    # progression do not participate in Town Survival.
    if tag.startswith(('buildable_','powerswitch','bank_','weapons_locker','turbine_','pap_buildable')):continue
    if note in ['local_electric_door','electric_door'] and e.get('model')=='*197':continue
    E.append(e)
# Keep an authored solo start on clear pavement; most other native starts
# lie in lava after falling to the floor and are intended for moving players.
safe=next(e for e in E if e.get('targetname')=='initial_spawn_points' and e['origin']=='1675 -417 -31.89')
E.remove(safe);E.insert(0,safe)
def hulls(e):
    o=point(e)
    return [dict(mins=[v+o[k] for k,v in enumerate(c['brushes'][i]['mins'])],maxs=[v+o[k] for k,v in enumerate(c['brushes'][i]['maxs'])],planes=[[*p[:3],p[3]+sum(p[k]*o[k] for k in range(3))] for p in c['brushes'][i]['planes']]) for i in c['models'][int(e['model'][1:])]['brushes']]
volumes=[dict(name=e['targetname'],spawners=e.get('target'),hulls=hulls(e)) for e in E if e.get('script_noteworthy')=='player_volume']
# Native negotiation animation endpoints are also used by shared barriers.
for i,n in enumerate(paths['nodes']):
    if n['type']!=17:continue
    end=next((paths['nodes'][l['node']] for l in n['links'] if l['negotiation']),None)
    if end:
        key='town_traverse_'+str(i);E.extend([dict(classname='script_struct',targetname='traverse',target=key,origin=' '.join(map(str,[*n['origin'][:2],n['origin'][2]-16])),angles='0 '+str(n['angle'])+' 0'),dict(classname='script_struct',targetname=key,origin=' '.join(map(str,[*end['origin'][:2],end['origin'][2]-16])))])
goals={k:v for k,v in base['map']['goals'].items() if v['zone'] in zones}
arms=['c_zom_suit_viewhands','c_zom_hazmat_viewhands','c_zom_suit_viewhands','c_zom_hazmat_viewhands']
for w in [*base['weapons'].values(),base['grenade'],*base['gestures'].values()]:w['handsModel']=arms[0]
base.update(format='bo2-town-survival-v1',entities=E,characterNames=['CIA Agent','CDC Soldier','CIA Agent','CDC Soldier'],characterArms=arms,
            playerBodies=[dict(body='c_zom_player_'+n+'_fb') for n in ['cia','cdc','cia','cdc']],equipment={},voice={})
base['map']=dict(id='town',kinematicPaths=True,initialZone='zone_tow',initialZones=['zone_tow'],connections=[x for x in base['map']['connections'] if x[0] in zones and x[1] in zones],volumes=volumes,goals=goals,
    skyTexture='/data/bo2-tranzit/images/zm_transit_haze_ft.dds',
    negotiationBegin=17,negotiationEnd=18,traversals={nodeMap[int(k)]:v for k,v in base['map']['traversals'].items() if int(k) in nodeMap},
    initialBox='town_chest',boxWeapons=base['map']['boxWeapons'],boxMoves=True,boxExclusive=base['map']['boxExclusive'],powerTargets=[],initialDisabled=[],openRisers=True,fallDeathZ=-700,
    wallbuyEffects=base['map']['wallbuyEffects'],propModels=['p6_anim_zm_magic_box_fake','zombie_teddybear'],propAnimations=['o_zombie_magic_box_'+n for n in ['open','close','arrive','leave']],boxClips=base['map']['boxClips'],
    hazards=[dict(origin=point(e),hulls=hulls(e),multiplier=float(e.get('script_float',1))) for e in E if e.get('targetname')=='lava_damage' and e.get('model','').startswith('*')],nativeBoundary=boundary)
base['provenance']=dict(world='owned zm_transit.d3dbsp Town geometry',mode='owned so_zsurvival_zm_transit.ff',rules='owned zm_transit_standard_town.gsc / zm_transit_lava.gsc',runtime='shared T6 browser reconstruction')
presentation.pop('actorVariants',None)
hud=OUT/'hud';shutil.copytree(DATA/'gameplay/bo2-tranzit/hud',hud,dirs_exist_ok=True)
with Image.open(find('images/menu_zm_transit_zsurvival_town.dds')) as im:im.convert('RGBA').save(hud/'town-load.png')
write(OUT/'manifest.json',base);write(OUT/'presentation.json',presentation)
print(json.dumps(dict(surfaces=len(surfaces),staticModels=len(read(WORLD/(ASSET+'.json'))['staticModels']),nodes=len(paths['nodes']),entities=len(E),volumes=len(volumes),spawners=sum(e.get('script_noteworthy')=='zombie_spawner' for e in E),lava=len(base['map']['hazards']),nativeBoundary=len(boundary))))
