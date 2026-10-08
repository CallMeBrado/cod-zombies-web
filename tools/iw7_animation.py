"""Decode the original IW7 skeletal animation streams without resampling.

Layout: iw7-mod XAnimParts; stream decoding: Greyhound CoDXAnimTranslator.
The exported keys, delta motion, duration and native notifications are retained.
"""
import struct
import math


class Stream:
    def __init__(self, data):
        self.data, self.offset = data, 0

    def take(self, fmt):
        fmt = '<' + fmt
        size = struct.calcsize(fmt)
        if self.offset + size > len(self.data):
            raise ValueError('IW animation stream exceeds its declared size')
        value = struct.unpack_from(fmt, self.data, self.offset)
        self.offset += size
        return value[0] if len(value) == 1 else list(value)


def decode_animation(memory, context, pointer):
    h = memory.read(pointer, 136)
    name = memory.string(struct.unpack_from('<Q', h)[0])
    bone_ids, byte_ptr, short_ptr, int_ptr, random_short_ptr, random_byte_ptr, random_int_ptr, index_ptr, note_ptr, delta_ptr = struct.unpack_from('<10Q', h, 8)
    random_short_count, random_byte_count, index_count = struct.unpack_from('<3I', h, 88)
    fps, = struct.unpack_from('<f', h, 100)
    byte_count, short_count, int_count, random_int_count, frames = struct.unpack_from('<5H', h, 108)
    flags = h[118]
    none_r, animated_2d, animated_3d, static_2d, static_3d, translated, precise, static_t, none_t, bone_count = h[119:129]
    if not 0 < fps <= 240 or frames > 20000 or not bone_count:
        raise ValueError('Invalid native IW animation: ' + name)
    ids = memory.unpack('<' + 'I' * bone_count, bone_ids)
    names = [memory.string(context['strings'] + value) for value in ids]
    if len(set(names)) != len(names):
        raise ValueError('Duplicate native animation bones: ' + name)
    b = Stream(memory.read(byte_ptr, byte_count))
    s = Stream(memory.read(short_ptr, short_count * 2))
    i = Stream(memory.read(int_ptr, int_count * 4))
    rs = Stream(memory.read(random_short_ptr, random_short_count * 2))
    rb = Stream(memory.read(random_byte_ptr, random_byte_count))
    indices = Stream(memory.read(index_ptr, index_count * (2 if frames > 255 else 1)))
    channels = {tag: {} for tag in names}
    # IW's zero-rotation category explicitly resets the local orientation.
    # Unlike untranslated bones, these do not retain their bind rotation.
    for tag in names[:none_r]:
        channels[tag]['rotation']=[[0,0,0,0,1]]
    large = frames > 255

    def prepare_indices(count):
        if large and count >= 64:
            for _ in range(frames + 2):
                if s.take('H') == frames:
                    return
            raise ValueError('Unterminated IW inline frame indices')

    def frame_indices(count):
        stream, fmt = (b, 'B') if not large else (s, 'H') if count < 64 or not index_ptr else (indices, 'H')
        result = [stream.take(fmt) for _ in range(count + 1)]
        if result != sorted(result) or min(result) < 0 or max(result) > frames:
            raise ValueError('Invalid native frame indices: ' + name)
        return result

    def quaternion(values):
        q = [float(v) / 32768 for v in values]
        return [0, 0, *q] if len(q) == 2 else q

    def rotation(start, count, dimension, animated):
        for bone in range(start, start + count):
            n = s.take('H') if animated else 0
            if animated:
                prepare_indices(n)
            values = [(rs if animated else s).take('h' * dimension) for _ in range(n + 1)]
            times = frame_indices(n) if animated else [0]
            channels[names[bone]]['rotation'] = [[frame, *quaternion(value)] for frame, value in zip(times, values)]

    start = none_r
    rotation(start, animated_2d, 2, True); start += animated_2d
    rotation(start, animated_3d, 4, True); start += animated_3d
    rotation(start, static_2d, 2, False); start += static_2d
    rotation(start, static_3d, 4, False)
    if start + static_3d > bone_count:
        raise ValueError('IW rotation categories exceed bone count')
    for count, high in ((translated, False), (precise, True)):
        for _ in range(count):
            bone = b.take('B')
            n = s.take('H')
            prepare_indices(n)
            minimum, step = i.take('fff'), i.take('fff')
            values = [(rs if high else rb).take('HHH' if high else 'BBB') for _ in range(n + 1)]
            times = frame_indices(n)
            if bone >= bone_count:
                raise ValueError('IW translation references an invalid bone')
            channels[names[bone]]['position'] = [[frame, *[minimum[j] + step[j] * value[j] for j in range(3)]] for frame, value in zip(times, values)]
    for _ in range(static_t):
        value, bone = i.take('fff'), b.take('B')
        if bone >= bone_count:
            raise ValueError('IW static translation references an invalid bone')
        channels[names[bone]]['position'] = [[0, *value]]
    delta = {}
    if delta_ptr:
        delta_t, delta_2d, delta_3d = memory.unpack('<QQQ', delta_ptr)
        if delta_t:
            n, small = memory.unpack('<HB', delta_t)
            minimum = memory.unpack('<3f', delta_t + 8)
            if n:
                step = memory.unpack('<3f', delta_t + 20)
                pointer = memory.pointer(delta_t + 32)
                ts = memory.unpack('<' + ('H' if large else 'B') * (n + 1), delta_t + 40)
                raw = memory.unpack('<' + ('B' if small else 'H') * ((n + 1) * 3), pointer)
                delta['position'] = [[ts[k], *[minimum[j] + step[j] * raw[k * 3 + j] for j in range(3)]] for k in range(n + 1)]
            else:
                delta['position'] = [[0, *minimum]]
        for pointer, dimension in ((delta_2d, 2), (delta_3d, 4)):
            if not pointer:
                continue
            n, = memory.unpack('<H', pointer)
            source = memory.pointer(pointer + 8) if n else pointer + 8
            ts = memory.unpack('<' + ('H' if large else 'B') * (n + 1), pointer + 16) if n else [0]
            raw = memory.unpack('<' + 'h' * ((n + 1) * dimension), source)
            delta['rotation'] = [[ts[k], *quaternion(raw[k * dimension:(k + 1) * dimension])] for k in range(n + 1)]
    notes = []
    for n in range(h[129]):
        tag, fraction = memory.unpack('<If', note_ptr + n * 8)
        notes.append({'name': memory.string(context['strings'] + tag), 'frame': int(frames * fraction), 'time': frames * fraction / fps})
    result = {'name': name, 'fps': fps, 'frames': frames, 'duration': frames / fps, 'loop': bool(flags & 1), 'flags': flags,
              'viewmodel': name.startswith(('vm_', 'viewmodel_')), 'bones': channels, 'delta': delta, 'notes': notes}
    for channel in [*channels.values(), delta]:
        for values in channel.values():
            if any(not math.isfinite(number) for key in values for number in key):
                raise ValueError('Non-finite native animation key: ' + name)
    return result
