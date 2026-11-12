import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const caf = `(() => {
 const callbacks = [], audio = () => window.castAudio;
 const player = {
   setMediaElement() {}, addEventListener(types, callback) { callbacks.push({types: Array.isArray(types) ? types : [types], callback}) },
   getMediaInformation: () => ({ metadata: { title:'Receiver regression',artist:'Lokal',images:[{url:'/cover.svg'}] }, customData:{trackId:window.receiverTrack||'track-1'},duration:30 }),
   getPlayerState: () => audio()?.ended ? 'IDLE' : audio()?.paused ? 'PAUSED' : 'PLAYING',
   getDurationSec: () => audio()?.duration || 30,
 };
 const context = {
   getPlayerManager: () => player, sendCustomMessage(_, __, value) { window.sent.push(value) },
   addCustomMessageListener(_, fn) { window.receiverMessage = data => fn({data}) }, addEventListener() {},
   start(options) {
     window.receiverOptions = options;
     // CAF startup's documented fallback is the first media element. A muted
     // visual video must never become the song's transport.
     window.castAudio = options.mediaElement || document.querySelector('.castMediaElement') || document.querySelector('audio,video');
     castAudio.src='/tone.wav';
     for (const name of ['loadedmetadata','playing','pause','timeupdate','waiting','seeked','ended']) castAudio.addEventListener(name, () => callbacks.filter(entry => entry.types.includes(name)).forEach(entry => entry.callback()));
     castAudio.play();
   },
 };
 window.sent=[];
 window.cast={framework:{CastReceiverContext:{getInstance:()=>context},CastReceiverOptions:class {},
   events:{EventType:{PLAYER_LOAD_COMPLETE:'loadedmetadata',PLAYING:'playing',PAUSE:'pause',BUFFERING:'waiting',SEEKED:'seeked',MEDIA_STATUS:'timeupdate',ENDED:'ended',MEDIA_FINISHED:'mediafinished'}},system:{EventType:{SENDER_CONNECTED:'connected'},MessageType:{JSON:'json'}},
   messages:{Command:{ALL_BASIC_MEDIA:1,QUEUE_NEXT:2,QUEUE_PREV:4}},
 }};
})();`
function tone() {
 const samples=8000*30, wav=Buffer.alloc(44+samples*2);
 wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);
 wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
 wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/8000)*10000),44+i*2);
 return wav;
}

