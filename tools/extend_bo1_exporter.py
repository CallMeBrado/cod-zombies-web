"""Install the T5 browser export extension beside the existing T4 extension.

The extension uses OpenAssetTools' GPL-3.0 source and is reproducible from the
existing T4 patch. Run before tools/build_exporter.ps1.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.tools/oat-source/src/ObjWriting'
target = SOURCE / 'Game/T5/WebWorld'
target.mkdir(parents=True, exist_ok=True)
header = (SOURCE / 'Game/T4/WebWorld/WebWorldDumperT4.h').read_text().replace('T4', 'T5')
header = header.replace('T5::AssetSound>', 'T5::AssetSoundBank>').replace('T5::snd_alias_list_t>', 'T5::SndBank>')
(target / 'WebWorldDumperT5.h').write_text(header)
source = (SOURCE / 'Game/T4/WebWorld/WebWorldDumperT4.cpp').read_text().replace('T4', 'T5')
for field in ['vertexCount', 'indexCount', 'vd', 'indices', 'lightmapCount', 'lightmaps']:
    source = source.replace('world->' + field, 'world->draw.' + field)
source = source.replace('j<partition.triCount', 'j<static_cast<unsigned char>(partition.triCount)')
source = source.replace('p->normal[0],p->normal[1],p->normal[2]', 'p->normal.x,p->normal.y,p->normal.z')
source = source.replace('e.atlas.entryCount}', '(e.atlas.entryCountAndIndexRange & 511)}')
source = source.replace('waw-paths-v1', 'bo1-paths-v1').replace('waw-web-world-v1', 'bo1-web-world-v1')
source = source.replace('        *manifestFile << manifest.dump();', '''        manifest["nativeLightmaps"]=json::array();
        for(int i=0;i<world->draw.lightmapCount;++i) {
            json row=json::object();
            const auto& lm=world->draw.lightmaps[i];
            for(const auto& [key,img]:std::initializer_list<std::pair<const char*,GfxImage*>>{{"primary",lm.primary},{"secondary",lm.secondary},{"secondaryB",lm.secondaryB}}) {
                if(!img)continue;
                const auto* def=img->texture.loadDef;
                const auto size=def&&def->resourceSize>0?def->resourceSize:img->loadedSize;
                const auto* bytes=def&&def->resourceSize>0?def->data:img->pixels;
                const auto path=stem+".lightmap"+std::to_string(i)+"."+key+".bin";
                row[key]={{"width",img->width},{"height",img->height},{"format",def?def->format:0},{"size",size},{"file",path},{"name",img->name}};
                if(bytes&&size>0) {auto out=context.OpenAssetFile("web-world/"+path);if(out)out->write(bytes,size);}
            }
            manifest["nativeLightmaps"].push_back(row);
        }
        *manifestFile << manifest.dump();''')
start = source.index('                if (materialName == "wc/peleliu_wall_concrete_bunker_chipped"')
end = source.index('\n            }\n        }\n        for (unsigned int', start)
source = source[:start] + '''                if(materialName=="wc/eb_art_wall_plaster_dirty" && material->techniqueSet) {
                    for(const auto* technique:material->techniqueSet->techniques) {
                        if(!technique)continue;
                        for(int p=0;p<technique->passCount;++p) {
                            const auto* ps=technique->passArray[p].pixelShader;
                            if(!ps||!ps->prog.loadDef.program)continue;
                            auto file=context.OpenAssetFile("web-shaders/"+std::string(ps->name)+".cso");
                            if(file)file->write(reinterpret_cast<const char*>(ps->prog.loadDef.program),ps->prog.loadDef.programSize*4);
                        }
                    }
                }
''' + source[end:]
start = source.index('    void SoundDumperT5::DumpAsset')
end = source.index('    void EffectDumperT5::DumpAsset', start)
source = source[:start] + '''    void SoundDumperT5::DumpAsset(AssetDumpingContext& context, const XAssetInfo<SndBank>& asset)
    {
        const auto* bank = asset.Asset();
        for(unsigned int index=0; index<bank->aliasCount; ++index) {
            const auto& list=bank->alias[index]; if(!list.name)continue;
            json entries=json::array();
            for(int i=0; i<list.count; ++i) {
                const auto& a=list.head[i]; const auto* sf=a.soundFile;
                if(!sf)continue;
                std::string filename;
                if(sf->type==SAT_LOADED && sf->u.loadSnd && sf->u.loadSnd->name) {
                    filename=sf->u.loadSnd->name;
                    const auto& s=sf->u.loadSnd->sound;
                    if(s.data && s.data_size) {
                        auto raw=context.OpenAssetFile("web-audio/"+filename+".bin");
                        if(raw)raw->write(reinterpret_cast<const char*>(s.data),s.data_size);
                        auto meta=context.OpenAssetFile("web-audio/"+filename+".json");
                        if(meta)*meta<<json({{"format",s.format},{"rate",s.frame_rate},{"channels",s.channel_count},
                            {"frames",s.frame_count},{"blockSize",s.block_size},{"headerSize",s.header_size}}).dump();
                    }
                } else if((sf->type==SAT_STREAMED || sf->type==SAT_PRIMED) && sf->u.streamSnd && sf->u.streamSnd->filename)
                    filename=sf->u.streamSnd->filename;
                if(!filename.empty())entries.push_back({{"file",filename},{"volume",a.volMax/65535.0},{"pitch",a.pitchMax/32768.0}});
            }
            auto file=context.OpenAssetFile("web-sounds/"+std::string(list.name)+".json");
            if(file)*file<<entries.dump();
        }
    }

''' + source[end:]
(target / 'WebWorldDumperT5.cpp').write_text(source)
writer = SOURCE / 'Game/T5/ObjWriterT5.cpp'
text = writer.read_text()
if 'WebWorldDumperT5.h' not in text:
    text = text.replace('#include "ObjWriterT5.h"', '#include "ObjWriterT5.h"\n#include "Game/T5/WebWorld/WebWorldDumperT5.h"')
    for old, new in [('AssetDumperSndBank, m_sound_bank', 'Sound'), ('AssetDumperClipMap, m_clip_map', 'Collision'),
                     ('AssetDumperComWorld, m_com_world', 'Light'), ('AssetDumperGameWorldSp, m_game_world_sp', 'Path'),
                     ('AssetDumperGfxWorld, m_gfx_world', ''), ('AssetDumperFxEffectDef, m_fx', 'Effect')]:
        text = text.replace('// REGISTER_DUMPER('+old+')', 'RegisterAssetDumper(std::make_unique<web_world::'+new+'DumperT5>());' if new else 'RegisterAssetDumper(std::make_unique<web_world::DumperT5>());')
    writer.write_text(text)
template = SOURCE / 'XAnim/XAnimDumper.cpp.template'
text = template.read_text().replace('#if defined(FEATURE_T4)\n', '#if defined(FEATURE_T4) || defined(FEATURE_T5)\n')
template.write_text(text)
print('Installed T5 browser world, collision, path, light, sound and animation exporters.')
