"""Prepare Shi No Numa's owned world, weapons and script-derived rules on E:."""
from pathlib import Path
from zipfile import ZipFile
import json, re, subprocess
from inspect_game import parse_entities
from prepare_fidelity import animation, load_effect
import prepare_der_riese as shared

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'local-data'
ZONE=DATA/'shi-no-numa'; OUT=DATA/'gameplay/shi-no-numa'
SEARCH=['shi-no-numa-patch','shi-no-numa','common','nacht']
AREAS={'northwest':'nw','northeast':'ne','southeast':'se','southwest':'sw'}
LABELS={'zombie_colt':'Colt M1911','sw_357':'.357 Magnum','ptrs41_zombie':'PTRS-41',
        'zombie_type99_rifle':'Arisaka','zombie_type100_smg':'Type 100','zombie_30cal':'Browning M1919',
        'zombie_fg42':'FG42','zombie_mg42':'MG42','zombie_ppsh':'PPSh-41','tesla_gun':'Wunderwaffe DG-2','ray_gun':'Ray Gun',
        'zombie_doublebarrel':'Double-Barreled Shotgun','zombie_doublebarrel_sawed':'Sawed-Off Shotgun','zombie_shotgun':'M1897 Trench Gun'}

def find(name): return next((DATA/z/name for z in SEARCH if (DATA/z/name).is_file()),None)
def point(e): return list(map(float,e['origin'].split()))
def write(name,value): (OUT/name).write_text(json.dumps(value,separators=(',',':')))
def weapon(name,fields):
    values=find('weapons/'+name).read_text().split('\\'); native=dict(zip(values[1::2],values[2::2]))
    return {k:float(native[k]) if re.fullmatch(r'-?\d+(?:\.\d*)?',native.get(k,'')) else native.get(k,'') for k in fields}

def patch_world_materials():
    # The original god-ray sheets are screen blended and unlit. Drawing
    # their black background as an opaque surface covers the starting room.
    file=ZONE/'web-world/nazi_zombie_sumpf.json'; world=json.loads(file.read_text())
    for name,info in world['materials'].items():
        source=find('materials/'+name.lstrip(',')+'.json')
        native=json.loads(source.read_text()) if source else {}
        technique=native.get('techniqueSet','')
        if not (technique=='wc_water' or technique.startswith('wc_unlit_falloff_add')):continue
        constants={c.get('name',c.get('nameFragment')):c['literal'] for c in native.get('constants',[])}
        if technique=='wc_water':
            # The native water shader ignores its blue diagnostic colorMap.
            # Retain the wave normals and authored murky color in our lighting.
            info.update(diffuse=None,tint=constants.get('waterColor',[.24,.27,.17])[:3])
            continue
        info.update(emissive=True,blend='screen',tint=constants.get('colorTint',[1,1,1])[:3],
                    falloff=[constants.get('falloffBeginColor',[1])[0],constants.get('falloffEndColor',[0])[0]])
    file.write_text(json.dumps(world,separators=(',',':')))

