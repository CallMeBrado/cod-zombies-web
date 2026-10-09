"""Preserve T6 script-spawned XModel collision in the private native export."""
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[1]
path = ROOT/'.tools/oat-source/src/ObjWriting/XModel/XModelDumper.cpp.template'
source = path.read_text()
changed = False
marker = '        // Browser T6 native model collision (Town Survival boundary).'
if marker not in source:
    block = '''#ifdef FEATURE_T6
        // Browser T6 native model collision (Town Survival boundary).
        nlohmann::json surfaces = nlohmann::json::array();
        for (int i = 0; i < model.numCollSurfs; ++i)
        {
            const auto& c = model.collSurfs[i];
            nlohmann::json triangles = nlohmann::json::array();
            for (int k = 0; k < c.numCollTris; ++k)
            {
                const auto& t = c.collTris[k];
                triangles.push_back({t.plane.v, t.svec.v, t.tvec.v});
            }
            surfaces.push_back({{"mins", c.mins.v}, {"maxs", c.maxs.v}, {"contents", c.contents}, {"triangles", triangles}});
        }
        nlohmann::json geoms = nlohmann::json::array();
        for (int i = 0; i < model.numCollmaps; ++i)
        {
            const auto* list = model.collmaps[i].geomList;
            if (!list) continue;
            for (unsigned int j = 0; j < list->count; ++j)
            {
                const auto& g = list->geoms[j];
                nlohmann::json row = {{"type", g.type}, {"contents", list->contents}, {"offset", g.offset.v}, {"halfLengths", g.halfLengths.v}, {"axis", {g.orientation[0].v, g.orientation[1].v, g.orientation[2].v}}};
                if (g.brush)
                {
                    const auto& b = *g.brush;
                    nlohmann::json planes = nlohmann::json::array();
                    for (unsigned int k = 0; k < b.numsides; ++k)
                    {
                        const auto* p = b.sides[k].plane;
                        if (p) planes.push_back({p->normal.v[0], p->normal.v[1], p->normal.v[2], p->dist});
                    }
                    row["brush"] = {{"mins", b.mins.v}, {"maxs", b.maxs.v}, {"contents", b.contents}, {"planes", planes}};
                }
                geoms.push_back(row);
            }
        }
        jRoot["nativeCollision"] = {{"mins", model.mins.v}, {"maxs", model.maxs.v}, {"contents", model.contents}, {"surfaces", surfaces}, {"geoms", geoms}};
#endif

'''
    needle = '        *assetFile << std::setw(4) << jRoot << "\\n";'
    assert needle in source
    path.write_text(source.replace(needle, block+needle))
    changed = True
loader = ROOT/'.tools/oat-source/src/ObjLoading/Game/T6/ObjLoaderT6.cpp'
source = loader.read_text()
old = 'if(zone.m_name.find("buried")!=std::string::npos){'
new = 'if(zone.m_name.find("buried")!=std::string::npos || zone.m_name.find("transit")!=std::string::npos){'
if old in source:
    loader.write_text(source.replace(old, new))
    changed = True
if changed:
    subprocess.run(['powershell','-NoProfile','-File',str(ROOT/'tools/build_exporter.ps1')],cwd=ROOT,check=True)
