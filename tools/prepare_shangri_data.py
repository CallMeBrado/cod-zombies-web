"""Shangri-La's authored T5 pressure plates, routes, perks and enemy rigs."""
from pathlib import Path
import json,re
from prepare_fidelity import animation,load_effect
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'local-data'

def adapt(m,p,c,search,find):
    E=m['entities'];point=lambda e:list(map(float,e.get('origin','0 0 0').split()))
    def one(name):return next(e for e in E if e.get('targetname')==name or e.get('nativeTargetname')==name)
    def hulls(e):
        o=point(e)
        return [dict(mins=[v+o[k] for k,v in enumerate(c['brushes'][i]['mins'])],maxs=[v+o[k] for k,v in enumerate(c['brushes'][i]['maxs'])],
            planes=[[*q[:3],q[3]+sum(q[k]*o[k] for k in range(3))] for q in c['brushes'][i]['planes']]) for i in c['models'][int(e['model'][1:])]['brushes']]
    def chain(start,limit=250):
        points=[];e=one(start);seen=set()
        for _ in range(limit):
            if id(e) in seen:break
            seen.add(id(e));points.append(dict(position=point(e),angles=list(map(float,e.get('angles','0 0 0').split())),speed=float(e.get('speed',0))))
            if not e.get('target'):break
            nexts=[x for x in E if x.get('targetname')==e.get('target') and x.get('classname') in ['info_vehicle_node','script_struct']]
            if not nexts:break
            e=nexts[0]
        return points
    switches=[dict(trigger='power_trigger_'+side,model='elec_switch_'+side,position=point(one('power_trigger_'+side)),flag=side+'_switch_pulled') for side in ['left','right']]
    for side in ['left','right']:
        e=one('power_trigger_'+side);e.update(nativeTargetname='power_trigger_'+side,targetname='use_power_switch',templeSwitch=side)
    slots=[]
    perk_keys={'jugg_perk':'specialty_armorvest','speedcola_perk':'specialty_fastreload','tap_perk':'specialty_rof','marathon_perk':'specialty_longersprint','divetonuke_perk':'specialty_flakjacket','tap_deadshot':'specialty_deadshot'}
    for i,e in enumerate([e for e in E if e.get('targetname')=='zombie_vending_random' or e.get('templePerkSlot') is not None]):
        slots.append(dict(index=i,position=point(one(e['target'])),angles=list(map(float,one(e['target']).get('angles','0 0 0').split())),target=e['target'],allowed=[perk_keys[n] for n in e.get('script_parameters',','.join(perk_keys)).split(',')]))
        e.update(targetname='zombie_vending',templePerkSlot=i,script_noteworthy='specialty_rof')
    plates=[dict(index=i,position=point(one('pap_blocker_trigger'+str(i))),target=one('pap_blocker_trigger'+str(i))['target'],hulls=hulls(one('pap_blocker_trigger'+str(i)))) for i in range(1,5)]
    stairs=[e for e in E if e.get('targetname','').startswith('pap_stairs') and e.get('classname')=='script_model']
    raised=dict(one('pap_stairs_clip'));raised.update(targetname='pap_stairs_clip_raised',origin=' '.join(str(v+(72 if k==2 else 0)) for k,v in enumerate(point(raised))))
    if not any(e.get('targetname')==raised['targetname'] for e in E):E.append(raised)
    mine=one('minecart1');mine.update(classname='script_model')
    cart=dict(target=mine['targetname'],position=point(mine),path=chain('minecart1_staging'),use=one('minecart_lever_trigger'),volume=hulls(one('minecart1_start_volume')),cost=250)
    # Native gravity triggers have no vehicle path; gallery markers provide
    # the centerline for this reconstructed browser slide.
    gallery=sorted([e for e in E if e.get('targetname')=='shooting_gallery_target' and e.get('script_noteworthy')=='waterslide' and e.get('script_int')],key=lambda e:int(e['script_int']))
    slide=dict(position=point(one('waterslide_message_trigger')),hulls=hulls(one('zombie_cave_slide')),path=[dict(position=point(one('waterslide_message_trigger'))),*[dict(position=[*point(e)[:2],point(e)[2]-60]) for e in gallery],dict(position=point(one('node_zombie_slide_end')))],blocker='water_slide_blocker')
    m['map'].update(perkSlots=slots,switches=switches,plates=plates,papStairs=stairs,minecart=cart,slide=slide,fallDeathZ=-3000,
        papBlockers=['pap_stairs_player_clip','pap_playerclip'],papFloor=['pap_stairs_clip_raised','pap_ramp'],boxMoves=True,
        specials=[dict(e,position=point(e)) for e in E if e.get('targetname')=='special_zombie_spawn'],
        # This waterfall window's distant spawns use native negotiations the
        # shared walker cannot execute. Start its riser on the authored exterior
        # path node instead, retaining the window's zone and physical approach.
        exteriorRisers=[dict(window='pf154_auto1',node=97)],
        monkeySpawns=[dict(e,position=point(e)) for e in E if e.get('targetname')=='stealer_monkey_spawn'],
        monkeyExits=[dict(e,position=point(e)) for e in E if e.get('targetname')=='stealer_monkey_exit'],
        powerTargets=[e['targetname'] for e in E if e.get('targetname')=='temple_power_door'],
        initialDisabled=['minecart1_door_clip','minecart1_front_door_clip','minecart1_front','minecart1_floor','pap_stairs_clip','pap_stairs_clip_raised','pap_ramp','brush_pap_traversal','brush_pap_side_l','brush_pap_side_r','brush_pap_pathing_ramp_l','brush_pap_pathing_ramp_r'],
        permanentDisabled=['minecart1_door_clip','minecart1_front_door_clip','minecart1_front','minecart1_floor','pap_stairs_clip','brush_pap_traversal','brush_pap_side_l','brush_pap_side_r','brush_pap_pathing_ramp_l','brush_pap_pathing_ramp_r'],
        zoneFlags=re.findall(r'add_zone_flags\(\s*"([^"]+)"\s*,\s*"([^"]+)"',find('maps/zombie_temple.gsc').read_text()),
        provenance='Owned zombie_temple GSC, entities and authored vehicle-node/pressure-plate routes')
    models=['zombie_vending_jugg','zombie_vending_sleight','zombie_vending_doubletap','zombie_vending_marathon','zombie_vending_nuke','zombie_vending_ads']
    m['map']['propModels']=[*models,*[n+'_on' for n in models if find('model_export/'+n+'_on_lod0.glb')]]
    m['weaponNames'].update(shrink_ray_zm='31-79 JGb215',shrink_ray_upgraded_zm='Fractalizer')
    p['gore']=dict(neckModel='c_viet_zombie_vc_grunt_g_headoff',neckMount='body')
    for a in (DATA/'bo1-temple/web-anims').glob('ai_zombie_*.json'):
        if re.search(r'napalm|sonic|shrunk|shrink|monkey',a.stem):p['animations'][a.stem]=animation('bo1-temple',a.stem)
    regular={n:n for n in p['animations']};p['actorVariants']={
        'napalm':dict(body='c_viet_zombie_napalm',head='c_viet_zombie_napalm_head',count=3,animations=regular),
        'sonic':dict(body='c_viet_zombie_sonic_body',head='c_viet_zombie_sonic_head',attachments=[dict(model='c_viet_zombie_sonic_bandanna',tag='j_spine4'),dict(model='c_viet_zombie_sonic_shirt')],neckModel='c_viet_zombie_sonic_g_headoff',count=3,animations=regular),
        'monkey':dict(body='c_zombie_monkey',count=8,animations={n:n for n in p['animations'] if 'monkey' in n})}
    p['box']['teddyModel']='zombie_teddybear'
    if m['sounds'].get('mus_temple_underscore'):m['sounds']['mx_zombie_wave_1']=m['sounds']['mus_temple_underscore']
    # Native flame artwork with a small reconstructed emitter: the exporter
    # does not currently recover the temple's Napalm flame FX definition.
    p['effects']['temple/napalm_fire']=dict(name='temple/napalm_fire',elements=[dict(type=0,flags=0,looping=True,blending='additive',textures=['/data/bo1-common/images/fxt_fire_flame_lick.dds'],
        life=[700,300],delay=[0,0],count=6,interval=150,origin=[[-55,110],[-55,110],[15,5]],radius=[0,0],height=[0,0],gravity=[0,0],
        atlas=dict(cols=0,rows=0,entries=1,fps=0,index=0,behavior=1),velocity=[],samples=[
            dict(color=[255,170,65,220],colorAmplitude=[0,0,0,0],size=[25,42],sizeAmplitude=[15,24],rotation=0,rotationAmplitude=0),
            dict(color=[255,65,15,0],colorAmplitude=[0,0,0,0],size=[14,70],sizeAmplitude=[4,20],rotation=0,rotationAmplitude=0)])])
    for z in search[:2]:
        for f in (DATA/z/'web-fx').rglob('*.json'):
            if re.search(r'napalm|sonic|shrink|monkey|waterwheel|waterfall|minecart',str(f)):
                effect=load_effect(f,search,effect_blending=True)
                if effect:p['effects'][effect['name']]=effect
    print('Shangri-La: '+json.dumps(dict(plates=len(plates),perks=len(slots),cartNodes=len(cart['path']),slideNodes=len(slide['path']),specialSpawns=len(m['map']['specials']))))
