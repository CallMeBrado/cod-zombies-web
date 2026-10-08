"""Convert the installed Zombies loading movies without copying assets into Git."""
from pathlib import Path
import json
import os
import subprocess
import argparse
from launch_audio import audio_tracks, stereo_mix

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'local-data' / 'launch'
OUTPUT.mkdir(parents=True, exist_ok=True)
GAMES = Path(r'E:\SteamLibrary\steamapps\common')
MOVIES = {
    'nacht': ('Call of Duty World at War', 'nazi_zombie_prototype_load'),
    'der-riese': ('Call of Duty World at War', 'nazi_zombie_factory_load'),
    'verruckt': ('Call of Duty World at War', 'nazi_zombie_asylum_load'),
    'shi-no-numa': ('Call of Duty World at War', 'nazi_zombie_sumpf_load'),
    'kino': ('Call of Duty Black Ops', 'zombie_theater_load'),
    'ascension': ('Call of Duty Black Ops', 'zombie_cosmodrome_load'),
    'call-of-the-dead': ('Call of Duty Black Ops', 'zombie_coast_load'),
    'moon': ('Call of Duty Black Ops', 'zombie_moon_load'),
    'shangri-la': ('Call of Duty Black Ops', 'zombie_temple_load'),
    'dead-ops': ('Call of Duty Black Ops', 'zombietron_load'),
    'buried': ('Call of Duty Black Ops II', 'zm_buried_load'),
    'die-rise': ('Call of Duty Black Ops II', 'zm_highrise_load'),
}
# BO2's loading movies are silent video; the soundtrack is the streamed
# bik_<movie> alias: a left/right stem and its secondary centre stem
# (bik_<movie>_c, in the English bank), exported by extract_bo2.py.
DATA = ROOT / 'local-data'
SOUNDTRACKS = {
    'buried': [DATA / 'bo2-dlc/sound/bik/load/zm_buried_load_lr.SN65.pc.snd.flac',
               DATA / 'bo2-english/english/sound/bik/load/zm_buried_load_c.SN65.pc.snd.flac'],
    'die-rise': [DATA / 'bo2-die-rise/sound/zmb/level/zm_highrise/load_movie.SL65.pc.snd.flac'],
}
parser=argparse.ArgumentParser()
parser.add_argument('--map',choices=[*MOVIES,'nuketown','tranzit'])
selected=parser.parse_args().map
for name, (game, movie) in MOVIES.items():
    if selected and selected!=name:continue
    source = GAMES / game / 'main' / 'video' / (movie + '.bik')
    if game == 'Call of Duty Black Ops II':
        source = GAMES / game / 'video' / (movie + '.webm')
    if not source.exists():
        continue
    stems = [p for p in SOUNDTRACKS.get(name, []) if p.exists()]
    # WaW's Shi No Numa BIK is a four-frame loading loop with no audio.
    # Loop those original frames with the map's owned splash-screen music.
    loading_loop = name == 'shi-no-numa'
    if loading_loop:
        manifest = json.loads((DATA / 'gameplay/shi-no-numa/manifest.json').read_text())
        stems = [DATA / manifest['sounds']['mx_splash_screen'][0]['url'].removeprefix('/data/')]
    destination = OUTPUT / (name + '.mp4')
    metadata = OUTPUT / (name + '.json')
    stamp = {'source': str(source), 'size': source.stat().st_size,
             'mtime': source.stat().st_mtime_ns, 'encoding': 'h264-aac-stereo-v3',
             'soundtrack': [[str(p), p.stat().st_size, p.stat().st_mtime_ns] for p in stems]}
    if loading_loop: stamp['loadingLoopSeconds'] = 20
    previous = json.loads(metadata.read_text()) if metadata.exists() else {}
    if destination.exists() and metadata.exists():
        if previous.get('sourceStamp') == stamp:
            continue
    print('Preparing original ' + name + ' loading movie on E:...', flush=True)
    temporary = OUTPUT / (name + '.tmp.mp4')
    # Audio fixes can reuse the existing H.264 frames without re-encoding
    # the movie. Keep the original video only when the installed source matches.
    reuse_video = not loading_loop and destination.exists() and all(previous.get('sourceStamp', {}).get(k) == stamp[k]
                                               for k in ('source', 'size', 'mtime'))
    inputs = ['-i', str(destination)] if reuse_video else []
    source_index = 1 if reuse_video else 0
    inputs += (['-stream_loop', '-1'] if loading_loop else []) + ['-i', str(source)]
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
                    '-map', '0:v:0', *audio, *(['-t', '20'] if loading_loop else ['-shortest'] if stems else []), *video, '-c:a', 'aac', '-b:a', '192k',
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
for map_id in ['nuketown','tranzit']:
    if selected and selected!=map_id:continue
    nuketown_manifest=DATA/('gameplay/bo2-'+map_id+'/manifest.json')
    if not nuketown_manifest.exists():continue
    manifest=json.loads(nuketown_manifest.read_text())
    poster=DATA/('gameplay/bo2-'+map_id+'/hud/'+map_id+'-load.png')
    sound=manifest['sounds'].get('mx_zombie_wave_1',[{}])[0].get('url')
    soundtrack=DATA/sound.removeprefix('/data/') if sound else None
    if poster.exists() and soundtrack and soundtrack.exists():
        destination=OUTPUT/(map_id+'.mp4'); metadata=OUTPUT/(map_id+'.json')
        stamp={'presentation':'native-'+map_id+'-still-v1','source':str(poster),'mtime':poster.stat().st_mtime_ns,'soundtrack':[str(soundtrack),soundtrack.stat().st_mtime_ns]}
        previous=json.loads(metadata.read_text()).get('sourceStamp') if metadata.exists() else None
        if not destination.exists() or previous!=stamp:
            print('Preparing original '+map_id+' artwork and soundtrack on E:...',flush=True)
            temporary=OUTPUT/(map_id+'.tmp.mp4')
            subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-loop','1','-i',str(poster),'-i',str(soundtrack),
                '-t','20','-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                '-r','24','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-ac','2','-c:a','aac','-b:a','192k','-movflags','+faststart',str(temporary)],check=True)
            os.replace(temporary,destination)
            metadata.write_text(json.dumps({'sourceStamp':stamp,'duration':20,'hasAudio':True,'url':'/data/launch/'+map_id+'.mp4'},indent=2))
