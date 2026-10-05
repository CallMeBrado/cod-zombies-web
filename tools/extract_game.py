"""Extract only the selected original Zombies map and its shared dependencies."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import struct
import subprocess
import sys
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GAME = Path(r"E:\SteamLibrary\steamapps\common\Call of Duty World at War")


def recover_referenced_images(game):
    """Resolve image references that OAT skips as fastfile placeholder assets."""
    world = json.loads((ROOT / "local-data/nacht/web-world/nazi_zombie_prototype.json").read_text())
    wanted = {item[key].lstrip(",") for item in world["materials"].values() for key in ['diffuse','normal'] if item.get(key)}
    for zone in ["nacht", "common"]:
        for model in (ROOT / "local-data" / zone / "model_export").glob("*_lod0.glb"):
            data = model.read_bytes()
            json_length, chunk_type = struct.unpack_from("<II", data, 12)
            if chunk_type != 0x4E4F534A:
                continue
            gltf = json.loads(data[20:20 + json_length])
            for image in gltf.get("images", []):
                uri = image.get("uri", "")
                if uri.startswith("../images/") and uri.endswith(".dds"):
                    wanted.add(uri[len("../images/"):-4].lstrip(","))
    missing = {name for name in wanted if not any((ROOT / "local-data" / zone / "images" / f"{name}.dds").is_file() for zone in ["nacht", "common"])}
    if not missing:
        return
    sources = {}
    for archive in sorted((game / "main").glob("*.iwd")):
        with ZipFile(archive) as z:
            entries = set(z.namelist())
            for name in missing:
                if f"images/{name}.iwi" in entries:
                    sources[name] = archive  # Later IWDs override earlier ones, as in the game.
    converter = ROOT / ".tools/oat/ImageConverter.exe"
    for name, archive in sources.items():
        target = ROOT / "local-data/nacht/images" / f"{name}.iwi"
        target.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(archive) as z:
            target.write_bytes(z.read(f"images/{name}.iwi"))
        subprocess.run([str(converter), "--no-color", str(target)], cwd=ROOT, check=True)
    unresolved = missing - sources.keys()
    if unresolved:
        print(f"Unresolved referenced images: {sorted(unresolved)}", flush=True)


def extract(game):
    unlinker = ROOT / ".tools/oat-source/build/bin/Release_x86/Unlinker.exe"
    if not unlinker.is_file():
        raise FileNotFoundError("Build the custom exporter with tools/build_exporter.ps1 first")
    zones = game / "zone/english"
    for filename in ["CoDWaW.exe", "zone/english/code_post_gfx.ff", "zone/english/common.ff", "zone/english/nazi_zombie_prototype.ff"]:
        if not (game / filename).is_file():
            raise FileNotFoundError(f"Missing game file: {game / filename}")
    base = [str(unlinker), "--no-color", "--image-format", "DDS", "--model-format", "GLB",
            "--include-assets", "rawfile,mapents,weapon,material,image,font,xmodel,gfxworld,comworld,gameworldsp,clipmap,sound,loadedsound,xanim,fx"]
    for zone, output in [("code_post_gfx", "ui"), ("common", "common"), ("nazi_zombie_prototype", "nacht")]:
        args = base + ["--output-folder", str(ROOT / "local-data" / output)]
        if output == "nacht":
            args += ["--load", str(zones / "common.ff")]
        args.append(str(zones / f"{zone}.ff"))
        log = ROOT / "local-data" / f"{output}-extract.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        print(f"Extracting {zone} to {ROOT / 'local-data' / output}", flush=True)
        with log.open("w", encoding="utf-8") as stream:
            subprocess.run(args, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, check=True)
        print(f"Finished. Log: {log}", flush=True)
    recover_referenced_images(game)
    subprocess.run([sys.executable, "-B", str(ROOT / "tools/inspect_game.py"), "--game-dir", str(game)], check=True, cwd=ROOT)
    subprocess.run([sys.executable, "-B", str(ROOT / "tools/verify_world.py")], check=True, cwd=ROOT)
    subprocess.run([sys.executable, "-B", str(ROOT / "tools/prepare_gameplay.py"), "--game-dir", str(game)], check=True, cwd=ROOT)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME)
    extract(parser.parse_args().game_dir.resolve())
