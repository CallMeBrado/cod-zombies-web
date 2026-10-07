"""Export the locally installed BO1 zombies assets without running the game.
--map kino (default), --map ascension (zombie_cosmodrome) or --map frontend
(the interrogation room behind the zombies menu)."""
from pathlib import Path
import argparse, subprocess, os

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops')
base = [str(ROOT / '.tools/oat-source/build/bin/Release_x86/Unlinker.exe'), '--no-color',
        '--image-format', 'DDS', '--model-format', 'GLB', '--include-assets',
        'rawfile,mapents,weapon,material,image,font,xmodel,gfxworld,comworld,gameworldsp,clipmap,soundbank,xanim,fx']
ZONES = {
    'kino': [
        ('Common/code_post_gfx', 'bo1-ui', []),
        ('Common/common', 'bo1-base', []),
        ('Common/common_zombie', 'bo1-common', ['Common/common']),
        ('Common/zombie_theater', 'bo1-kino', ['Common/common', 'Common/common_zombie']),
        ('English/en_zombie_theater', 'bo1-english', ['Common/zombie_theater']),
    ],
    # Ascension shares the common zones extracted for Kino.
    'ascension': [
        ('Common/zombie_cosmodrome', 'bo1-cosmodrome', ['Common/common', 'Common/common_zombie']),
        ('Common/zombie_cosmodrome_patch', 'bo1-cosmodrome-patch', ['Common/common', 'Common/common_zombie', 'Common/zombie_cosmodrome']),
        ('English/en_zombie_cosmodrome', 'bo1-cosmodrome-english', ['Common/zombie_cosmodrome']),
    ],
    'call-of-the-dead': [
        ('Common/zombie_coast', 'bo1-coast', ['Common/common', 'Common/common_zombie']),
        ('Common/zombie_coast_patch', 'bo1-coast-patch', ['Common/common', 'Common/common_zombie', 'Common/zombie_coast']),
        ('English/en_zombie_coast', 'bo1-coast-english', ['Common/zombie_coast']),
    ],
    # The frontend (interrogation room) behind the zombies menu.
    'frontend': [
        ('Common/frontend', 'bo1-frontend', ['Common/common']),
        ('English/en_frontend', 'bo1-frontend-english', ['Common/frontend']),
    ],
}
parser = argparse.ArgumentParser()
parser.add_argument('--map', choices=sorted(ZONES), default='kino')
scratch=ROOT/'.cache/temp';scratch.mkdir(parents=True,exist_ok=True)
environment=dict(os.environ,TEMP=str(scratch),TMP=str(scratch))
for filename, output, dependencies in ZONES[parser.parse_args().map]:
    folder = ROOT / 'local-data' / output
    args = base + ['--output-folder', str(folder)]
    for dependency in dependencies:
        args += ['--load', str(GAME / 'zone' / (dependency + '.ff'))]
    args.append(str(GAME / 'zone' / (filename + '.ff')))
    print('Extracting ' + filename, flush=True)
    with (ROOT / 'local-data' / (output + '-extract.log')).open('w') as log:
        subprocess.run(args, cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT, check=True)
    print('Finished ' + output, flush=True)
