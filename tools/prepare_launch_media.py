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
    'buried': ('Call of Duty Black Ops II', 'zm_buried_load'),
}
# BO2's loading movies are silent video; the soundtrack is the streamed
# bik_<movie> alias: a left/right stem and its secondary centre stem
# (bik_<movie>_c, in the English bank), exported by extract_bo2.py.
DATA = ROOT / 'local-data'
SOUNDTRACKS = {
    'buried': [DATA / 'bo2-dlc/sound/bik/load/zm_buried_load_lr.SN65.pc.snd.flac',
               DATA / 'bo2-english/english/sound/bik/load/zm_buried_load_c.SN65.pc.snd.flac'],
}
for name, (game, movie) in MOVIES.items():
    source = GAMES / game / 'main' / 'video' / (movie + '.bik')
    if game == 'Call of Duty Black Ops II':
        source = GAMES / game / 'video' / (movie + '.webm')
    if not source.exists():
        continue
    stems = [p for p in SOUNDTRACKS.get(name, []) if p.exists()]
    destination = OUTPUT / (name + '.mp4')
    metadata = OUTPUT / (name + '.json')
    stamp = {'source': str(source), 'size': source.stat().st_size,
             'mtime': source.stat().st_mtime_ns, 'encoding': 'h264-aac-v2',
             'soundtrack': [[str(p), p.stat().st_size] for p in stems]}
    if destination.exists() and metadata.exists():
        if json.loads(metadata.read_text()).get('sourceStamp') == stamp:
            continue
    print('Preparing original ' + name + ' loading movie on E:...', flush=True)
    temporary = OUTPUT / (name + '.tmp.mp4')
    audio = ['-map', '0:a:0?']
    if stems:
        # Left/right plus the mono centre stem at -3 dB in both channels.
        inputs = [arg for p in stems for arg in ('-i', str(p))]
        mix = ('[2:a]pan=stereo|c0=0.7071*c0|c1=0.7071*c0[c];[1:a][c]amix=inputs=2:normalize=0[a]' if len(stems) == 2 else '[1:a]anull[a]')
        audio = ['-filter_complex', mix, '-map', '[a]', '-shortest']
    else:
        inputs = []
    subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-i', str(source), *inputs,
                    '-map', '0:v:0', *audio, '-c:v', 'libx264', '-preset', 'fast',
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
