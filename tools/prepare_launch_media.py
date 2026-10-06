"""Convert the installed Zombies loading movies without copying assets into Git."""
from pathlib import Path
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'local-data' / 'launch'
OUTPUT.mkdir(parents=True, exist_ok=True)
GAMES = Path(r'E:\SteamLibrary\steamapps\common')
MOVIES = {
    'nacht': ('Call of Duty World at War', 'nazi_zombie_prototype_load'),
    'der-riese': ('Call of Duty World at War', 'nazi_zombie_factory_load'),
    'kino': ('Call of Duty Black Ops', 'zombie_theater_load'),
}
for name, (game, movie) in MOVIES.items():
    source = GAMES / game / 'main' / 'video' / (movie + '.bik')
    if not source.exists():
        continue
    destination = OUTPUT / (name + '.mp4')
    metadata = OUTPUT / (name + '.json')
    stamp = {'source': str(source), 'size': source.stat().st_size,
             'mtime': source.stat().st_mtime_ns, 'encoding': 'h264-aac-v1'}
    if destination.exists() and metadata.exists():
        if json.loads(metadata.read_text()).get('sourceStamp') == stamp:
            continue
    print('Preparing original ' + name + ' loading movie on E:...', flush=True)
    temporary = OUTPUT / (name + '.tmp.mp4')
    subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-i', str(source),
                    '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast',
                    '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                    '-movflags', '+faststart', str(temporary)], check=True)
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error',
        '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', str(temporary)]))
    os.replace(temporary, destination)
    metadata.write_text(json.dumps({'sourceStamp': stamp,
        'duration': float(probe['format']['duration']),
        'hasAudio': any(s['codec_type'] == 'audio' for s in probe['streams']),
        'url': '/data/launch/' + name + '.mp4'}, indent=2))
    print('Ready: ' + name + ' loading movie.', flush=True)
