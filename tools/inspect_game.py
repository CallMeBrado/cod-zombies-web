"""Read-only inventory of a local WaW installation. Uses only Python's stdlib."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import struct
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_GAME = Path(r"E:\SteamLibrary\steamapps\common\Call of Duty World at War")


class PE:
    def __init__(self, path: Path):
        self.data = path.read_bytes()
        if self.data[:2] != b"MZ":
            raise ValueError("Not a PE executable")
        pe = self.u32(0x3C)
        if self.data[pe:pe + 4] != b"PE\0\0":
            raise ValueError("Invalid PE signature")
        self.machine = self.u16(pe + 4)
        self.optional = pe + 24
        if self.u16(self.optional) != 0x10B:
            raise ValueError("This inspector currently supports PE32 only")
        self.base = self.u32(self.optional + 28)
        self.entry = self.base + self.u32(self.optional + 16)
        self.sections = []
        first = self.optional + self.u16(pe + 20)
        for i in range(self.u16(pe + 6)):
            off = first + i * 40
            self.sections.append({
                "name": self.data[off:off + 8].split(b"\0")[0].decode("ascii"),
                "virtualSize": self.u32(off + 8), "rva": self.u32(off + 12),
                "rawSize": self.u32(off + 16), "rawOffset": self.u32(off + 20),
                "executable": bool(self.u32(off + 36) & 0x20000000),
            })

    def u16(self, off):
        return struct.unpack_from("<H", self.data, off)[0]

    def u32(self, off):
        return struct.unpack_from("<I", self.data, off)[0]

    def offset(self, rva):
        for section in self.sections:
            delta = rva - section["rva"]
            if 0 <= delta < section["rawSize"]:
                return section["rawOffset"] + delta
        return None

    def string(self, off, limit=512):
        if off is None:
            return None
        end = self.data.find(b"\0", off, off + limit)
        if end < 0:
            return None
        try:
            return self.data[off:end].decode("ascii")
        except UnicodeDecodeError:
            return None

    def imports(self):
        rva = self.u32(self.optional + 104)
        off = self.offset(rva)
        result = {}
        if off is None:
            return result
        while any(self.data[off:off + 20]):
            original, _, _, name, thunk = struct.unpack_from("<5I", self.data, off)
            dll = self.string(self.offset(name))
            items = []
            pos = self.offset(original or thunk)
            if pos is not None:
                while self.u32(pos):
                    entry = self.u32(pos)
                    if entry & 0x80000000:
                        items.append({"ordinal": entry & 0xFFFF})
                    else:
                        name_off = self.offset(entry)
                        items.append(self.string(name_off + 2) if name_off is not None else None)
                    pos += 4
            result[dll or f"unknown_{name:x}"] = items
            off += 20
        return result

    def named_function_candidates(self):
        """Find adjacent name/function/flags records; these are not verified symbols."""
        text = next(section for section in self.sections if section["name"] == ".text")
        low = self.base + text["rva"]
        high = low + text["virtualSize"]
        candidates = []
        for section in self.sections:
            if section["executable"]:
                continue
            start = section["rawOffset"]
            end = min(len(self.data), start + section["rawSize"] - 12)
            for off in range(start, end, 4):
                name_va, function_va, flags = struct.unpack_from("<III", self.data, off)
                if not low <= function_va < high or flags > 31:
                    continue
                name = self.string(self.offset(name_va - self.base), 80)
                if not name or not re.fullmatch(r"[a-z_][a-z0-9_]{2,63}", name):
                    continue
                candidates.append({
                    "name": name, "functionVA": hex(function_va), "flags": flags,
                    "recordVA": hex(self.base + section["rva"] + off - start),
                    "recordOffset": off,
                })
        offsets = {candidate["recordOffset"] for candidate in candidates}
        return [candidate for candidate in candidates
                if candidate["recordOffset"] - 12 in offsets or candidate["recordOffset"] + 12 in offsets]


def strip_comments(source):
    # Preserve literals so comment markers inside a quoted string remain intact.
    token = re.compile(r'"(?:\\.|[^"\\])*"|/\*[\s\S]*?\*/|//[^\n]*')
    return token.sub(lambda match: match[0] if match[0].startswith('"') else " " * len(match[0]), source)


def script_inventory(roots):
    result = []
    for root in roots:
        for path in sorted(root.rglob("*.gsc")):
            source = path.read_text(encoding="utf-8", errors="replace")
            clean = strip_comments(source)
            definitions = re.findall(r"(?m)^\s*([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{", clean)
            includes = re.findall(r"#include\s+([\w\\/]+)\s*;", clean)
            qualified = sorted(set(re.findall(r"([\w\\/]+)::([A-Za-z_]\w*)", clean)))
            result.append({
                "path": str(path.relative_to(PROJECT)).replace("\\", "/"),
                "bytes": path.stat().st_size, "lines": source.count("\n") + 1,
                "functions": definitions, "includes": includes,
                "qualifiedCalls": [{"script": p, "function": f} for p, f in qualified],
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            })
    return result


def parse_entities(path):
    if not path.exists():
        return []
    source = path.read_text(encoding="utf-8", errors="replace")
    return [dict(re.findall(r'"([^"\n]*)"\s*"([^"\n]*)"', block))
            for block in re.findall(r"\{([^{}]*)\}", source)]


def inspect(game):
    executable = game / "CoDWaW.exe"
    if not executable.is_file():
        raise FileNotFoundError(f"CoDWaW.exe is missing in {game}")
    pe = PE(executable)
    archives = []
    for path in sorted((game / "main").glob("*.iwd")):
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            archives.append({"name": path.name, "bytes": path.stat().st_size,
                             "entries": len(entries),
                             "extensions": dict(Counter(Path(entry.filename).suffix for entry in entries))})
    maps = []
    names = {"nazi_zombie_prototype": "Nacht der Untoten", "nazi_zombie_asylum": "Verrückt",
             "nazi_zombie_sumpf": "Shi No Numa", "nazi_zombie_factory": "Der Riese"}
    for zone in sorted((game / "zone" / "english").glob("nazi_zombie_*.ff")):
        maps.append({"file": str(zone), "bytes": zone.stat().st_size,
                     "title": names.get(zone.stem, zone.stem),
                     "headerHex": zone.read_bytes()[:16].hex()})
    scripts = script_inventory([PROJECT / "local-data" / "nacht", PROJECT / "local-data" / "common"])
    ents = parse_entities(PROJECT / "local-data" / "nacht" / "maps" / "nazi_zombie_prototype.d3dbsp.ents")
    initial_spawns = [entity for entity in ents if entity.get("targetname") == "initial_spawn_points"]
    spawns = initial_spawns or [entity for entity in ents if entity.get("classname", "").startswith("info_player")]
    native = pe.named_function_candidates()
    result = {
        "gameRoot": str(game), "executable": {
            "file": str(executable), "bytes": executable.stat().st_size,
            "sha256": hashlib.sha256(pe.data).hexdigest(),
            "architecture": "x86" if pe.machine == 0x14C else hex(pe.machine),
            "imageBase": hex(pe.base), "entryPoint": hex(pe.entry),
            "sections": pe.sections, "imports": pe.imports(),
            "namedFunctionCandidates": native,
            "candidateCaveat": "Static pointer-table matches, not confirmed decompiled functions or verified symbols.",
        }, "archives": archives, "zombiesZones": maps,
        "scripts": scripts, "entities": ents,
        "entityClasses": dict(Counter(entity.get("classname", "unknown") for entity in ents)),
        "playerSpawns": spawns,
        "runtime": {"originalExecutableRunningInBrowser": False,
                    "browserGameplayImplementation": "Separate JavaScript solo runtime in web/game.js",
                    "originalGscRuntimeImplemented": False},
    }
    output = PROJECT / "local-data" / "inspection.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"report": str(output), "architecture": result["executable"]["architecture"],
                      "importedLibraries": list(result["executable"]["imports"]),
                      "nativeFunctionCandidates": len(native), "originalScripts": len(scripts),
                      "scriptLines": sum(script["lines"] for script in scripts),
                      "mapEntities": len(ents), "playerSpawns": spawns}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME)
    inspect(parser.parse_args().game_dir.resolve())
