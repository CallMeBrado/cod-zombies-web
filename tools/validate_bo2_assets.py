from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'local-data'
m=json.loads((DATA/'gameplay/bo2-buried/manifest.json').read_text());p=json.loads((DATA/'gameplay/bo2-buried/presentation.json').read_text());w=json.loads((DATA/'bo2-buried/web-world/zm_buried.json').read_text())
zones=['bo2-patch','bo2-classic','bo2-buried','bo2-base','bo2-common','bo2-english','bo2-dlc','bo2-menu','bo2-ui-base','bo2-ui']
def find(f):return next((DATA/z/f for z in zones if (DATA/z/f).is_file()),None)
models=set(m['characterArms'])|set(p['actors'].values())|set(p['powerups'].values())|{m['map']['arthurModel']}
models.update(x['model'] for x in w['staticModels']);models.update(e.get('model') for e in m['entities'] if e['classname']=='script_model')
for gun in [*m['weapons'].values(),*m['gestures'].values(),m['grenade']]:models.update(gun.get(k) for k in ['gunModel','worldModel','knifeModel','projectileModel'])
for b in m['playerBodies']:models.add(b['body'])
models.update(x['model'] for x in m['equipment'].values())
models.update(x for x in p.get('gore',{}).get('models',{}).values() if isinstance(x,str))
missing=[n for n in models if n and not find('model_export/'+n.lstrip(',')+'_lod0.glb')]
animations=set(p['animations'])|set(m['map']['arthurAnimations'])|{e['closedAnim'] for e in m['entities'] if e.get('closedAnim')}
for gun in [*m['weapons'].values(),*m['gestures'].values(),m['grenade']]:animations.update(v for k,v in gun.items() if k.endswith('Anim') and 'Camera' not in k and v)
animations.update(m.get('playerAnimations',[]))
for item in m['equipment'].values():animations.update(item[k] for k in ['animation','launchAnimation'] if item.get(k))
missing_anims=[n for n in animations if not find('web-anims/'+n+'.json')]
textures={mat.get(k) for mat in w['materials'].values() for k in ['diffuse','normal']}
missing_tex=[n for n in textures if n and '$identity' not in n and not find('images/'+n.lstrip(',')+'.dds')]
print(json.dumps(dict(models=len(models),animations=len(animations),missingModels=missing,missingAnimations=missing_anims,missingTextures=missing_tex),indent=2))
if missing or missing_anims or missing_tex:raise SystemExit(1)
