// Exercise the actual React Cast hook and stores. The native bridge is a
// controlled seam; receiver decoding is covered by cast-receiver-browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
const { chromium } = createRequire(import.meta.url)('playwright')

const entry = `
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useCastPlayback } from './src/cast/useCastPlayback.js';
import { useCastStore } from './src/cast/castStore.js';
import { usePlayerStore } from './src/store/player.js';
function Harness() {
 useCastPlayback({});
 useEffect(() => { window.castStore=useCastStore; window.playerStore=usePlayerStore; window.hookReady=true }, []);
 return React.createElement('div', null, ...['nowplaying','lyrics','video'].map(view =>
  React.createElement('button',{key:view,onClick:()=>useCastStore.getState().setTvView(view)},view)));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`
const virtual = `${process.cwd()}/__cast_harness_entry.jsx`
const bundled = await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},plugins:[{
 name:'cast-harness',resolveId(id){if(id===virtual)return id},load(id){if(id===virtual)return entry},
},react()],build:{write:false,minify:false,lib:{entry:virtual,formats:['iife'],name:'CastHarness'},emptyOutDir:false}})
const output = (Array.isArray(bundled) ? bundled[0] : bundled).output.find(item=>item.type==='chunk').code


for (const preferred of ['lyrics', 'video']) test(`receiver ${preferred} survives messages sent before LOAD completes`, async t => {
 const server = createServer((req,res) => {
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(output)}
  else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>')}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});t.after(()=>browser.close());
 const page=await browser.newPage();page.setDefaultTimeout(4000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({preferred})=>{
  localStorage.setItem('lokal-cast-view',preferred);window.nativeCalls=[];window.receiverReady=false;
  const noop=()=>()=>{};
  window.electron={isElectron:true,
   castDevices:async()=>[],castStatus:async()=>({state:'idle'}),
   castConnect:async()=>({joined:false,status:{state:'connected',receiver:'lokal',device:{id:'tv',name:'TV'},playerState:'PAUSED'}}),
   castSetWindow:()=>new Promise(resolve=>{window.completeLoad=()=>{window.receiverReady=true;resolve({ok:true})}}),
   castCustom:async data=>{window.nativeCalls.push({data,accepted:window.receiverReady});return window.receiverReady},
   castUpNext:async()=>true,
   castVideo:async data=>{window.nativeCalls.push({data:{type:'video',...data},accepted:window.receiverReady});return {found:true}},
   getLyrics:async()=>{
    window.lyricsLookups=(window.lyricsLookups||0)+1;
    if(window.lyricsLookups>1)return null;
    if(!window.lyricsReleased)await new Promise(resolve=>{window.releaseLyrics=()=>{window.lyricsReleased=true;resolve()}});
    return {type:'synced',lines:[{time:0,text:'Actual lyric'}]};
   },
   musicVideo:async()=>({videoId:'abcdefghijk'}),
   onCastDevices:noop,onCastStatus:noop,onCastEnded:noop,onCastFinished:noop,onCastTrackError:noop,onCastCustom:noop,
  };
 },{preferred});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.hookReady).catch(error=>{throw new Error(JSON.stringify(errors)+' '+error.message)});
 await page.evaluate(async()=>{
  const track={id:'pc-track',title:'Fixture',artist:'Artist',duration:180,file_path:'/music/fixture.flac'};
  playerStore.setState({currentTrack:track,queue:[track],queueIndex:0,isPlaying:true});
  await castStore.getState().connect('tv');
 });
 await page.waitForFunction(()=>window.completeLoad);
 await page.evaluate(()=>completeLoad());
 await page.waitForFunction(view=>nativeCalls.some(c=>c.accepted && c.data.type==='view' && c.data.view===view),preferred);
 // The pre-load lookup is still pending. A resend shares that work instead
 // of racing a second provider request against the successful first result.
 assert.equal(await page.evaluate(()=>lyricsLookups),1);
 await page.evaluate(()=>releaseLyrics());
 await page.waitForFunction(view=>nativeCalls.some(c=>c.accepted && c.data.type===view && c.data.trackId==='pc-track'),preferred);
 // Switching away and back must resend the chosen content, even if its first
 // send was dropped while the native receiver was loading.
 await page.getByRole('button',{name:'nowplaying',exact:true}).click();
 const before=await page.evaluate(()=>nativeCalls.length);
 await page.getByRole('button',{name:preferred,exact:true}).click();
 await page.waitForFunction(({view,before})=>nativeCalls.slice(before).some(c=>c.accepted && c.data.type===view && c.data.trackId==='pc-track'),{view:preferred,before});
 if(preferred==='lyrics') {
  assert.equal(await page.evaluate(()=>lyricsLookups),1);
  assert.equal(await page.evaluate(()=>nativeCalls.filter(c=>c.accepted && c.data.type==='lyrics').at(-1).data.lines[0].text),'Actual lyric');
 }
 assert.deepEqual(errors,[]);
});
