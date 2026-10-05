"""Validate the actual exported Nacht buffers and original asset dependencies."""
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / "local-data/nacht/web-world"
manifest = json.loads((folder / "nazi_zombie_prototype.json").read_text(encoding="utf-8"))
assert manifest["format"] == "waw-web-world-v1"
vertices = (folder / manifest["vertices"]).read_bytes()
index_bytes = (folder / manifest["indices"]).read_bytes()
assert len(vertices) == manifest["vertexCount"] * 32, "Vertex buffer has wrong size"
assert len(index_bytes) == manifest["indexCount"] * 2, "Index buffer has wrong size"
indices = struct.unpack(f"<{manifest['indexCount']}H", index_bytes)
for i in range(manifest["vertexCount"]):
    values = struct.unpack_from("<7f", vertices, i * 32)
    assert all(math.isfinite(value) for value in values), f"Non-finite vertex {i}"
    for axis in range(3):
        assert manifest["bounds"][0][axis] - 1 <= values[axis] <= manifest["bounds"][1][axis] + 1, f"Vertex outside world bounds: {i}"
for surface in manifest["surfaces"]:
    count = surface["triangleCount"] * 3
    first = surface["baseIndex"]
    assert 0 <= first <= first + count <= manifest["indexCount"]
    assert 0 <= surface["firstVertex"] <= surface["firstVertex"] + surface["vertexCount"] <= manifest["vertexCount"]
    assert all(index < surface["vertexCount"] for index in indices[first:first + count]), "Index must be relative to its surface"


def available(relative):
    return any((ROOT / "local-data" / zone / relative).is_file() for zone in ["nacht", "common"])


unique_models = sorted({instance["model"] for instance in manifest["staticModels"]})
missing_models = [name for name in unique_models if not available(f"model_export/{name}_lod0.glb")]
unique_textures = sorted({material["diffuse"].lstrip(",") for material in manifest["materials"].values() if material["diffuse"]})
missing_textures = [name for name in unique_textures if not available(f"images/{name}.dds")]
assert not missing_models, f"Missing original static models: {missing_models}"
assert not missing_textures, f"Missing original map textures: {missing_textures}"
for lightmap in manifest['lightmaps']:
    for name in lightmap.values():
        assert available('images/'+name.replace('*','_')+'.dds'), f'Missing baked lightmap: {name}'
lights = json.loads((folder/'nazi_zombie_prototype.lights.json').read_text())
assert all(0 <= s['primaryLight'] < len(lights) for s in manifest['surfaces'])
report = {"vertices": manifest["vertexCount"], "triangles": sum(surface["triangleCount"] for surface in manifest["surfaces"]),
          "surfaces": len(manifest["surfaces"]), "staticModelPlacements": len(manifest["staticModels"]),
          "uniqueStaticModels": len(unique_models), "uniqueMapTextures": len(unique_textures),
          "bakedLightmaps":len(manifest['lightmaps']),"primaryLights":len(lights),
          "allBuffersValid": True, "allMapDependenciesAvailable": True,
          "verificationScope": "Geometry and asset dependencies; gameplay checked separately by npm test."}
(ROOT / "local-data/world-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
