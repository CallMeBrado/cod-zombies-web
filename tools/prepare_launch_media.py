"""Convert the installed Zombies loading movies without copying assets into Git."""
from pathlib import Path
import json
import os
import subprocess
from launch_audio import audio_tracks, stereo_mix

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'local-data' / 'launch'
OUTPUT.mkdir(parents=True, exist_ok=True)
GAMES = Path(r'E:\SteamLibrary\steamapps\common')
MOVIES = {
    'nacht': ('Call of Duty World at War', 'nazi_zombie_prototype_load'),
    'der-riese': ('Call of Duty World at War', 'nazi_zombie_factory_load'),
    'verruckt': ('Call of Duty World at War', 'nazi_zombie_asylum_load'),
    'kino': ('Call of Duty Black Ops', 'zombie_theater_load'),
    'ascension': ('Call of Duty Black Ops', 'zombie_cosmodrome_load'),
    'call-of-the-dead': ('Call of Duty Black Ops', 'zombie_coast_load'),
    'dead-ops': ('Call of Duty Black Ops', 'zombietron_load'),
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
             'mtime': source.stat().st_mtime_ns, 'encoding': 'h264-aac-stereo-v3',
             'soundtrack': [[str(p), p.stat().st_size, p.stat().st_mtime_ns] for p in stems]}
    previous = json.loads(metadata.read_text()) if metadata.exists() else {}
    if destination.exists() and metadata.exists():
        if previous.get('sourceStamp') == stamp:
            continue
    print('Preparing original ' + name + ' loading movie on E:...', flush=True)
    temporary = OUTPUT / (name + '.tmp.mp4')
    # Audio fixes can reuse the existing H.264 frames without re-encoding
    # the movie. Keep the original video only when the installed source matches.
    reuse_video = destination.exists() and all(previous.get('sourceStamp', {}).get(k) == stamp[k]
                                               for k in ('source', 'size', 'mtime'))
    inputs = ['-i', str(destination)] if reuse_video else []
    source_index = 1 if reuse_video else 0
    inputs += ['-i', str(source)]
    if stems:
        tracks = []
        for i, p in enumerate(stems, source_index + 1):
            inputs += ['-i', str(p)]
            tracks += audio_tracks(p, i)
    else:
        tracks = audio_tracks(source, source_index)
    audio = stereo_mix(tracks) if tracks else ['-an']
    video = ['-c:v', 'copy'] if reuse_video else ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p']
    subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', *inputs,
                    '-map', '0:v:0', *audio, *(['-shortest'] if stems else []), *video, '-c:a', 'aac', '-b:a', '192k',
                    '-movflags', '+faststart', str(temporary)], check=True)
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error',
        '-show_entries', 'format=duration:stream=codec_type,channels,channel_layout', '-of', 'json', str(temporary)]))
    output_audio = [s for s in probe['streams'] if s['codec_type'] == 'audio']
    if tracks and (len(output_audio) != 1 or output_audio[0]['channels'] != 2):
        raise RuntimeError('Loading movie must contain one complete stereo soundtrack: ' + name)
    os.replace(temporary, destination)
    metadata.write_text(json.dumps({'sourceStamp': stamp,
        'duration': float(probe['format']['duration']),
        'hasAudio': any(s['codec_type'] == 'audio' for s in probe['streams']),
        'audioChannels': output_audio[0]['channels'] if output_audio else 0,
        'sourceAudioTracks': tracks,
        'url': '/data/launch/' + name + '.mp4'}, indent=2))
    print('Ready: ' + name + ' loading movie.', flush=True)

# The installed Nuketown Zombies release has no loading WEBM. Use its own
# original menu/loading artwork and native underscore, never another map's movie.
nuketown_manifest=DATA/'gameplay/bo2-nuketown/manifest.json'
if nuketown_manifest.exists():
    manifest=json.loads(nuketown_manifest.read_text())
    poster=DATA/'gameplay/bo2-nuketown/hud/nuketown-load.png'
    sound=manifest['sounds'].get('mx_zombie_wave_1',[{}])[0].get('url')
    soundtrack=DATA/sound.removeprefix('/data/') if sound else None
    if poster.exists() and soundtrack and soundtrack.exists():
        destination=OUTPUT/'nuketown.mp4'; metadata=OUTPUT/'nuketown.json'
        stamp={'presentation':'native-nuketown-still-v1','source':str(poster),'mtime':poster.stat().st_mtime_ns,'soundtrack':[str(soundtrack),soundtrack.stat().st_mtime_ns]}
        previous=json.loads(metadata.read_text()).get('sourceStamp') if metadata.exists() else None
        if not destination.exists() or previous!=stamp:
            print('Preparing original Nuketown artwork and soundtrack on E:...',flush=True)
            temporary=OUTPUT/'nuketown.tmp.mp4'
            subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-loop','1','-i',str(poster),'-i',str(soundtrack),
                '-t','20','-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                '-r','24','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-ac','2','-c:a','aac','-b:a','192k','-movflags','+faststart',str(temporary)],check=True)
            os.replace(temporary,destination)
            metadata.write_text(json.dumps({'sourceStamp':stamp,'duration':20,'hasAudio':True,'url':'/data/launch/nuketown.mp4'},indent=2))
