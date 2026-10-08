"""Read-only access to assets loaded by a local Cordycep IW handler.

Layout references: Scobalula/Cordycep XAssetPool.h and XAsset.h.
No writes, injection, or access to the live game's process are performed.
"""
import ctypes
from ctypes import wintypes
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORDYCEP = ROOT / '.tools/cordycep'


class Memory:
    def __init__(self, pid):
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p,
                                                ctypes.c_void_p, ctypes.c_size_t,
                                                ctypes.POINTER(ctypes.c_size_t)]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.OpenProcess(0x10 | 0x1000, False, pid)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None

    def read(self, address, size):
        if size == 0:
            return b''
        if not 0 < address < 0x800000000000 or not 0 <= size <= 256 * 1024 * 1024:
            raise ValueError(f'Invalid IW memory span: {address:#x} / {size}')
        result = ctypes.create_string_buffer(size)
        count = ctypes.c_size_t()
        if not self.kernel.ReadProcessMemory(self.handle, address, result, size, ctypes.byref(count)) or count.value != size:
            raise OSError(f'Cannot read IW asset at {address:#x} ({size} bytes)')
        return result.raw

    def unpack(self, fmt, address):
        return struct.unpack(fmt, self.read(address, struct.calcsize(fmt)))

    def pointer(self, address):
        return self.unpack('<Q', address)[0]

    def string(self, address, limit=1024):
        # Read in small blocks, stopping before inaccessible pages at a terminator.
        result = bytearray()
        while len(result) < limit:
            block = self.read(address + len(result), min(32, limit - len(result), 4096 - ((address + len(result)) % 4096)))
            if b'\0' in block:
                result.extend(block.split(b'\0', 1)[0])
                return result.decode('utf8', errors='replace')
            result.extend(block)
        raise ValueError('IW asset name exceeds the bounded string size')


def state(path=CORDYCEP / 'Data/CurrentHandler.csi'):
    data = path.read_bytes()
    game, pools, strings, size = struct.unpack_from('<QQQI', data)
    directory = data[28:28 + size].decode('utf8')
    if not directory or 'Infinite Warfare' not in directory:
        raise ValueError('Cordycep is not configured for Infinite Warfare')
    return {'game': game, 'pools': pools, 'strings': strings, 'directory': directory}


def assets(memory, pools, asset_type):
    current = memory.pointer(pools + asset_type * 40)
    seen = set()
    while current:
        if current in seen or len(seen) >= 100000:
            raise ValueError('Invalid or cyclic IW asset list')
        seen.add(current)
        header, temporary, next_entry, previous, identity, kind, size = memory.unpack('<7Q', current)
        if header:
            yield {'header': header, 'temporary': bool(temporary), 'size': size, 'entry': current}
        current = next_entry
