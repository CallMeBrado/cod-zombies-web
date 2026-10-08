"""Moon's native entity chains, pressure volumes, equipment and enemy rigs."""
import json,re,subprocess
from pathlib import Path
from prepare_fidelity import animation,load_effect

ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'local-data'
def adapt(m,p,c,search,find):
    E=m['entities'];point=lambda e:list(map(float,e['origin'].split()))
    def ent(name):return next(e for e in E if e.get('targetname')==name)
    def hulls(e):
        o=point(e)
        return [dict(mins=[v+o[k] for k,v in enumerate(c['brushes'][i]['mins'])],maxs=[v+o[k] for k,v in enumerate(c['brushes'][i]['maxs'])],
            planes=[[*q[:3],q[3]+sum(q[k]*o[k] for k in range(3))] for q in c['brushes'][i]['planes']]) for i in c['models'][int(e['model'][1:])]['brushes']]
    for v in m['map']['volumes']:
        source=next(e for e in E if e.get('targetname')==v['name'] and e.get('script_noteworthy')=='player_volume')
        v['lowGravity']=source.get('script_string')=='lowgravity'
    teleports=[dict(e,position=point(e),hulls=hulls(e)) for e in E if e.get('targetname') in ['nml_teleporter','generator_teleporter']]
    airlocks=[]
    for e in E:
        if e.get('script_noteworthy')!='zombie_door_airlock' or not e.get('target'):continue
        purchases=[x for x in E if x.get('target')==e.get('targetname') and x.get('targetname') in ['zombie_airlock_buy','zombie_airlock_hackable']]
        airlocks.append(dict(position=point(e),hulls=hulls(e),targets=[e['target']],zone=e.get('script_parameters'),
            flag=purchases[0].get('script_flag') if purchases else None))
    pads=[]
    for e in E:
        if e.get('targetname')!='trig_jump_pad':continue
        start=ent(e['target']);ends=[x for x in E if x.get('targetname')==start.get('target') and x.get('classname')=='script_struct']
        if ends:pads.append(dict(position=point(e),hulls=hulls(e),label=e.get('script_label'),destinations=[point(x) for x in ends],vertical=e.get('script_string')=='moon_vertical_jump'))
    equipment=[e for e in E if e.get('targetname')=='zombie_equipment_upgrade']
    for e in equipment:e['position']=point(e)
    diggers=[]
    for name,zones in [('teleporter',['cata_left_start_zone','cata_left_middle_zone']),('hangar',['cata_right_start_zone','cata_right_middle_zone','cata_right_end_zone']),('biodome',['forest_zone'])]:
        trigger=ent(name+'_digger_switch');blocker=next((e for e in E if e.get('targetname')=='digger_'+name+'_blocker'),None)
        tracks=next((e for e in E if e.get('targetname')==name+'_digger_tracks'),None)
        # Stock excavators may use a numbered shared model chain instead.
        body=next(e for e in E if e.get('targetname')=='digger_body' and name in e.get('script_string',''))
        linked=[e for e in E if e.get('targetname')==body['target']];tracks=next(e for e in linked if e.get('model')=='p_zom_digger_body');arm=next(e for e in linked if e is not tracks)
        center=ent(arm['target']);blade=ent(center['target']);path=[];step=ent(tracks['target'])
        for _ in range(100):
            path.append(point(step))
            if not step.get('target'):break
            step=ent(step['target'])
        diggers.append(dict(name=name,trigger=trigger['targetname'],position=point(trigger),zones=zones,blocker=blocker and blocker['targetname'],
            models=[dict(e,position=point(e)) for e in [tracks,body,arm,center,blade]],path=path,arm=arm['targetname'],blade=blade['targetname'],downAngle={'teleporter':-52,'hangar':-45,'biodome':-20}[name],duration=240))
    initial_disabled=['teleporter_gate','teleporter_gate_top','bunker_gate','bunker_gate_2','digger_hangar_blocker','digger_teleporter_blocker']
    m['map'].update(initialZone='nml_zone',initialZones=['nml_zone','bridge_zone'],fallDeathZ=-2800,teleports=teleports,
        moonSpawn=point(ent('nml_to_bridge_teleporter_player1_position')),moonYaw=90,
        earthSpawn=point(next(e for e in E if e.get('script_noteworthy')=='packp_respawn_point')),equipment=equipment,airlocks=airlocks,jumpPads=pads,diggers=diggers,
        astronaut=ent('astronaut_zombie'),quadSpawners=[e for e in E if e.get('script_noteworthy')=='quad_zombie_spawner'],initialDisabled=initial_disabled,boxMoves=True,propModels=['viewmodel_zom_pressure_suit_arms','c_zom_moon_pressure_suit_helm'],
        provenance='Owned zombie_moon GSC/entity/pressure/teleporter/wasteland/excavator scripts')
    m['weaponNames'].update(microwavegundw_zm='Zap Gun Dual Wield',microwavegun_zm='Wave Gun',microwavegundw_upgraded_zm='Porter’s X2 Zap Gun Dual Wield',microwavegun_upgraded_zm='Max Wave Gun')
    for name,w in m['weapons'].items():
        if name.startswith('microwavegun'):
            if name.startswith('microwavegundw'):w['secondaryModel']='t5_weapn_raygun_moon_front_vm';w['secondaryTag']='tag_weapon1'
            other=name.replace('microwavegundw','microwavegun') if name.startswith('microwavegundw') else name.replace('microwavegun','microwavegundw')
            if other in m['weapons']:w['alternate']=other
            upgraded=name.replace('_zm','_upgraded_zm')
            if upgraded in m['weapons']:w['upgrade']=upgraded
    p['gore']=dict(neckModel='c_zom_moon_militarypolice_g_behead',neckMount='body')
    for path in (DATA/'bo1-moon/web-anims').glob('ai_zombie_*.json'):
        if re.search(r'moon|astro|quad|microwave|fast_sprint',path.stem):p['animations'][path.stem]=animation('bo1-moon',path.stem)
    body=p['actors']['body'];head=p['actors']['head']
    p['actorVariants']={
        'lunar':dict(body='c_zom_moon_tech_body_noshirtguts_1',head=head,neckModel='c_zom_moon_tech_body_n_g_behead',count=28,animations={n:n for n in p['animations']}),
        'quad':dict(body='c_zom_quad_body_bloat',head='c_zom_quad_head_bloat',count=8,animations={**{n:n for n in p['animations'] if 'quad' in n},**{n:'ai_zombie_quad_attack_double' for n in p['animations'] if 'attack' in n and 'quad' not in n},'ai_zombie_walk_v1':'ai_zombie_quad_supersprint','ai_zombie_idle_v1':'ai_zombie_quad_idle','ai_zombie_death_v1':'ai_zombie_quad_death'}),
        'astronaut':dict(body='c_zom_moon_pressure_suit_body_zombie',attachments=[dict(model='c_zom_moon_pressure_suit_helm',tag='j_spine4')],count=2,animations={'ai_zombie_walk_v1':'ai_zombie_astro_walk_moon_v1','ai_zombie_attack_v1':'ai_zombie_astro_headbutt','ai_zombie_idle_v1':'ai_zombie_idle_v1','ai_zombie_death_v1':'ai_zombie_death_v1'})}
    p['box']['teddyModel']='zombie_teddybear'
    for z in search[:2]:
        for path in (DATA/z/'web-fx').rglob('*.json'):
            if re.search(r'microwave|astro|quad|moon.*(teleport|airlock|digger)|boss_spawn|gasmask',str(path)):
                effect=load_effect(path,search,effect_blending=True)
                if effect:p['effects'][effect['name']]=effect
    for key in ['pes_on','pes_off']:
        d=m['gestures'][key];d['firstRaiseAnim']=d.get('raiseAnim') or d.get('idleAnim');d['firstRaiseTime']=d.get('raiseTime') or .8
    # The native P.E.S. overlay, not a drawn replacement helmet.
    names=['specialty_additionalprimaryweapon_zombies','zom_generic_overlay_hazmat_1']
    for material in names:
        file=find('materials/'+material+'.json');image=material
        if file:image=next((t['image'].lstrip(',') for t in json.loads(file.read_text()).get('textures',[]) if t.get('semantic')=='colorMap'),material)
        source=find('images/'+image+'.dds')
        if source:
            target=DATA/'gameplay/bo1-moon/hud'/(material+'.png');subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(source),'-frames:v','1',str(target)],check=True)
    print('Moon systems: '+json.dumps(dict(airlocks=len(airlocks),jumpPads=len(pads),equipment=len(equipment),diggers=len(diggers))))
