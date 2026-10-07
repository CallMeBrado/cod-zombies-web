"""Fold the owned movie's discrete speaker tracks into one stereo soundtrack."""
import json
import subprocess


def audio_tracks(path, input_index=0):
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=channels,channel_layout', '-of', 'json', str(path)]))
    return [{'input': f'{input_index}:a:{i}', 'channels': s['channels'],
             'layout': s.get('channel_layout', '')}
            for i, s in enumerate(probe.get('streams', []))]


def stereo_mix(tracks):
    """Bink's LR, centre, optional LFE, rear LR buses share one movie clock."""
    if not tracks:
        return []
    channels = [t['channels'] for t in tracks]
    filters = []
    for i, track in enumerate(tracks):
        source = '[' + track['input'] + ']'
        target = f'[stereo{i}]'
        if track['channels'] == 1:
            gain = 1 if len(tracks) == 1 else .5 if channels == [2, 1, 1, 2] and i == 2 else .70710678
            filters.append(f'{source}pan=stereo|c0={gain}*c0|c1={gain}*c0{target}')
        elif track['channels'] == 2:
            gain = 1 if i == 0 else .70710678
            filters.append(f'{source}aformat=channel_layouts=stereo,volume={gain}{target}')
        else:
            # A packed multichannel stream uses its named speaker layout;
            # include the bass channel rather than silently dropping it.
            layout = track['layout']
            speakers = {'5.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR'],
                        '5.1(side)': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
                        '7.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR']}.get(layout)
            if not speakers:
                raise ValueError('Unknown loading audio speaker layout: ' + str(track))
            left = ['FL', '.70710678*FC', '.5*LFE'] + ['.70710678*'+s for s in speakers if s in ('BL', 'SL')]
            right = ['FR', '.70710678*FC', '.5*LFE'] + ['.70710678*'+s for s in speakers if s in ('BR', 'SR')]
            filters.append(f'{source}pan=stereo|FL={"+".join(left)}|FR={"+".join(right)}{target}')
    labels = ''.join(f'[stereo{i}]' for i in range(len(tracks)))
    if len(tracks) > 1:
        filters.append(labels + f'amix=inputs={len(tracks)}:duration=longest:dropout_transition=0:normalize=0,'
                       'alimiter=limit=.95:level=false:latency=true[movie_audio]')
    else:
        filters.append(labels + ('alimiter=limit=.95:level=false:latency=true' if channels[0] > 2 else 'anull') + '[movie_audio]')
    return ['-filter_complex', ';'.join(filters), '-map', '[movie_audio]', '-ac', '2']
