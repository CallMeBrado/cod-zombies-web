"""Prepare the owned Spaceland intro with its English surround buses folded to stereo."""
from pathlib import Path
import json
import subprocess
import os
import ctypes
import struct
from iw7_memory import ROOT, state
from launch_audio import audio_tracks

source = Path(state()['directory']) / 'zombies_cp_zmb_intro.bik'
output = ROOT / 'local-data/launch'
output.mkdir(parents=True, exist_ok=True)
tracks = audio_tracks(source)
# IW stores separate language soundtracks in the same BIK, each with
# LR, centre, LFE and two surround pairs. Do not mix the languages together.
if len(tracks) % 5 or any([t['channels'] for t in tracks[i:i+5]] != [2, 1, 1, 2, 2] for i in range(0, len(tracks), 5)):
    raise ValueError('Unrecognized IW intro language/speaker layout; inspect before converting')
stamp = {'source': str(source), 'size': source.stat().st_size, 'mtime': source.stat().st_mtime_ns,
         'encoding': 'spaceland-english-stereo-v1', 'audioStreams': [0, 1, 2, 3, 4]}
metadata = output / 'spaceland.json'
movie = output / 'spaceland.mp4'
if not metadata.exists() or json.loads(metadata.read_text(encoding='utf8')).get('sourceStamp') != stamp or not movie.exists():
    temporary = output / 'spaceland.tmp.mp4'
    filters = '[0:a:0]aformat=channel_layouts=stereo[s0];[0:a:1]pan=stereo|c0=.70710678*c0|c1=.70710678*c0[s1];[0:a:2]pan=stereo|c0=.5*c0|c1=.5*c0[s2];[0:a:3]volume=.70710678[s3];[0:a:4]volume=.70710678[s4];[s0][s1][s2][s3][s4]amix=inputs=5:duration=longest:normalize=0,alimiter=limit=.95:level=false:latency=true[audio]'
    # FFmpeg decodes the soundtrack but not this Bink 2 video revision.
    # Use the game's installed decoder through its public Bink API, feeding
    # decoded BGRA frames directly to FFmpeg. No raw movie is written to disk.
    decoder = ctypes.WinDLL(str(source.parent / 'bink2w64.dll'))
    decoder.BinkOpen.argtypes = [ctypes.c_char_p, ctypes.c_uint]
    decoder.BinkOpen.restype = ctypes.c_void_p
    for name in ('BinkClose', 'BinkDoFrame', 'BinkNextFrame'):
        getattr(decoder, name).argtypes = [ctypes.c_void_p]
    decoder.BinkSetSoundOnOff.argtypes = [ctypes.c_void_p, ctypes.c_int]
    decoder.BinkCopyToBuffer.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint]
    handle = decoder.BinkOpen(str(source).encode('utf8'), 0)
    if not handle:
        raise ValueError('The installed Bink decoder could not open the Spaceland intro')
    width, height, frames, frame, last_frame, rate, divisor = struct.unpack('<7I', ctypes.string_at(handle, 28))
    decoder.BinkSetSoundOnOff(handle, 0)
    buffer = ctypes.create_string_buffer(width * height * 4)
    process = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', f'{width}x{height}', '-framerate', f'{rate}/{divisor}', '-i', 'pipe:0',
                                '-i', str(source), '-map', '0:v:0', '-filter_complex', filters.replace('[0:a:', '[1:a:'), '-map', '[audio]',
                                '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE)
    try:
        for i in range(frames):
            decoder.BinkDoFrame(handle)
            decoder.BinkCopyToBuffer(handle, buffer, width * 4, height, 0, 0, 3)
            process.stdin.write(buffer.raw)
            if i + 1 < frames:
                decoder.BinkNextFrame(handle)
            if (i + 1) % 1000 == 0:
                print(f'Decoded {i + 1}/{frames} native intro frames', flush=True)
        process.stdin.close()
        if process.wait() != 0:
            raise ValueError('Spaceland intro encoding failed')
    finally:
        decoder.BinkClose(handle)
        if process.poll() is None:
            process.terminate()
            process.wait()
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,channels', '-of', 'json', str(temporary)]))
    audio = [s for s in probe['streams'] if s['codec_type'] == 'audio']
    if len(audio) != 1 or audio[0]['channels'] != 2:
        raise ValueError('Spaceland intro must have one stereo soundtrack')
    os.replace(temporary, movie)
    metadata.write_text(json.dumps({'sourceStamp': stamp, 'duration': float(probe['format']['duration']), 'audioChannels': 2, 'hasAudio': True, 'url': '/data/launch/spaceland.mp4'}, indent=2), encoding='utf8')
subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-ss', '184', '-i', str(movie), '-frames:v', '1', str(ROOT / 'local-data/gameplay/iw7-spaceland/poster.jpg')], check=True)
print('Spaceland native intro ready, with a single stereo English soundtrack.')