for (const failScriptOnce of [false, true]) {
test(failScriptOnce ? 'receiver retries video loading after a transient API failure' : 'receiver binds audible audio, paints art, and switches lyrics/video without muting the recording', async t => {
 const server=createServer(async(req,res)=>{
   if(req.url==='/tone.wav'){res.writeHead(200,{'Content-Type':'audio/wav'});res.end(tone());return}
   if(req.url==='/cover.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#503981"/><circle cx="250" cy="250" r="140" fill="#f0bc85"/></svg>');return}
   const name=req.url==='/'?'index.html':req.url.slice(1);
   if(!['index.html','receiver.css','receiver.js'].includes(name)){res.writeHead(404);res.end();return}
   res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
   res.end(await readFile(new URL('../receiver/'+name,import.meta.url)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || undefined,
   ignoreDefaultArgs:['--mute-audio'], args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1920,height:1080}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://www.gstatic.com/cast/sdk/**',route=>route.fulfill({body:caf,contentType:'text/javascript'}));
 let youtubeRequests = 0;
 await page.route('https://www.youtube.com/iframe_api',route=>(++youtubeRequests === 1 && failScriptOnce) ? route.abort() : route.fulfill({contentType:'text/javascript',body:`window.YT={Player:class {constructor(mount,options){this.time=0;this.state=2;this.muted=false;mount.appendChild(document.createElement('iframe'));window.videoPlayer=this;setTimeout(()=>options.events.onReady({target:this}),0)}mute(){this.muted=true}getCurrentTime(){return this.time}seekTo(t){this.time=t}getPlayerState(){return this.state}playVideo(){this.state=1}pauseVideo(){this.state=2}destroy(){}}};window.onYouTubeIframeAPIReady();`}));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.castAudio?.currentTime>0.2);
 assert.equal(await page.evaluate(()=>castAudio.id),'audio');
 assert.equal(await page.evaluate(()=>receiverOptions.mediaElement===document.getElementById('audio')),true);
 assert.equal(await page.evaluate(()=>castAudio.muted),false);
 await page.waitForFunction(()=>document.getElementById('cover').classList.contains('on'));
 const rms=await page.evaluate(async()=>{
   const context=new AudioContext();await context.resume();const source=context.createMediaElementSource(castAudio);const analyser=context.createAnalyser();source.connect(analyser);analyser.connect(context.destination);
   await new Promise(r=>setTimeout(r,250));const values=new Float32Array(2048);analyser.getFloatTimeDomainData(values);
   return Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length);
 });assert.ok(rms>0.05,'decoded audio output must be non-silent: '+rms);
 await page.evaluate(()=>receiverMessage({type:'lyrics',trackId:'track-1',synced:true,lines:[{t:0,text:'First lyric'},{t:15,text:'Second lyric'}]}));
 await page.evaluate(()=>receiverMessage(JSON.stringify({type:'view',view:'lyrics'})));
 await page.waitForFunction(()=>document.body.dataset.view==='lyrics');
 assert.equal(await page.locator('#lines .line').first().textContent(),'First lyric');
 await page.evaluate(()=>receiverMessage({type:'lyrics',trackId:'retired-track',synced:false,lines:[{text:'Stale lyric'}]}));
 assert.equal(await page.locator('#lines .line').first().textContent(),'First lyric');
 await page.evaluate(()=>receiverMessage(JSON.stringify({type:'view',view:'video'})));
 assert.equal(await page.getByRole('button',{name:'Video',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Video',exact:true}).click();
 await page.evaluate(()=>receiverMessage({type:'video',trackId:'track-1',videoId:'abcdefghijk',segments:[]}));
 if(failScriptOnce){
   await page.waitForFunction(()=>document.getElementById('view-status').textContent==='Video unavailable');
   await page.getByRole('button',{name:'Cover',exact:true}).click();
   await page.getByRole('button',{name:'Video',exact:true}).click();
   await page.evaluate(()=>receiverMessage({type:'video',trackId:'track-1',videoId:'abcdefghijk',segments:[]}));
 }
 await page.waitForFunction(()=>document.body.dataset.view==='video');
 await page.waitForFunction(()=>window.videoPlayer?.state===1);
 assert.equal(youtubeRequests, failScriptOnce ? 2 : 1);
 await page.evaluate(()=>{window.currentVideo=videoPlayer;receiverMessage({type:'video',trackId:'retired-track',videoId:'another_vid'});});
 await page.evaluate(()=>document.getElementById('video').dispatchEvent(new Event('error')));
 assert.equal(await page.evaluate(()=>document.body.dataset.view),'video');
 assert.equal(await page.evaluate(()=>currentVideo===videoPlayer),true);
 assert.equal(await page.evaluate(()=>videoPlayer.muted),true);
 assert.equal(await page.evaluate(()=>castAudio.muted),false);
 assert.ok(await page.evaluate(()=>castAudio.currentTime)>0.4);
 await page.evaluate(()=>{videoPlayer.state=3});
 await page.getByRole('button',{name:'Cover',exact:true}).click();
 await page.waitForFunction(()=>videoPlayer.state===2);
 await page.waitForFunction(()=>document.body.dataset.view==='now');
 // A released older sender sends B while CAF still reports A, with no
 // post-load resend. Retain B, but keep A's lyrics/video until the load.
 await page.evaluate(()=>{
  window.previousVideo=videoPlayer;
  receiverMessage({type:'lyrics',trackId:'track-2',synced:true,lines:[{t:0,text:'Next recording'}]});
  receiverMessage({type:'video',trackId:'track-2',videoId:'zyxwvutsrqp'});
 });
 assert.equal(await page.locator('#lines .line').first().textContent(),'First lyric');
 assert.equal(await page.evaluate(()=>previousVideo===videoPlayer),true);
 await page.evaluate(()=>{window.receiverTrack='track-2';castAudio.dispatchEvent(new Event('loadedmetadata'));receiverMessage({type:'view',view:'lyrics'})});
 await page.waitForFunction(()=>document.getElementById('lines').textContent==='Next recording');
 await page.evaluate(()=>receiverMessage({type:'view',view:'video'}));
 await page.waitForFunction(()=>videoPlayer!==previousVideo && document.body.dataset.view==='video');
 assert.ok(await page.evaluate(()=>sent.some(message=>message.type==='view'&&message.view==='video')));
 assert.deepEqual(errors,[]);
});

}
