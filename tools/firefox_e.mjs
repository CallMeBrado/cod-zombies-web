// Optional Firefox profile for this game: profile and browser disk cache stay on E:.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const candidates=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(p=>path.join(p,'Mozilla Firefox/firefox.exe'));
const firefox=candidates.find(existsSync);if(!firefox)throw new Error('Firefox is not installed in its standard location.');
const started=spawnSync(process.execPath,[path.join(root,'tools/play.mjs'),'--no-browser'],{cwd:root,stdio:'inherit',windowsHide:true});
if(started.status!==0)process.exit(started.status||1);
const profile=path.join(root,'.cache/firefox-profile'),cache=path.join(root,'.cache/firefox-cache');
mkdirSync(profile,{recursive:true});mkdirSync(cache,{recursive:true});
writeFileSync(path.join(profile,'user.js'),`user_pref("browser.cache.disk.parent_directory", ${JSON.stringify(cache)});\nuser_pref("browser.shell.checkDefaultBrowser", false);\n`);
const browser=spawn(firefox,['-no-remote','-profile',profile,'http://127.0.0.1:8789/'],{detached:true,stdio:'ignore',windowsHide:true});browser.unref();
