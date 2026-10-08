"""Five's native Pentagon entities, elevator hulls and scripted mechanics."""
import json,re
from pathlib import Path
from prepare_fidelity import animation,load_effect
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'local-data'

def adapt(m,p,c,search,find):
    E=m['entities'];point=lambda e:list(map(float,e.get('origin','0 0 0').split()))
    one=lambda name:next(e for e in E if e.get('targetname')==name)
    def hulls(e):
        o=point(e)
        return [dict(mins=[v+o[k] for k,v in enumerate(c['brushes'][i]['mins'])],maxs=[v+o[k] for k,v in enumerate(c['brushes'][i]['maxs'])],
            planes=[[*q[:3],q[3]+sum(q[k]*o[k] for k in range(3))] for q in c['brushes'][i]['planes']],contents=c['brushes'][i]['contents']) for i in c['models'][int(e['model'][1:])]['brushes']]
    elevators=[];moving=[];disabled=[]
    for name,drop in [('elevator1',201),('elevator2',320)]:
        car=one(name);linked=car['target'];up=one(name+'_up_riders');down=one(name+'_down_riders')
        elevators.append(dict(name=name,origin=point(car),drop=drop,cost=250,travel=5,upVolume=hulls(up),downVolume=hulls(down),
            upZone='war_room_zone_elevator' if name=='elevator1' else 'hallway_level1',downZone=down['script_noteworthy'],
            zombieStops={stop:[point(e) for e in E if e.get('targetname')==name+'_'+stop+'_hidden'] for stop in ['up','down']}))
        for i,e in enumerate(E):
            tag=e.get('script_noteworthy','')
            if e is car or (e.get('targetname')==linked and e.get('classname') in ['script_model','script_brushmodel','trigger_use']) or tag.startswith(name+'_outerdoors'):
                role='body' if e is car else 'buy' if tag==name+'_buy' else 'outer' if 'outerdoors' in tag else 'door'
                original=e.get('targetname');e.update(fiveCar=name,fiveRole=role,fiveHome=point(e),fiveStop='down' if tag.endswith('_down') else 'up')
                if role=='buy':e['targetname']='five_elevator_buy';continue
                e['targetname']=name+'_piece_'+str(i)
                moving.append(dict(target=e['targetname'],car=name,role=role,home=point(e),vector=list(map(float,e.get('script_vector','0 0 0').split())),stop=e['fiveStop'],hulls=hulls(e) if e.get('model','').startswith('*') else []))
                disabled.append(e['targetname'])
            if tag in [name+'_safety_top',name+'_safety_bottom']:
                e['targetname']=name+'_safety_'+str(i);disabled.append(e['targetname'])
    portals=[]
    for i,e in enumerate([e for e in E if e.get('targetname')=='portal_trigs']):
        d=next(e2 for e2 in E if e2.get('targetname')==e['target'] and e2.get('script_noteworthy')=='player_pos')
        portals.append(dict(index=i,zone=e['script_noteworthy'],position=point(e),hulls=hulls(e),destination=point(d),yaw=float(d.get('angles','0 0 0').split()[1])))
    switches=[]
    for i,e in enumerate([e for e in E if e.get('targetname')=='punch_switch']):
        e['fiveDefcon']=i;switches.append(dict(index=i,target=e['target'],position=point(e)))
    # The stock box always starts at a laboratory location, not upstairs.
    boxes=[e for e in E if e.get('targetname')=='treasure_chest_use']
    for e in boxes:e['start_exclude']='0' if e.get('script_noteworthy','').startswith('start_chest') else '1'
    for e in E:
        if e.get('script_noteworthy')=='quad_zombie_spawner':e.update(script_noteworthy='zombie_spawner',fiveCrawler=True)
    power=['yellow_conf_screen','power_room_screen','jfk_room_screen','war_room_screen_north','war_room_screen_ramp','war_room_screen_south']
    m['characterNames']=['John F. Kennedy','Robert McNamara','Richard Nixon','Fidel Castro'];m['characterArms']=['viewmodel_usa_pow_arms']*4
    m['weaponNames'].update(freezegun_zm="Winter's Howl",freezegun_upgraded_zm="Winter's Fury")
    freeze=find('maps/_zombiemode_weap_freezegun.gsc')
    values={k:float(v) for k,v in re.findall(r'set_zombie_var\(\s*"([^"\n]+)"\s*,\s*([\d.]+)',freeze.read_text())}
    m['map'].update(elevators=elevators,moving=moving,portals=portals,defconSwitches=switches,boxMoves=True,openRisers=True,
        initialBox=next(e['target'] for e in boxes if e['start_exclude']=='0'),powerTargets=power,freeze=values,fallDeathZ=-1600,
        initialDisabled=disabled,permanentDisabled=disabled,thiefSpawn=point(one('thief_zombie_spawner')),
        papBlockers=['pack_hideaway',one('pack_room_door')['target']],papVolume=hulls(one('pack_room_trigger')),
        propModels=['zombie_teddybear',*[f'p_zom_pent_defcon_sign_0{i}' for i in range(1,6)]],
        provenance='Owned zombie_pentagon GSC, authored trigger hulls, elevator travel distances, DEFCON and freezegun scripts')
    # The shared T5 runtime has no Monkey Bomb equipment lifecycle yet. Do
    # not offer its grenade definition as a non-functional primary weapon.
    m['map']['boxWeapons']=[n for n in m['map']['boxWeapons'] if n!='zombie_cymbal_monkey']
    # Trap parts retain their authored model spawn positions.
    parts=[e for e in E if e.get('targetname')=='trigger_trap_piece']
    for i,e in enumerate(parts):
        e.update(fiveTrapPart=i);spawn=one(e['target']);E.append(dict(classname='script_model',targetname='five_trap_part_'+str(i),model='zombie_sumpf_power_switch',origin=spawn['origin'],angles=spawn.get('angles','0 0 0'),fivePartModel=i))
    for e in E:
        if e.get('targetname') in ['trap_elevator','trap_quickrevive'] and e.get('classname')=='trigger_use':e['fiveTrap']=e['targetname']
    p['box']['teddyModel']='zombie_teddybear'
    p['powerups']['bonfire_sale']='zombie_firesale';p['powerups']['fire_sale']='zombie_firesale'
    for z in search[:2]:
        for a in (DATA/z/'web-anims').glob('ai_zombie_*.json'):
            if re.search(r'tech|quad|freeze',a.stem):p['animations'][a.stem]=animation(z,a.stem)
        for a in (DATA/z/'web-fx').rglob('*.json'):
            if re.search(r'freez|pentagon',str(a)):
                fx=load_effect(a,search,effect_blending=True);p['effects'][fx['name']]=fx
    regular={n:n for n in p['animations']}
    quad={n:n for n in p['animations'] if 'quad' in n}
    quad.update(ai_zombie_walk_v1='ai_zombie_quad_crawl',ai_zombie_idle_v1='ai_zombie_quad_idle',ai_zombie_attack_v1='ai_zombie_quad_attack')
    thief=dict(regular,ai_zombie_idle_v1='ai_zombie_tech_idle_base',ai_zombie_attack_v1='ai_zombie_tech_grab')
    p['actorVariants']={'thief':dict(body='c_zom_electrician_body',count=1,animations=thief),
        'crawler':dict(body='c_zom_quad_body',head='c_zom_quad_head',count=8,animations=quad),
        'scientist':dict(body='c_usa_pent_zombie_scientist_body',head='c_ger_zombie_head1',count=24,animations=regular)}
    if m['sounds'].get('mus_pentagon_underscore'):m['sounds']['mx_zombie_wave_1']=m['sounds']['mus_pentagon_underscore']
    print('Five: prepared two elevators, eight portals, four DEFCON switches and native special actors.')
