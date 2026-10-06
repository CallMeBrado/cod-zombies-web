"""Reproducible T6 browser exporters for the local GPL-3.0 OpenAssetTools build.

Preserve the native packed world streams. prepare_bo2.py decodes them only after
checking their surface ranges; collision remains separate from render geometry.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.tools/oat-source/src/ObjWriting'
target = SOURCE / 'Game/T6/WebWorld'
target.mkdir(parents=True, exist_ok=True)
header = (SOURCE / 'Game/T5/WebWorld/WebWorldDumperT5.h').read_text().replace('T5', 'T6')
header = re.sub(r'    class SoundDumperT6.*?\n    };\n', '', header, flags=re.S)
header = header.replace('    class CollisionDumperT6', '''    class PathMpDumperT6 final : public AbstractAssetDumper<T6::AssetGameWorldMp>
    {
        void DumpAsset(AssetDumpingContext& context, const XAssetInfo<T6::GameWorldMp>& asset) override;
    };
    class CollisionDumperT6''')
(target / 'WebWorldDumperT6.h').write_text(header)
source = (SOURCE / 'Game/T5/WebWorld/WebWorldDumperT5.cpp').read_text().replace('T5', 'T6').replace('bo1-', 'bo2-')
source = source.replace('#include <set>', '#include <set>\n#include <map>')
source = source.replace('namespace web_world', '''namespace T6 {
    inline void to_json(json& j,const vec2_t& v){j=v.v;}
    inline void to_json(json& j,const vec3_t& v){j=v.v;}
    inline void to_json(json& j,const vec4_t& v){j=v.v;}
}
namespace web_world''', 1)
source = source.replace('texture.u.image', 'texture.image').replace('material->cameraRegion == CAMERA_REGION_EMISSIVE', '(material->cameraRegion>=CAMERA_REGION_EMISSIVE_OPAQUE && material->cameraRegion<=CAMERA_REGION_EMISSIVE_FX)')
source = source.replace('portal.plane.coeffs[', 'portal.plane.coeffs.v[')
start = source.index('    void SoundDumperT6::DumpAsset')
end = source.index('    void EffectDumperT6::DumpAsset', start)
source = source[:start] + source[end:]
path_start = source.index('    void PathDumperT6::DumpAsset')
path_end = source.index('    void CollisionDumperT6::DumpAsset', path_start)
source = source[:path_end] + source[path_start:path_end].replace('PathDumperT6', 'PathMpDumperT6').replace('GameWorldSp', 'GameWorldMp') + source[path_end:]
for field in ['numBrushes', 'brushes', 'leafbrushNodesCount', 'leafbrushNodes', 'numMaterials', 'materials']:
    source = source.replace('map->'+field, 'map->info.'+field)
source = source.replace('map->triIndices[triangle*3+j]', 'map->triIndices[triangle][j]')
# Submodels can carry their own ClipInfo. Flatten each unique info into the
# exported brush pool and map each leaf's local brush IDs to that pool.
start = source.index('        for (unsigned int i = 0; i < map->info.numBrushes; ++i)')
end = source.index('        // Only brushes referenced', start)
source = source[:start] + '''        std::map<const ClipInfo*,unsigned int> offsets;
        const auto appendInfo = [&](const ClipInfo* info) {
            if(!info || offsets.contains(info))return;
            offsets[info]=static_cast<unsigned int>(brushes.size());
            for(unsigned int i=0;i<info->numBrushes;++i){
                const auto& b=info->brushes[i];json planes=json::array();
                for(unsigned int j=0;j<b.numsides;++j){const auto* p=b.sides[j].plane;if(p)planes.push_back({p->normal.x,p->normal.y,p->normal.z,p->dist});}
                brushes.push_back({{"mins",b.mins},{"maxs",b.maxs},{"contents",b.contents},{"planes",planes}});
            }
        };
        appendInfo(&map->info);
        for(unsigned int i=0;i<map->numSubModels;++i)appendInfo(map->cmodels[i].info);
        std::function<void(const ClipInfo*,int,std::set<unsigned int>&)> visitInfo = [&](const ClipInfo* info,int index,std::set<unsigned int>& ids){
            if(!info || index<=0 || static_cast<unsigned int>(index)>=info->leafbrushNodesCount)return;
            const auto& node=info->leafbrushNodes[index];
            if(node.leafBrushCount>0){for(int j=0;j<node.leafBrushCount;++j)ids.insert(offsets.at(info)+node.data.leaf.brushes[j]);}
            else {if(node.leafBrushCount<0)visitInfo(info,index+1,ids);for(int j=0;j<2;++j)if(node.data.children.childOffset[j])visitInfo(info,index+node.data.children.childOffset[j],ids);}
        };
        const auto visit = [&](int index,std::set<unsigned int>& ids){visitInfo(&map->info,index,ids);};
''' + source[end:]
source = source.replace('visit(m.leaf.leafBrushNode, ids);', 'visitInfo(m.info?m.info:&map->info,m.leaf.leafBrushNode,ids);')
start = source.index('        // Explicit 32-byte records:')
end = source.index('        indexFile->write', start)
source = source[:start] + '''        vertexFile->write(reinterpret_cast<const char*>(world->draw.vd0.data),world->draw.vertexDataSize0);
        auto stream1=context.OpenAssetFile(prefix+".stream1.bin");
        if(stream1)stream1->write(reinterpret_cast<const char*>(world->draw.vd1.data),world->draw.vertexDataSize1);
''' + source[end:]
source = source.replace('{"vertexStride", 32}', '{"vertexStride", 0}, {"stream0Size",world->draw.vertexDataSize0}, {"stream1Size",world->draw.vertexDataSize1}, {"stream1",stem+".stream1.bin"}')
source = source.replace('{"firstVertex", surface.tris.firstVertex}', '{"stream0Offset",surface.tris.vertexDataOffset0}, {"stream1Offset",surface.tris.vertexDataOffset1}, {"bounds",surface.bounds}, {"flags",static_cast<unsigned char>(surface.flags)}, {"firstVertex", surface.tris.firstVertex}')
start = source.index('                if(materialName==')
end = source.index('\n            }\n        }\n        for (unsigned int', start)
source = source[:start] + '''                // Vertex stream routing is exported for decoder diagnostics.
                if(material && material->techniqueSet){
                    json declarations=json::array();
                    for(const auto* technique:material->techniqueSet->techniques){
                        if(!technique)continue;
                        for(int p=0;p<technique->passCount;++p){
                            const auto* decl=technique->passArray[p].vertexDecl;if(!decl)continue;
                            json routes=json::array();for(int k=0;k<decl->streamCount;++k)routes.push_back({decl->routing.data[k].source,decl->routing.data[k].dest});
                            declarations.push_back({{"technique",technique->name},{"routes",routes}});
                        }
                    }
                    manifest["materials"][materialName]["declarations"]=declarations;
                }
''' + source[end:]
source = source.replace('{"groundLighting", world->dpvs.smodelInsts[i].groundLighting.array}', '{"lightingOrigin",world->dpvs.smodelInsts[i].lightingOrigin}, {"lightingSH",{instance.lightingSH.V0,instance.lightingSH.V1,instance.lightingSH.V2}}')
source = source.replace('{{"primary",lm.primary},{"secondary",lm.secondary},{"secondaryB",lm.secondaryB}}', '{{"primary",lm.primary},{"secondary",lm.secondary}}')
# Keep embedded lightmaps and native per-model vertex colors rather than
# replacing BO2's authored lighting with white ambient light.
source = source.replace('            manifest["staticModels"].push_back({', '''            json vertexColors=json::array();
            for(int lod=0;lod<4;++lod){const auto& colors=instance.lmapVertexInfo[lod];json row=json::array();for(int v=0;colors.lmapVertexColors&&v<colors.numLmapVertexColors;++v)row.push_back(colors.lmapVertexColors[v]);vertexColors.push_back(row);}
            manifest["staticModels"].push_back({{"vertexColors",vertexColors},''')
(target / 'WebWorldDumperT6.cpp').write_text(source)
writer = SOURCE / 'Game/T6/ObjWriterT6.cpp'
text = writer.read_text()
if 'WebWorldDumperT6.h' not in text:
    text = text.replace('#include "ObjWriterT6.h"', '#include "ObjWriterT6.h"\n#include "Game/T6/WebWorld/WebWorldDumperT6.h"')
    for old, new in [('AssetDumperClipMap, m_clip_map','Collision'),('AssetDumperComWorld, m_com_world','Light'),('AssetDumperGameWorldSp, m_game_world_sp','Path'),('AssetDumperGameWorldMp, m_game_world_mp','PathMp'),('AssetDumperGfxWorld, m_gfx_world',''),('AssetDumperFxEffectDef, m_fx','Effect')]:
        text = text.replace('// REGISTER_DUMPER('+old+')','RegisterAssetDumper(std::make_unique<web_world::'+new+'DumperT6>());')
    writer.write_text(text)
template = SOURCE / 'XAnim/XAnimDumper.cpp.template'
text = template.read_text().replace('#if defined(FEATURE_T4) || defined(FEATURE_T5)\n','#if defined(FEATURE_T4) || defined(FEATURE_T5) || defined(FEATURE_T6)\n')
text=text.replace('webName.find("pb_") == 0;', 'webName.find("pb_") == 0 || webName.find("o_zombie_") == 0 || webName.find("o_zmb_") == 0;')
text=text.replace('webName.find("o_zombie_") == 0;', 'webName.find("o_zombie_") == 0 || webName.find("o_zmb_") == 0;')
template.write_text(text)
loader = ROOT / '.tools/oat-source/src/ObjLoading/Game/T6/ObjLoaderT6.cpp'
text = loader.read_text()
text=text.replace('if (sndBank.runtimeAssetLoad && sndBank.loadAssetBank.zone)', 'if (sndBank.loadAssetBank.zone)')
if 'Local browser export: common sound banks' not in text:
    text=text.replace('        std::set<std::string> loadedSoundBanksForZone;', '''        // Local browser export: common sound banks have no load-zone link
        // in the DLC fastfile but own its shared gun/grenade samples.
        if(zone.m_name.find("buried")!=std::string::npos){
            LoadSoundBankForZone(searchPath,"zmb_common.all.sabs",zone);
            LoadSoundBankForZone(searchPath,"zmb_common.all.sabl",zone);
            LoadSoundBankForZone(searchPath,"zmb_common.english.sabs",zone);
            LoadSoundBankForZone(searchPath,"zmb_common.english.sabl",zone);
        }
        std::set<std::string> loadedSoundBanksForZone;''')
if 'Local browser export: Buried' not in text:
    text = text.replace('        LoadCommonIPaks(searchPath, zone);','''        LoadCommonIPaks(searchPath, zone);
        // Local browser export: Buried's shipping DLC textures live in dlczm3,
        // while the fastfile references the multiplayer dlc3 package.
        if(zone.m_name.find("buried")!=std::string::npos)LoadIPakForZone(searchPath,"dlczm3",zone);
        LoadIPakForZone(searchPath,"patch_zm",zone);''')
loader.write_text(text)
text=loader.read_text()
if 'LoadSoundBankForZone(searchPath,"cmn_root.all.sabs"' not in text:
    text=text.replace('LoadSoundBankForZone(searchPath,"zmb_common.all.sabs",zone);', 'LoadSoundBankForZone(searchPath,"cmn_root.all.sabs",zone);\n            LoadSoundBankForZone(searchPath,"cmn_root.english.sabs",zone);\n            LoadSoundBankForZone(searchPath,"zmb_common.all.sabs",zone);')
    loader.write_text(text)
text=loader.read_text()
if 'LoadSoundBankForZone(searchPath,"cmn_root.all.sabl"' not in text:
    loader.write_text(text.replace('LoadSoundBankForZone(searchPath,"cmn_root.all.sabs",zone);','LoadSoundBankForZone(searchPath,"cmn_root.all.sabs",zone);\n            LoadSoundBankForZone(searchPath,"cmn_root.all.sabl",zone);'))
print('Installed T6 native packed-world, collision, path, lighting, FX and animation exporters.')
sound=SOURCE/'Game/T6/Sound/SndBankDumperT6.cpp'
text=sound.read_text()
if 'stream.WriteColumn("AssetId")' not in text:
    text=text.replace('    void WriteAliasFileHeader(CsvOutputStream& stream)\n    {','    void WriteAliasFileHeader(CsvOutputStream& stream)\n    {\n        stream.WriteColumn("AssetId");')
    text=text.replace('                WriteAliasToFile(csvStream, alias, maybeFormat, hashes);','                csvStream.WriteColumn(std::format("{:08x}",alias.assetId));\n                WriteAliasToFile(csvStream, alias, maybeFormat, hashes);')
    sound.write_text(text)
