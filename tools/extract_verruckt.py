"""Export World at War's Verrückt (nazi_zombie_asylum) from the installed game
with the project's exporter; all output stays under local-data on E:."""
from pathlib import Path
from zipfile import ZipFile
import json, struct, subprocess

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty World at War')
DATA = ROOT / 'local-data'
ZONES = GAME / 'zone/english'
base = [str(ROOT / '.tools/oat-source/build/bin/Release_x86/Unlinker.exe'), '--no-color', '--image-format', 'DDS', '--model-format', 'GLB',
        '--include-assets', 'rawfile,mapents,weapon,material,image,font,xmodel,gfxworld,comworld,gameworldsp,clipmap,sound,loadedsound,xanim,fx']
# The map, its localized sounds and its patch (newer scripts and assets).
for zone, output, dependencies in [
    ('nazi_zombie_asylum', 'verruckt', ['common']),
    ('localized_nazi_zombie_asylum', 'verruckt', ['common', 'nazi_zombie_asylum']),
    ('nazi_zombie_asylum_patch', 'verruckt-patch', ['common', 'nazi_zombie_asylum']),
]:
    args = base + ['--output-folder', str(DATA / output)]
    for dependency in dependencies:
        args += ['--load', str(ZONES / (dependency + '.ff'))]
    args.append(str(ZONES / (zone + '.ff')))
    print('Extracting ' + zone, flush=True)
    with (DATA / (zone + '-extract.log')).open('w', encoding='utf-8') as log:
        subprocess.run(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)

# Images the fastfile leaves as placeholders come from the IWDs (as Nacht).
world = json.loads((DATA / 'verruckt/web-world/nazi_zombie_asylum.json').read_text())
wanted = {m[k].lstrip(',') for m in world['materials'].values() for k in ['diffuse', 'normal'] if m.get(k)}
for zone in ['verruckt', 'verruckt-patch', 'common']:
    for model in (DATA / zone / 'model_export').glob('*_lod0.glb'):
        data = model.read_bytes(); length, kind = struct.unpack_from('<II', data, 12)
        if kind == 0x4E4F534A:
            wanted.update(i['uri'][len('../images/'):-4].lstrip(',') for i in json.loads(data[20:20 + length]).get('images', [])
                          if i.get('uri', '').startswith('../images/') and i['uri'].endswith('.dds'))
missing = {n for n in wanted if not any((DATA / z / 'images' / (n + '.dds')).is_file() for z in ['verruckt', 'verruckt-patch', 'common', 'nacht'])}
sources = {}
for archive in sorted((GAME / 'main').glob('*.iwd')):
    with ZipFile(archive) as z:
        entries = set(z.namelist())
        sources.update({n: archive for n in missing if 'images/' + n + '.iwi' in entries})
for name, archive in sources.items():
    target = DATA / 'verruckt/images' / (name + '.iwi'); target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(archive) as z: target.write_bytes(z.read('images/' + name + '.iwi'))
    subprocess.run([str(ROOT / '.tools/oat/ImageConverter.exe'), '--no-color', str(target)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
print(f'Verrückt extracted; recovered {len(sources)} IWD images, {len(missing - sources.keys())} unresolved.')
