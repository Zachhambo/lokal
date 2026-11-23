'use strict'
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const RELEASE_URL = 'https://api.github.com/repos/lokal-music/desktop/releases/tags/desktop'
const PACKAGE_NAME = 'lokal-music'
function getInstalledDebVersion(execFile = execFileSync) {
  let version
  try {
    version = execFile('dpkg-query', ['--show', '--showformat=${Version}', PACKAGE_NAME], { encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error('Could not read the installed Lokal DEB version with dpkg-query: ' + (error.message || String(error)), { cause: error })
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('dpkg-query returned an invalid installed Lokal DEB version: ' + (version || '(empty)'))
  }
  return version
}
function compareVersions(left, right) {
  const a = String(left).split('.').map(Number), b = String(right).split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
function createLinuxDebUpdater(options = {}) {
  const getVersion = options.getVersion, arch = options.arch
  const fetchImpl = options.fetch || globalThis.fetch
  const writeFile = options.writeFile || fs.writeFile
  const tempDir = options.tmpdir || os.tmpdir
  const spawnProcess = options.spawn || spawn
  const platform = options.platform || process.platform
  const emit = options.onEvent || (() => {})
  const onInstallStart = options.onInstallStart || (() => {})
  const onInstallError = options.onInstallError || (() => {})
  const onInstalled = options.onInstalled || (() => {})
  let downloadedPath = null, installing = false, downloadPromise = null
  function send(event, data) { emit(event, data) }
  function packageArch() {
    if (arch === 'x64') return 'amd64'
    if (arch === 'arm64') return 'arm64'
    throw new Error('Lokal DEB updates are not available for architecture: ' + arch)
  }
  async function getRelease() {
    const response = await fetchImpl(RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Lokal-Desktop-Updater' },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error('Could not check Lokal releases (HTTP ' + response.status + ')')
    const data = await response.json()
    if (data.draft || data.prerelease || data.tag_name !== 'desktop') throw new Error('The stable Lokal release could not be verified')
    return data
  }
  function versionOf(data) {
    return String(data.name || '').match(/(\d+\.\d+\.\d+)/)?.[1]
      || String(data.body || '').match(/lokal-desktop version:(\d+\.\d+\.\d+)/)?.[1]
  }
  function assetFor(data, version) {
    const name = PACKAGE_NAME + '_' + version + '_' + packageArch() + '.deb'
    const asset = data.assets?.find(item => item.name === name)
    if (!asset || !asset.browser_download_url?.startsWith('https://github.com/lokal-music/desktop/releases/download/')) {
      throw new Error('The stable release is missing the Linux package ' + name)
    }
    return asset
  }
  async function check() {
    try {
      send('checking')
      const data = await getRelease()
      const version = versionOf(data)
      if (!version) throw new Error('The stable release does not declare a valid Lokal version')
      const installedVersion = getVersion()
      if (compareVersions(version, installedVersion) <= 0) {
        send('current', { version: installedVersion })
        return { current: true, version: installedVersion }
      }
      assetFor(data, version)
      send('available', { version, releaseName: data.name, releaseNotes: data.body || '' })
      return { available: true, version }
    } catch (error) {
      send('error', error.message || String(error))
      return { error: error.message || String(error) }
    }
  }
  async function download() {
    if (downloadPromise) return downloadPromise
    downloadPromise = (async () => {
      try {
        const data = await getRelease(), version = versionOf(data)
        if (!version || compareVersions(version, getVersion()) <= 0) throw new Error('No newer stable Lokal version is available')
        const asset = assetFor(data, version)
        send('progress', { percent: 5 })
        const response = await fetchImpl(asset.browser_download_url, {
          headers: { 'User-Agent': 'Lokal-Desktop-Updater' },
          signal: AbortSignal.timeout(180000),
        })
        if (!response.ok) throw new Error('Lokal package download failed (HTTP ' + response.status + ')')
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length < 1024) throw new Error('The downloaded Lokal package is incomplete')
        const destination = path.join(tempDir(), asset.name)
        await writeFile(destination, bytes, { mode: 0o600 })
        downloadedPath = destination
        send('progress', { percent: 100 })
        send('ready', { version })
        return { downloaded: true, version }
      } catch (error) {
        send('error', error.message || String(error))
        return { error: error.message || String(error) }
      } finally { downloadPromise = null }
    })()
    return downloadPromise
  }
  function install() {
    if (installing) return { installing: true }
    if (!downloadedPath) return { error: 'The Lokal update package has not finished downloading' }
    installing = true
    onInstallStart()
    let child
    let output = ''
    try {
      if (platform !== 'linux') throw new Error('The Linux package installer can only run on Linux')
      child = spawnProcess('pkexec', ['apt-get', 'install', '-y', downloadedPath], { stdio: ['ignore', 'pipe', 'pipe'] })
      const collect = chunk => { output = (output + String(chunk)).slice(-12000) }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
    } catch (error) {
      installing = false
      onInstallError(error)
      send('error', error.message || String(error))
      return { error: error.message || String(error) }
    }
    child.once('error', error => {
      installing = false
      onInstallError(error)
      send('error', error.message || String(error))
    })
    child.once('close', code => {
      if (code !== 0) {
        installing = false
        const detail = output.trim().split('\n').slice(-8).join('\n')
        const message = code === null
          ? 'The package installer was cancelled or could not start'
          : 'Lokal package installation failed (exit code ' + code + ')' + (detail ? ': ' + detail : '')
        onInstallError(new Error(message))
        send('error', message)
        return
      }
      onInstalled()
    })
    return { installing: true }
  }
  return { check, download, install }
}
module.exports = { compareVersions, createLinuxDebUpdater, getInstalledDebVersion }
