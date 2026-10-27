import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eligibleStemTransition } from '../src/audio/stemPlayback.js'
import { defaultStemClipPath } from './automix-transition-clip.mjs'

const require=createRequire(import.meta.url)
const { stemClipPath, loadPreparedStemClip } =
  require('../electron/automix/stem-clip.js')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')

const plan={kind:'beatmatch',start:166.1,length:16,inOffset:7.9}
const clip={audio:Uint8Array.from({length:256},(_,i)=>i%256),
  outStart:166.4,inStart:8,resumeIn:24,durationSeconds:16,masterGain:.9}

test('only source-aligned, native-speed stem windows may substitute for AutoMix',()=>{
  assert.equal(eligibleStemTransition(clip,plan),true)
  assert.equal(eligibleStemTransition(clip,plan,1.25),false)
  assert.equal(eligibleStemTransition({...clip,outStart:160},plan),false)
  assert.equal(eligibleStemTransition({...clip,resumeIn:5},plan),false)
  assert.equal(eligibleStemTransition({...clip,durationSeconds:30},plan),false)
  assert.equal(eligibleStemTransition(null,plan),false)
  assert.equal(eligibleStemTransition(clip,{...plan,kind:'smart'}),false)
})

test('Electron loads only fingerprinted local prepared pairs', async t=>{
  const dir=mkdtempSync(join(tmpdir(),'lokal-stem-pair-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const outFile=join(dir,'out.mp3'),inFile=join(dir,'in.mp3')
  const a=Buffer.from('original outgoing audio bytes')
  const b=Buffer.from('original incoming audio bytes')
  writeFileSync(outFile,a)
  writeFileSync(inFile,b)
  const out={file_path:outFile},incoming={file_path:inFile}
  const output=defaultStemClipPath(outFile,inFile)
  assert.equal(stemClipPath(out,incoming),output)
  const wav=Buffer.alloc(256,0)
  wav.write('RIFF',0)
  wav.write('WAVE',8)
  writeFileSync(output,wav)
  const manifest={
    schema:'lokal-automix-stem-clip-v1',
    source:{outgoingSha256:sha(a),incomingSha256:sha(b)},
    clip:{sha256:sha(wav),bytes:wav.length},
    timeline:{outStart:166.4,inStart:8,resumeIn:24,length:16,masterGain:.9},
  }
  writeFileSync(output+'.json',JSON.stringify(manifest))
  const loaded=await loadPreparedStemClip(out,incoming)
  assert.equal(loaded.durationSeconds,16)
  assert.equal(loaded.resumeIn,24)
  assert.equal(loaded.audio.length,256)
  assert.equal(await loadPreparedStemClip({...out,file_path:'https://example.com/a.mp3'},incoming),null)
  assert.equal(await loadPreparedStemClip({...out,start_offset_ms:100},incoming),null)
  assert.equal(await loadPreparedStemClip(out,{...incoming,file_path:outFile}),null)
  // The same *file path* with new audio bytes cannot reuse the old window.
  writeFileSync(inFile,Buffer.from('changed incoming audio'))
  assert.equal(await loadPreparedStemClip(out,incoming),null)
})

test('a forged clip with wrong source revision fails closed',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'lokal-stem-forged-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const outFile=join(dir,'a.flac'),inFile=join(dir,'b.flac')
  writeFileSync(outFile,'outgoing')
  writeFileSync(inFile,'incoming')
  const clipPath=stemClipPath({file_path:outFile},{file_path:inFile})
  const wav=Buffer.alloc(256,1)
  writeFileSync(clipPath,wav)
  writeFileSync(clipPath+'.json',JSON.stringify({
    schema:'lokal-automix-stem-clip-v1',
    source:{outgoingSha256:'a'.repeat(64),incomingSha256:sha('incoming')},
    clip:{sha256:sha(wav),bytes:wav.length},
    timeline:{outStart:130,inStart:7,resumeIn:24,length:16,masterGain:.9},
  }))
  assert.equal(await loadPreparedStemClip({file_path:outFile},{file_path:inFile}),null)
})
