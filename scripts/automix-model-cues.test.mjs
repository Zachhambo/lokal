import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { sidecarForRole, mergeReports } from './automix-import-cues.mjs'
const require = createRequire(import.meta.url)
const { validateAdvancedReport, mergeAdvancedAnalysis } =
  require('../electron/automix/advanced-report.js')

const SHA1 = 'a'.repeat(64)
const SHA2 = 'b'.repeat(64)
const REVISION = 'c'.repeat(40)
const stat = { size:123456, mtimeMs:1760000000000 }
const report = {
  cue_detector:'disco-eth/cue-detr',
  cue_detector_revision:REVISION,
  cue_processor_revision:'one',
  song1_transition_start_seconds:166,
  song1_cue_snapped_seconds:181.8,
  song1_estimated_bpm:124,
  song2_transition_start_seconds:8,
  song2_cue_snapped_seconds:24,
  song2_estimated_bpm:120,
}
const source = { ...stat, sha256:SHA1 }
const out = () => sidecarForRole('song1',report,source,200)
const incoming = () => sidecarForRole('song2',report,source,200)

test('imported overlap START is represented as outgoing/incoming role cue', () => {
  assert.deepEqual(out().transitionCues.exits,[{time:166,confidence:0.95}])
  assert.deepEqual(incoming().transitionCues.entrances,[{time:8,confidence:0.95}])
  assert.equal(out().transitionCues.entrances.length,0)
})

test('valid fingerprinted report merges without changing base loudness/tempo', () => {
  const parsed = validateAdvancedReport(out(),stat)
  assert.ok(parsed)
  const base = {duration:200,bpm:124,firstBeat:0.2,energy:0.5,
    transitionCues:{entrances:[],exits:[{time:181,confidence:0.6}]}}
  const enhanced = mergeAdvancedAnalysis(base,parsed)
  assert.equal(enhanced.modelCueAnalysis,true)
  assert.equal(enhanced.bpm,124)
  assert.equal(enhanced.transitionCues.exits[0].source,'cue-detr')
  assert.equal(enhanced.transitionCues.exits[0].time,166)
  assert.equal(enhanced.transitionCues.exits.length,2)
})

test('wrong size, stale timestamp, malformed candidate and huge duration fail closed', () => {
  assert.equal(validateAdvancedReport(out(),{...stat,size:1}),null)
  assert.equal(validateAdvancedReport(out(),{...stat,mtimeMs:stat.mtimeMs+2000}),null)
  assert.equal(validateAdvancedReport({...out(),durationSeconds:1},stat),null)
  assert.equal(validateAdvancedReport({...out(),transitionCues:{exits:[null],entrances:[]}},stat),null)
  assert.equal(validateAdvancedReport({...out(),source:{...source,sha256:SHA1.slice(2)}},stat),null)
})

test('repeated cue preparation merges different paired role timings', () => {
  const combined=mergeReports(out(),incoming())
  assert.equal(combined.transitionCues.exits.length,1)
  assert.equal(combined.transitionCues.entrances.length,1)
  const replaced=mergeReports(combined,{...incoming(),source:{...source,sha256:SHA2}})
  assert.equal(replaced.transitionCues.exits.length,0)
})