def prepare():
    OUT.mkdir(parents=True,exist_ok=True)
    patch_world_materials()
    base=json.loads((DATA/'gameplay/manifest.json').read_text()); E=parse_entities(ZONE/'maps/nazi_zombie_sumpf.d3dbsp.ents')
    C=json.loads((ZONE/'web-world/nazi_zombie_sumpf.collision.json').read_text())
    source=find('maps/nazi_zombie_sumpf.gsc').read_text()
    included=re.findall(r'(?m)^\s*include_weapon\(\s*"([^"]+)"',re.sub(r'//[^\n]*','',source))
    unsupported={'molotov','stielhandgranate','m1garand_gl_zombie','m7_launcher_zombie','m2_flamethrower_zombie','panzerschrek_zombie','mine_bouncing_betty'}
    fields=list(base['weapons']['zombie_colt'])+['projectileModel','projectileSpeed','projectileLifetime','projExplosionEffect',
        'explosionRadius','explosionInnerDamage','explosionOuterDamage','projTrailEffect']
    W={n:weapon(n,fields) for n in included if n not in unsupported and find('weapons/'+n)}
    for w in W.values():
        for key,fallback in [('lastShotAnim','fireAnim'),('adsFireAnim','fireAnim'),('adsLastShotAnim','lastShotAnim'),('emptyIdleAnim','idleAnim')]:
            if not w.get(key): w[key]=w.get(fallback,'')
    registry=find('maps/_zombiemode_weapons.gsc').read_text()
    costs={n:int(v) for n,v in re.findall(r'add_zombie_weapon\(\s*"([^"\n]+)"\s*,[^,\n]+,\s*(\d+)',registry)}
    for e in E:
        if e.get('targetname')=='zombie_double_door': e.update(targetname='zombie_door',shiDoubleDoor=True)
        if e.get('targetname')=='weapon_upgrade':
            price=costs.get(e.get('zombie_weapon_upgrade'),250);e.update(zombie_cost=str(price),script_ammo_clip=str(price//2))
    variables=dict(base['variables'])
    script=re.sub(r'/\*[\s\S]*?\*/|/#[\s\S]*?#/|//[^\n]*','',find('maps/_zombiemode.gsc').read_text())
    for k,value,divisor in re.findall(r'set_zombie_var\(\s*"([^"\n]+)"\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)',script):
        variables[k]=float(value)/(float(divisor) if divisor else 1)
    def hulls(e):
        at=point(e); out=[]
        for index in C['models'][int(e['model'][1:])]['brushes']:
            b=C['brushes'][index];out.append(dict(mins=[v+at[k] for k,v in enumerate(b['mins'])],maxs=[v+at[k] for k,v in enumerate(b['maxs'])],
                planes=[[*q[:3],q[3]+sum(q[k]*at[k] for k in range(3))] for q in b['planes']]))
        return out
    zones=[]
    for e in E:
        name=e.get('targetname','')
        if e['classname']!='info_volume' or not (name.startswith('center_building') or name in {a+s for a in AREAS for s in ['_building','_outside']}):continue
        flag=None
        if name=='center_building_combined' or name=='center_building_upstairs_buy':flag='unlock_hospital_downstairs'
        for area,prefix in AREAS.items():
            if name==area+'_outside':flag=prefix+'_magic_box'
            if name==area+'_building':flag=area+'_building_unlocked'
        zones.append(dict(name=name,spawners=e.get('target'),hulls=hulls(e),flag=flag))
    goals={}
    for goal in [e for e in E if e.get('targetname')=='exterior_goal']:
        begin=min((e for e in E if e.get('targetname')=='traverse'),key=lambda e:sum((a-b)**2 for a,b in zip(point(e),point(goal))))
        end=next((e for e in E if e.get('targetname')==begin.get('target')),begin); p=point(end);p[2]+=9
        zone=min(zones,key=lambda z:min(sum(max(h['mins'][k]-p[k],0,p[k]-h['maxs'][k])**2 for k in range(3)) for h in z['hulls']))
        goals[goal['target']]=dict(zone=zone['name'],spawners=zone['spawners'])
    trap_data=[]
    for e in E:
        if e.get('targetname')!='elec_trap_trig':continue
        damage=next(x for x in E if x.get('targetname')==e['target'] and x['classname']=='trigger_multiple')
        area=min(AREAS,key=lambda a:sum((a-b)**2 for a,b in zip(point(e),point(next(x for x in E if x.get('targetname')==a+'_building')))))
        trap_data.append(dict(target=e['target'],flag=area+'_building_unlocked',hulls=hulls(damage),points=[point(x) for x in E if x.get('targetname')==e['target'] and x['classname']=='script_struct']))
    pen=next(e for e in E if e.get('targetname')=='pen_dmg_trigger')
    cage=next(e for e in E if e.get('targetname')=='zipline')
    by_name={e.get('targetname'):e for e in E if e.get('targetname')}
    route=[]; node=by_name['zipline_spline'];seen=set()
    while node and node.get('targetname') not in seen:
        seen.add(node.get('targetname')); route.append(point(node));node=by_name.get(node.get('target'))
    slots=[]
    for index,area in enumerate(AREAS):
        e=next(e for e in E if e.get('script_noteworthy')=='random_vending_start_location_'+str(index))
        slots.append(dict(index=index,area=area,flag=area+'_building_unlocked',position=point(e),angles=list(map(float,e.get('angles','0 0 0').split()))))
    animations=json.loads((DATA/'gameplay/presentation.json').read_text())['animations']
    for z in reversed(SEARCH):
        for p in (DATA/z/'web-anims').glob('ai_zombie_*.json'):
            if re.match(r'ai_zombie_(?:walk|run|sprint|attack|idle|death|door_tear|traverse_ground)',p.stem): animations[p.stem]=animation(z,p.stem)
    dog_clips={'ai_zombie_walk_v1':'zombie_dog_run','ai_zombie_idle_v1':'zombie_dog_idle',
               'ai_zombie_attack_v1':'zombie_dog_run_attack','ai_zombie_death_v1':'zombie_dog_death_front'}
    dog_motion={k:animation('shi-no-numa',v) for k,v in dog_clips.items()}
    presentation=json.loads((DATA/'gameplay/presentation.json').read_text())
    presentation.update(animations=animations,actors=dict(body='char_jap_impinf_body5z_1',head='char_jap_impinf2_zombiehead1_1',
        attachments=[dict(model='char_jap_impinf2_cap1',tag='j_spine4')]),
        actorVariants={'hellhound':dict(body='zombie_wolf',count=16,animations=dog_clips),
                       'hellhound-black':dict(body='zombie_wolf_variant_a',count=16,animations=dog_clips)})
    presentation['gore']=dict(presentation.get('gore',{}),neckModel='char_jap_impinf_body5z_g_behead',neckMount='j_spine4')
    presentation['box']=dict(presentation.get('box',{}),teddyOpen=True,teddyModel='zombie_teddybear')
    # Only effects used by the runtime: loading/spawning, traps and wonder weapons.
    for z in reversed(SEARCH):
        for p in (DATA/z/'web-fx').rglob('*.json'):
            if not re.search(r'(dog_lightning|dog_explosion|dog_fire_trail|tesla|raygun|raygun_impact|electric_trap|zombie_powerup)',str(p)):continue
            effect=load_effect(p,SEARCH)
            if effect: presentation['effects'][effect['name']]=effect
    sounds=dict(base['sounds'])
    aliases={w.get(k) for w in W.values() for k in ['fireSoundPlayer','fireSound','reloadSoundPlayer','reloadSound','emptyFireSoundPlayer','meleeSwipeSoundPlayer','raiseSoundPlayer','putawaySoundPlayer']}
    aliases.update(line.split()[-1] for w in W.values() for line in w.get('notetrackSoundMap','').splitlines() if line.split())
    aliases.update(n['name'].removeprefix('sndnt#') for clip in dog_motion.values() for n in clip['notifies'] if n['name'].startswith('sndnt#'))
    aliases.update(['dark_sting','bright_sting','pre_spawn','bolt','spawn','zombie_dog_death','zdog_close','dog_round_vox',
        'switch','motor_start_left','motor_start_right','motor_loop_left','motor_loop_right','motor_stop_left','motor_stop_right',
        'wheel_loop','belt_loop','warning','purchase','door_rotate_open','no_purchase_door','platform_bang','zip_loop',
        'elec_start','elec_loop','elec_arc','zombie_arc','zombie_head_gib','mx_splash_screen','mx_zombie_wave_1','round_over',
        'ma_vox','insta_vox','dp_vox','nuke_vox','wpn_tesla_sizzle','weap_rgun_explode','tesla_hit','rando_start','rando_perk','perk_lottery','perks_rattle'])
    aliases.update(['dog_round_start','ann_vox_dog_start','weap_rgun_exp','tesla_sizzle','rope_creak'])
    for script_name in ['nazi_zombie_sumpf_zipline','nazi_zombie_sumpf_trap_pendulum','nazi_zombie_sumpf_trap_perk_electric']:
        aliases.update(re.findall(r'(?:play_sound_at_pos|play_sound_2D|playsoundatposition|playsound|playloopsound)\s*\(\s*"([^"]+)"',find('maps/'+script_name+'.gsc').read_text(),re.I))
    aliases.update(e['script_sound'] for e in E if 'zip' in e.get('targetname','') and e.get('script_sound'))
    aliases.update(p.stem for z in SEARCH[:2] for p in (DATA/z/'web-sounds').glob('*.json')
                   if re.match(r'(?:zombie_dog|zdog|dog_|zip_|pendulum|log_|platform_|rope_|motor_|wheel_|belt_|elec_|zapper)',p.stem))
    shared.ZONE,shared.OUTPUT,shared.SEARCH=ZONE,OUT,SEARCH
    shared.GESTURES={k:v for k,v in shared.GESTURES.items() if k!='knuckle_crack'}
    shared.convert_sounds({a for a in aliases if a},sounds,output=OUT,search=SEARCH)
    for target,original in [('wpn_tesla_sizzle','tesla_sizzle'),('weap_rgun_explode','weap_rgun_exp'),('zip_loop','rope_creak')]:
        if sounds.get(original): sounds[target]=sounds[original]
    M=dict(base,variables=variables,weapons=W,entities=E,sounds=sounds,startWeapon='zombie_colt',
        weaponNames={n:LABELS.get(n,n.removeprefix('zombie_').replace('_',' ').upper()) for n in W},
        map=dict(id='shi-no-numa',title='Shi No Numa',fallDeathZ=-1600,initialZone='center_building_upstairs',initialZones=['center_building_upstairs'],
            connections=[],volumes=zones,goals=goals,initialBox='magic_box_lid_5',chests={e['script_noteworthy']:e['target'] for e in E if e.get('targetname')=='treasure_chest_use'},
            boxWeapons=[n for n in W if n not in ['zombie_colt','zombie_type99_rifle','zombie_gewehr43','zombie_m1garand']],
            propModels=['zombie_teddybear','char_jap_impinf2_cap1'],perkSlots=slots,electricTraps=trap_data,
            dogSpawners=[dict(e,position=point(e)) for e in E if e['classname']=='actor_zombie_dog'],dogAnimations=dog_motion,
            dogHealth=[350,700,1000,1250],dogFirstRound=[5,8],dogInterval=[4,6],dogDamage=40,
            flogger=dict(hulls=hulls(pen),origin=point(pen),targets=[pen['target'],by_name[pen['target']]['target']],cost=750,live=30,cooldown=45),
            zipline=dict(route=route,origin=point(cage),upperExit=[10750,1516,-501],lowerExit=[11216,2883,-648],cost=1500,cooldown=40),
            initialDisabled=['zipline_ai_blocker'],
            provenance='Owned nazi_zombie_sumpf entities/GSC, patch dog rules, character scripts and zombie_sumpf.vision'))
    shared.add_perk_assets(M);write('manifest.json',M);write('presentation.json',presentation)
    # HUD and loading artwork from the original IWDs, including weapon icons.
    art={'loadscreen_zombie_sumpf','menu_zombie_sumpf','specialty_juggernaut_zombies','specialty_fastreload_zombies','specialty_doubletap_zombies','specialty_quickrevive_zombies'}
    for w in W.values():
        p=find('materials/'+w['hudIcon']+'.json')
        if p:
            image=json.loads(p.read_text())['textures'][0]['image'].lstrip(',');art.add(image);w['hudImage']='/data/gameplay/hud/'+image+'.png'
    sources={}
    for archive in sorted((shared.GAME/'main').glob('*.iwd')):
        with ZipFile(archive) as bundle:
            lookup={n.casefold():n for n in bundle.namelist()}
            for name in art:
                member=lookup.get(('images/'+name+'.iwi').casefold())
                if member: sources[name]=(archive,member)
    hud=DATA/'gameplay/hud';hud.mkdir(parents=True,exist_ok=True)
    for name,(archive,member) in sources.items():
        raw=ZONE/'images'/(name+'.iwi')
        with ZipFile(archive) as bundle: raw.write_bytes(bundle.read(member))
        subprocess.run([str(ROOT/'.tools/oat/ImageConverter.exe'),'--no-color',str(raw)],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
    for name in art:
        source=find('images/'+name+'.dds')
        if source: subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(source),'-frames:v','1',str(hud/(name+'.png'))],check=True)
    write('manifest.json',M)
    print(json.dumps(dict(entities=len(E),weapons=len(W),windows=len(goals),zones=len(zones),dogSpawners=len(M['map']['dogSpawners']),zipNodes=len(route),sounds=len(sounds))))

if __name__=='__main__': prepare()
