import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { test } from 'node:test'
const require = createRequire(import.meta.url)
const { compareVersions, createLinuxDebUpdater, getInstalledDebVersion } = require('../electron/linuxDebUpdater.js')
const release = {
  tag_name: 'desktop', name: 'Desktop — 16.1.4', draft: false, prerelease: false, body: 'Release notes',
  assets: [{ name: 'lokal-music_16.1.4_amd64.deb', browser_download_url: 'https://github.com/lokal-music/desktop/releases/download/desktop/lokal-music_16.1.4_amd64.deb' }],
}
test('compares stable numeric versions correctly', () => {
  assert.equal(compareVersions('16.1.4', '16.1.3'), 1)
  assert.equal(compareVersions('16.2.0', '16.10.0'), -1)
  assert.equal(compareVersions('16.1.3', '16.1.3'), 0)
})
test('reads the installed DEB version from dpkg-query', () => {
  let invocation
  const version = getInstalledDebVersion((...args) => {
    invocation = args
    return '16.1.4\n'
  })
  assert.equal(version, '16.1.4')
  assert.deepEqual(invocation, [
    'dpkg-query',
    ['--show', '--showformat=${Version}', 'lokal-music'],
    { encoding: 'utf8' },
  ])
})
test('does not offer an update when dpkg reports the installed version is current', async () => {
  const updater = createLinuxDebUpdater({
    getVersion: () => getInstalledDebVersion(() => '16.1.4\n'),
    arch: 'x64',
    fetch: async () => ({ ok: true, json: async () => release }),
  })
  assert.deepEqual(await updater.check(), { current: true, version: '16.1.4' })
})
test('reports dpkg-query failures and invalid installed versions', () => {
  assert.throws(
    () => getInstalledDebVersion(() => { throw new Error('command not found') }),
    /Could not read the installed Lokal DEB version with dpkg-query: command not found/,
  )
  assert.throws(
    () => getInstalledDebVersion(() => '16.1.4-1'),
    /dpkg-query returned an invalid installed Lokal DEB version/,
  )
})
test('finds the matching DEB and reports an available update', async () => {
  const events = []
  const updater = createLinuxDebUpdater({ getVersion: () => '16.1.3', arch: 'x64', fetch: async () => ({ ok: true, json: async () => release }), onEvent: (...event) => events.push(event) })
  assert.deepEqual(await updater.check(), { available: true, version: '16.1.4' })
  assert.deepEqual(events.at(-1), ['available', { version: '16.1.4', releaseName: release.name, releaseNotes: release.body }])
})
test('downloads the DEB and installs it through pkexec apt-get', async () => {
  const events = [], writes = [], spawns = []
  let installed = false
  const updater = createLinuxDebUpdater({
    getVersion: () => '16.1.3', arch: 'x64',
    platform: 'linux',
    fetch: async url => url === release.assets[0].browser_download_url
      ? { ok: true, arrayBuffer: async () => new Uint8Array(2048).buffer }
      : { ok: true, json: async () => release },
    writeFile: async (...args) => writes.push(args), tmpdir: () => '/tmp',
    spawn: (...args) => { spawns.push(args); const child = new EventEmitter(); process.nextTick(() => child.emit('close', 0)); return child },
    onEvent: (...event) => events.push(event), onInstalled: () => { installed = true },
  })
  assert.deepEqual(await updater.download(), { downloaded: true, version: '16.1.4' })
  assert.equal(writes[0][0], path.join('/tmp', 'lokal-music_16.1.4_amd64.deb'))
  assert.equal(events.at(-1)[0], 'ready')
  assert.deepEqual(updater.install(), { installing: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(spawns[0][0], 'pkexec')
  assert.deepEqual(spawns[0][1].slice(0, 3), ['apt-get', 'install', '-y'])
  assert.equal(installed, true)
})
test('reports a missing architecture-specific package', async () => {
  const updater = createLinuxDebUpdater({ getVersion: () => '16.1.3', arch: 'x64', fetch: async () => ({ ok: true, json: async () => ({ ...release, assets: [] }) }) })
  assert.match((await updater.check()).error, /lokal-music_16.1.4_amd64.deb/)
})
test('does not offer an update when already current', async () => {
  const updater = createLinuxDebUpdater({ getVersion: () => '16.1.4', arch: 'x64', fetch: async () => ({ ok: true, json: async () => release }) })
  assert.deepEqual(await updater.check(), { current: true, version: '16.1.4' })
})
