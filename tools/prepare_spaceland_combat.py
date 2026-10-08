"""Prepare original IW7 combat rigs, clips, weapon stats and park lighting.

Requires an already initialized offline Cordycep loader; never dumps/kills the game.
All generated assets remain ignored on E:. Skeleton/animation layouts checked
against Greyhound and auroramod's IW7 database.hpp.
"""
import argparse
import json
import re
from iw7_memory import Memory, state, assets
from extract_spaceland import Exporter, OUTPUT, PRIVATE, key
from iw7_rig import export_rig, combine_rigs
from iw7_animation import decode_animation


def prepare(pid):
    memory=Memory(pid);context=state();exporter=Exporter(memory,context,512)
    def table(kind):
        return {memory.string(memory.pointer(a['header'])):a['header'] for a in assets(memory,context['pools'],kind) if not a['temporary']}
    models=table(8);anims=table(6);weapons=table(39);rigs={};clips={}
    def rig(name):
        if name not in rigs:rigs[name]=export_rig(exporter,context,models[name])
        return rigs[name]
    zombies=[]
    for outfit in [1,2,3]:
        parts=[rig('zombie_male_outfit_'+str(outfit))]
        parts.extend(rig(f'zmb_male_normal_{part}_outfit_{outfit:02}') for part in ['torso','arm_l','arm_r','leg_l','leg_r'])
        parts.append(rig('zmb_male_head_01'))
        parts.append(rig('zmb_male_head_01_hair_mullet' if outfit==1 else 'zmb_male_head_01_hair_mohawk'))
        name='spaceland_zombie_outfit_'+str(outfit);rigs[name]=combine_rigs(name,parts);zombies.append(name)
        print(name,rigs[name]['vertices'],'vertices',len(rigs[name]['bones']),'bones',flush=True)
    characters=[]
    for name,label,arms in [('nerd','Poindexter','zmb_hero_nerd_viewmode_arms'),('valley_girl','Sally','viewmodel_zmb_hero_valley_girl'),('rapper','Andre','viewmodel_zmb_hero_rapper'),('jock','AJ','fullbody_zmb_hero_jock_viewmodel_arms')]:
        knife_weapon=weapons['iw7_knife_zm_'+('vgirl' if name=='valley_girl' else name)];knife_model=memory.string(memory.pointer(memory.pointer(memory.pointer(knife_weapon+8)+8)))
        rig(arms);rig(knife_model);characters.append({'id':name,'name':label,'arms':arms,'knife':knife_model,'melee':'vm_'+name+'_melee_slice','intro':'vm_gesture_zmb_load_in_'+name,'card':'vm_gesture_wondercard_'+name})
    for name in ['weapon_g18_rare_vm_camo','weapon_m1_vm_camo','weapon_m1_wm_camo','tactical_knife_iw7_vm','zmb_card_01']:
        rig(name)
    # Export the complete original zombie movement/attack/death catalogue, along
    # with the starter weapon and the four playable characters' card gestures.
    selected=[name for name in anims if name.startswith(('iw7_cp_zom_','vm_g18_','vm_m1_','vm_gesture_zmb_load_in_','vm_gesture_wondercard_','vm_knife')) or name.startswith('vm_') and ('_melee_slice' in name or '_melee_fatal' in name)]
    for name in selected:
        clip=decode_animation(memory,context,anims[name]);url='animations/'+key(name)+'.json'
        (OUTPUT/'animations').mkdir(exist_ok=True);path=OUTPUT/url
        path.write_text(json.dumps(clip,separators=(',',':')),encoding='utf8')
        clips[name]={'name':name,'url':url,'bytes':path.stat().st_size,'duration':clip['duration'],'loop':clip['loop'],'bones':len(clip['bones'])}
    starter=weapons['iw7_g18_zmr'];w=memory.pointer(starter+8);package=memory.pointer(w+448);timers=memory.unpack('<50H',memory.pointer(package+16))
    weapon={'name':'Kendall 44','native':'iw7_g18_zmr','model':'weapon_g18_rare_vm_camo','clip':memory.unpack('<i',starter+188)[0],
            'startAmmo':memory.unpack('<i',w+1164)[0],'maxAmmo':memory.unpack('<i',w+1188)[0],'damage':memory.unpack('<i',w+1232)[0],
            'minDamage':memory.unpack('<i',w+2280)[0],'maxDamageRange':memory.unpack('<f',w+2312)[0],'minDamageRange':memory.unpack('<f',w+2328)[0],
            'fireSeconds':memory.unpack('<i',w+476)[0]/1000,'reloadSeconds':timers[19]/1000,'reloadEmptySeconds':timers[22]/1000,
            'reloadAddSeconds':timers[24]/1000,'reloadEmptyAddSeconds':timers[26]/1000,'headMultiplier':memory.unpack('<22f',memory.pointer(w+2368))[2]}
    world=next(a['header'] for a in assets(memory,context['pools'],23) if not a['temporary'])
    lights=[];count=memory.unpack('<I',world+20)[0];pointer=memory.pointer(world+24)
    for i in range(count):
        p=pointer+i*144;rgb=memory.unpack('<3f',p+24);origin=memory.unpack('<3f',p+60);radius=memory.unpack('<f',p+72)[0]
        if radius>0 and max(rgb)>0:lights.append({'origin':origin,'color':rgb,'radius':radius,'type':memory.read(p,1)[0]})
    starter=weapons['iw7_m1c_zm'];w=memory.pointer(starter+8);package=memory.pointer(w+448);timers=memory.unpack('<50H',memory.pointer(package+16))
    rifle={'name':'M1','native':'iw7_m1c_zm','model':'weapon_m1_vm_camo','clip':memory.unpack('<i',starter+188)[0],
           'startAmmo':memory.unpack('<i',w+1164)[0],'maxAmmo':memory.unpack('<i',w+1188)[0],'damage':memory.unpack('<i',w+1232)[0],
           'minDamage':memory.unpack('<i',w+2280)[0],'maxDamageRange':memory.unpack('<f',w+2312)[0],'minDamageRange':memory.unpack('<f',w+2328)[0],
           'fireSeconds':memory.unpack('<i',w+476)[0]/1000,'reloadSeconds':timers[19]/1000,'reloadEmptySeconds':timers[22]/1000,
           'reloadAddSeconds':timers[24]/1000,'reloadEmptyAddSeconds':timers[26]/1000,'headMultiplier':memory.unpack('<22f',memory.pointer(w+2368))[2]}
    entities=json.loads((PRIVATE/'native/entities.json').read_text(encoding='utf8'))
    spawnpoints=[{'origin':list(map(float,e['origin'].split())),'angles':list(map(float,e.get('angles','0 0 0').split())),'group':e['targetname'],'animation':e.get('animation','').lower(),'parameters':e.get('script_parameters','')} for e in entities if e.get('script_noteworthy')=='static' and ('spawn' in e.get('targetname',''))]
    wallWeapon={'model':'weapon_m1_wm_camo','origin':[952,3161.3,42.5],'angles':[0,122.599,85.5]}
    result={'version':1,'source':'Original IW7 cp_zmb assets','zombies':zombies,'characters':characters,'weapon':weapon,'rifle':rifle,'wallWeapon':wallWeapon,'spawnpoints':spawnpoints,
            'rigs':rigs,'animations':clips,'materials':{key(d['name']):d for d in exporter.materials.values()},'lights':lights}
    (OUTPUT/'combat.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf8')
    (PRIVATE/'combat-extraction-report.json').write_text(json.dumps({'rigs':len(rigs),'animations':len(clips),'lights':len(lights),'weapon':weapon,'failures':exporter.failures},indent=2),encoding='utf8')
    memory.close();print('Prepared',len(rigs),'rigs,',len(clips),'native clips,',len(lights),'lights',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--pid',required=True,type=int);prepare(parser.parse_args().pid)
