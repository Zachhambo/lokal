import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { startRendererStallMonitor, measuredStall, SAMPLE_MS } from '../src/performanceStalls.mjs'

test('renderer stall timer ignores ordinary frames and reports substantial freezes', () => {
  let time = 0
  let callback
  let disposed = false
  const reports = []
  let visible = true
  const stop = startRendererStallMonitor({
    now: () => time,
    interval: (fn, every) => { callback = fn; assert.equal(every, SAMPLE_MS); return 1 },
    clear: () => { disposed = true },
    active: () => visible,
    report: lag => reports.push(Math.round(lag)),
  })
  time = 500; callback()
  time = 1050; callback()
  assert.deepEqual(reports, [])
  time = 1910; callback() // 360 ms late
  assert.deepEqual(reports, [360])
  time = 2710; callback() // cooldown avoids flooding logs
  assert.deepEqual(reports, [360])
  visible = false
  time = 7210; callback() // minimized browser doesn't count as a hang
  assert.deepEqual(reports, [360])
  visible = true
  time = 8010; callback()
  assert.deepEqual(reports, [360, 300])
  stop()
  assert.equal(disposed, true)
  assert.equal(measuredStall(499), 0)
})

test('Home bootstrap uses bounded artist previews rather than all-library objects', () => {
  const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8')
  const load = home.split('  const load = () => {')[1]?.split('  useEffect(() => { load() }')[0]
  assert.ok(load, 'Home must retain its initial data request')
  assert.match(load, /getArtistsPage\(\{ limit: 100/)
  assert.doesNotMatch(load, /api\.getArtists\(\)/)
  assert.match(home, /getDiscoveryArtistNamesPage/)
  assert.match(home, /await whenIdle\(\)/)
})

test('all non-Home routes are code-split away from the first renderer paint', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /import Home from '\.\/pages\/Home'/)
  for (const page of ['Search', 'Settings', 'Artists', 'Library', 'Videos', 'Playlist', 'SpotifyPlaylist']) {
    assert.match(app, new RegExp(`const ${page} = lazy\\(\\(\\) => import\\('\./pages/${page}'\\)\\)`))
  }
})
