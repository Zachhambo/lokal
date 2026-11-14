// Load the actual production renderer with fresh and restored profiles. A
// successful Vite build alone cannot catch exceptions in React startup effects.
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'vite'
import { packQueue } from '../src/queueStorage.js'
const { chromium } = createRequire(import.meta.url)('playwright')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-renderer-startup-'))
let browser, server, origin
before(async () => {
  await build({ plugins: [{ name: 'startup-store-probe', transform(code, id) {
    if (id.replace(/\\/g, '/').endsWith('/src/main.jsx')) return {
      code: code + "\nimport { usePlayerStore as startupPlayer } from './store/player.js'; window.__startupPlayer = startupPlayer; import { useDownloads as startupDownloads } from './store/downloads.js'; window.__startupDownloads = startupDownloads;", map: null,
    }
  } }], build: { outDir: dir, emptyOutDir: true } })
  server = createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.resolve(dir, relative)
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return }
    const type = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }), headless: true, args: ['--no-sandbox'] })
})
after(async () => {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  fs.rmSync(dir, { recursive: true, force: true })
})

const track = { id: 'startup-track', title: 'Saved Song', artist: 'Artist', duration: 180, file_path: 'C:\\Music\\Saved Song.flac' }
const savedQueue = currentTrack => packQueue({ queue: currentTrack ? [currentTrack] : [], originalQueue: currentTrack ? [currentTrack] : [], currentTrack, queueIndex: currentTrack ? 0 : -1 })

for (const mode of ['fresh profile', 'saved empty queue', 'restored track', 'clear restored queue']) {
  test(`production renderer starts with ${mode}`, async t => {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    t.after(() => context.close())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      // These tests exercise renderer startup, with an empty backend library.
      const body = url.pathname === '/api/settings' ? {} : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.addInitScript(({ mode, queue }) => {
      if (mode !== 'fresh profile') localStorage.setItem('lokal-queue', JSON.stringify(queue))
    }, { mode, queue: savedQueue(mode.includes('restored') ? track : null) })
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('[role="alert"]') || document.body.innerText.includes('Library'))
    if (mode === 'clear restored queue') {
      await page.waitForFunction(() => window.__startupPlayer)
      await page.evaluate(() => window.__startupPlayer.setState({ currentTrack: null, queue: [], originalQueue: [], shuffleQueue: [], queueIndex: -1, isPlaying: false }))
    }
    await page.waitForTimeout(300)
    const body = await page.locator('body').innerText()
    assert.equal(await page.getByRole('alert').count(), 0, body)
    assert.match(body, /Library/)
    assert.deepEqual(errors, [])
  })
}

test('download popover keeps Addons and queue actions apart at normal and narrow widths', async t => {
  const context = await browser.newContext({ viewport: { width: 900, height: 720 }, serviceWorkers: 'block' })
  t.after(() => context.close())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__startupDownloads?.getState().loaded && !!document.querySelector('[data-downloads-toggle]'))
  await page.evaluate(() => window.__startupDownloads.setState({ jobs: [
    { id: 'busy', kind: 'single', title: 'Loading track', status: 'downloading', progress: 67, seen: false },
    { id: 'done', kind: 'single', title: 'Saved track', status: 'done', seen: false },
  ] }))
  // Fresh profiles show an onboarding overlay that intercepts pointer input.
  // Open the real popover through its store so this test isolates header geometry.
  await page.evaluate(() => window.__startupDownloads.setState({ panelOpen: true }))
  const header = page.locator('[data-download-panel-header]')
  const tab = page.getByRole('tab', { name: /Addons/ })
  const cancel = page.getByRole('button', { name: 'Cancel all' })
  const clear = page.getByRole('button', { name: 'Clear', exact: true })
  await header.waitFor()
  await cancel.waitFor()
  await clear.waitFor()

  for (const width of [900, 380, 320]) {
    await page.setViewportSize({ width, height: 720 })
    await page.waitForTimeout(100)
    const [tabBox, cancelBox, clearBox, headerBox] = await Promise.all([
      tab.boundingBox(), cancel.boundingBox(), clear.boundingBox(), header.boundingBox(),
    ])
    assert.ok(tabBox && cancelBox && clearBox && headerBox, 'all header controls are present')
    assert.ok(tabBox.y + tabBox.height <= Math.min(cancelBox.y, clearBox.y),
      'Addons tab never overlaps Cancel all / Clear')
    assert.ok(cancelBox.x + cancelBox.width <= clearBox.x ||
              cancelBox.y + cancelBox.height <= clearBox.y,
      'the two queue actions never overlap, including when wrapped')
    assert.ok(cancelBox.x >= headerBox.x - 1 && clearBox.x + clearBox.width <= headerBox.x + headerBox.width + 1,
      'queue action buttons stay inside the popover')
  }
  assert.deepEqual(errors, [])
})
