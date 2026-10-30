'use strict'

// Dedicated E-AC-3 JOC bitstream route. Chromium's Web Audio graph decodes to
// PCM and cannot preserve Atmos metadata, so never send JOC through <audio>.
// mpv/FFmpeg exposes native WASAPI/ALSA HDMI compressed passthrough instead.
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)
const path = require('node:path')
const fs = require('node:fs')
const { hasAtmosMetadata } = require('../mornye/atmos')
const headphones = require('./headphones')

let active = null

function supportedHost(platform = process.platform) {
  return platform === 'win32' || platform === 'linux' || platform === 'darwin'
}

function outputOptions(platform, device) {
  if (!supportedHost(platform)) throw new Error('Native Atmos bitstream output is not available on this desktop OS')
  if (device && (typeof device !== 'string' || device.length > 160 || !/^(wasapi|alsa|coreaudio)\//.test(device))) {
    throw new Error('Choose a WASAPI or ALSA HDMI output device')
  }
  const prefix = platform === 'win32' ? 'wasapi/' : (platform === 'darwin' ? 'coreaudio/' : 'alsa/')
  if (device && !device.startsWith(prefix)) {
    throw new Error('Selected output does not match this operating system')
  }
  // Never use a PCM mixer (PulseAudio, CoreAudio or WASAPI shared) for JOC.
  // mpv must confirm a spdif-eac3 AO before reporting playback.
  return [
    ...(!device ? [`--ao=${platform === 'win32' ? 'wasapi' : (platform === 'darwin' ? 'coreaudio' : 'alsa')}`] : []),
    ...(['win32', 'darwin'].includes(platform) ? ['--audio-exclusive=yes'] : []),
    ...(device ? [`--audio-device=${device}`] : []),
    '--audio-spdif=eac3',
    '--audio-fallback-to-null=no',
    '--no-video',
    '--no-config',
    '--no-resume-playback',
    '--input-file=-',
    '--msg-level=ao=info',
    '--msg-level=audio=info',
  ]
}

function isConfirmedBitstream(logLine) {
  // AO: [wasapi] 48000Hz ... spdif-eac3. Reject PCM, even when an Atmos
  // version was selected in the catalogue; receiver output is what matters.
  return /\bAO:.*\bspdif[-_]?eac3\b/i.test(logLine)
}

// mpv is often installed by Scoop/winget or extracted as a portable binary
// without changing the Electron process PATH. Never equate a PATH miss with a
// missing HDMI receiver: actual passthrough support is confirmed only on play.
function mpvCandidates({ platform = process.platform, env = process.env, resourcesPath = process.resourcesPath, customPath = '', userBin = '' } = {}) {
  const executable = platform === 'win32' ? 'mpv.exe' : 'mpv'
  const found = [customPath]
  if (userBin) found.push(path.join(userBin, executable))
  if (resourcesPath) found.push(path.join(resourcesPath, 'bin', platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux', executable))
  found.push('mpv')
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) {
      found.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'mpv.exe'))
      found.push(path.join(env.LOCALAPPDATA, 'Programs', 'mpv', 'mpv.exe'))
    }
    if (env.USERPROFILE) found.push(path.join(env.USERPROFILE, 'scoop', 'shims', 'mpv.exe'))
    if (env.ProgramFiles) found.push(path.join(env.ProgramFiles, 'mpv', 'mpv.exe'))
  }
  return [...new Set(found.filter(Boolean))]
}

let lastValidatedMpv = ''
let lastProbeAt = 0
async function findMpvBinary({ platform = process.platform, customPath = '', env = process.env, resourcesPath = process.resourcesPath, userBin = '' } = {}) {
  if (!supportedHost(platform)) return null
  const candidates = mpvCandidates({ platform, customPath, env, resourcesPath, userBin })
  // PATH resolution can change without notification: never reuse an alias
  // probe, only a previously validated absolute executable that still exists.
  if (path.isAbsolute(lastValidatedMpv) && candidates.includes(lastValidatedMpv) &&
      Date.now() - lastProbeAt < 10000 && fs.existsSync(lastValidatedMpv)) return lastValidatedMpv
  for (const binary of candidates) {
    if (path.isAbsolute(binary) && !fs.existsSync(binary)) continue
    try {
      await execFileAsync(binary, ['--version'], {
        windowsHide: true, timeout: 2500, maxBuffer: 128 * 1024,
      })
      lastValidatedMpv = binary
      lastProbeAt = Date.now()
      return binary
    } catch {}
  }
  lastValidatedMpv = ''
  lastProbeAt = 0
  return null
}

async function nativeAtmosAvailable(platform = process.platform) {
  return !!(await findMpvBinary({ platform }))
}

function parseAudioDevices(output, platform = process.platform) {
  const prefix = platform === 'win32' ? 'wasapi/' : platform === 'darwin' ? 'coreaudio/' : 'alsa/'
  const results = []
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^\s*['"]([^'"]+)['"]\s*(?:\((.*)\))?/)
    if (!match || !match[1].startsWith(prefix)) continue
    results.push({ id: match[1], label: match[2] || match[1] })
  }
  return results
}

async function inspectAtmosFile(filename, ffprobeBinary) {
  if (!ffprobeBinary) throw new Error('FFprobe is required to verify a local Atmos file. Install it from Settings → Tools.')
  let stdout
  try {
    ({ stdout } = await execFileAsync(ffprobeBinary, [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,profile', '-of', 'json', filename,
    ], { windowsHide: true, encoding: 'utf8', timeout: 12000, maxBuffer: 512 * 1024 }))
  } catch { throw new Error('Could not inspect this audio file with FFprobe.') }
  let streams
  try { streams = JSON.parse(stdout).streams } catch { throw new Error('FFprobe returned invalid audio metadata.') }
  const audio = streams?.[0]
  if (audio?.codec_name === 'ac4') return { codec: 'AC-4', spatialVerified: false }
  if (audio?.codec_name !== 'eac3' || !/dolby atmos/i.test(audio?.profile || '')) {
    throw new Error('This file is not confirmed as Dolby Digital Plus Atmos (E-AC-3 JOC) or AC-4 audio.')
  }
  return { codec: 'E-AC-3 JOC', spatialVerified: true }
}

// Offer a guided, opt-in repair only for Windows native headphone decoding
// failures. HDMI passthrough failures are receiver/output issues, not missing
// Windows codecs. Never download or execute an unverified third-party installer.
const WINDOWS_CODEC_GUIDE = 'https://www.majorgeeks.com/files/details/dolby_ac_3ac_4_installer.html'
function isWindowsDecoderError(error, mode, platform = process.platform) {
  if (platform !== 'win32' || mode !== 'headphones') return false
  const message = String(error?.message || error || '')
  return /Windows Media Foundation could not play this Dolby Atmos file|Windows audio did not start|E-AC-3 decoder|AC-4 decoder/i.test(message)
}
async function offerWindowsCodecHelp(error, mode, platform = process.platform, electron = null) {
  if (!isWindowsDecoderError(error, mode, platform)) return false
  const { dialog, shell } = electron || require('electron')
  const response = await dialog.showMessageBox({
    type: 'warning',
    title: 'Dolby audio needs attention',
    message: 'Windows could not decode this Dolby Atmos track.',
    detail: 'Your PC may be missing an E-AC-3 or AC-4 decoder. You can review the codec installation guide, then return to Lokal and retry the track. Dolby Access and Spatial Sound settings may also need configuration. Installing a codec does not guarantee Atmos rendering.\n\nTechnical details: ' + String(error?.message || error).slice(0, 600),
    buttons: ['Open codec installation guide', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response.response === 0) await shell.openExternal(WINDOWS_CODEC_GUIDE)
  return true
}

function registerAtmosHandlers(ipcMain, { getDB, broadcast }) {
  const notify = (state) => broadcast?.('atmos:status', state)
  const savedMpv = () => {
    try { return getDB().prepare('SELECT value FROM settings WHERE key = ?').get('custom_mpv_path')?.value || '' } catch { return '' }
  }
  const findMpv = async () => {
    let userBin = ''
    try { userBin = require('../ipc/tools').getUserDataBin() } catch {}
    return findMpvBinary({ customPath: savedMpv(), userBin })
  }
  const capability = async () => {
    const binary = await findMpv()
    return { available: !!binary, mpvAvailable: !!binary, mpvPath: binary || null,
      platform: process.platform, outputVerified: false, mode: 'hdmi-passthrough',
      headphones: headphones.headphoneCapability() }
  }
  ipcMain.handle('atmos:capabilities', capability)
  ipcMain.handle('atmos:devices', async () => {
    const binary = await findMpv()
    if (!binary) return { error: 'mpv is not installed or could not be found. Install mpv or locate mpv.exe.' }
    try {
      const { stdout, stderr } = await execFileAsync(binary, ['--no-config', '--audio-device=help'], {
        windowsHide: true, encoding: 'utf8', timeout: 8000, maxBuffer: 512 * 1024,
      })
      return { devices: parseAudioDevices(String(stdout || '') + '\n' + String(stderr || '')) }
    } catch (error) {
      return { error: 'Could not list mpv audio devices: ' + error.message }
    }
  })
  ipcMain.handle('atmos:chooseMpv', async () => {
    const { dialog } = require('electron')
    const chosen = await dialog.showOpenDialog({
      title: 'Locate mpv executable',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'mpv', extensions: ['exe'] }] : undefined,
    })
    if (chosen.canceled || !chosen.filePaths?.[0]) return { cancelled: true }
    const binary = chosen.filePaths[0]
    try {
      await execFileAsync(binary, ['--version'], { windowsHide: true, timeout: 3000, maxBuffer: 128 * 1024 })
      getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('custom_mpv_path', binary)
      lastValidatedMpv = binary
      lastProbeAt = Date.now()
      return { ok: true, ...await capability() }
    } catch (error) { return { error: 'The selected mpv executable could not be used: ' + error.message } }
  })

  const stop = async () => {
    const old = active
    active = null
    if (!old) return { ok: true }
    old.controller?.abort()
    if (old.monitor) clearInterval(old.monitor)
    if (old.positionPoll) clearInterval(old.positionPoll)
    if (old.mode === 'headphones') {
      try { headphones.stopHeadphones() } catch {}
    }
    if (old.proc && old.proc.exitCode === null) {
      const done = new Promise(resolve => {
        old.proc.once('exit', resolve)
        setTimeout(resolve, 3000).unref?.()
      })
      old.proc.kill()
      await done
    }
    if (old.artifact) {
      try { await old.artifact.cleanup() } catch {}
      old.artifact = null
    }
    notify({ state: 'stopped' })
    return { ok: true }
  }
  ipcMain.handle('atmos:stop', () => {
    startGeneration++
    return stop()
  })
  ipcMain.handle('atmos:command', async (_, command) => {
    const absoluteSeek = typeof command === 'string' &&
      /^seek (?:0|[1-9]\d{0,5})(?:\.\d{1,3})? absolute$/.test(command)
    const headphoneVolume = typeof command === 'string' &&
      /^volume (?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(command)
    if (!active || (!absoluteSeek && !(active.mode === 'headphones' && headphoneVolume) &&
        !['cycle pause', 'seek 10 relative', 'seek -10 relative'].includes(command))) {
      return { error: 'No Atmos stream is running or invalid transport command' }
    }
    if (active.mode === 'headphones') {
      try { headphones.headphoneCommand(command); return { ok: true } }
      catch (err) { return { error: err.message || String(err) } }
    }
    if (!active.proc) return { error: 'No HDMI Atmos output is running' }
    active.proc.stdin.write(command + '\n')
    return { ok: true }
  })

  const launchFile = async ({ filename, session, provider, id, device, binary, mode, codec = 'E-AC-3 JOC' }) => {
    if (!fs.existsSync(filename) || !path.isAbsolute(filename)) throw new Error('Atmos audio file is unavailable')
    if (mode === 'headphones') {
      session.mode = 'headphones'
      await headphones.startHeadphones(filename, { signal: session.controller?.signal })
      if (active !== session) throw new Error('Atmos request was cancelled')
      // Windows native media uses the installed E-AC-3 or AC-4 decoder.
      // Playing the file does not prove Atmos spatial objects were rendered.
      notify({ state: 'playing', provider, id, codec,
        mode: 'headphones', output: 'Windows native media / spatial processing unverified' })
      session.monitor = setInterval(async () => {
        if (active !== session) return
        const status = headphones.headphoneStatus()
        if (status.state === 'playing' || status.state === 'paused') {
          notify({ state: 'progress', provider, id, mode: 'headphones',
            position: status.position_secs, duration: status.duration_secs,
            paused: status.state === 'paused' })
        }
        if (status.state === 'error' || status.state === 'ended' || status.state === 'stopped') {
          await stop()
          if (status.state === 'error') {
            const failure = new Error(headphones.headphoneDecoderFailure(status.error))
            notify({ state: 'error', error: failure.message })
            offerWindowsCodecHelp(failure, 'headphones').catch(() => {})
          }
        }
      }, 500)
      session.monitor.unref?.()
      return { ok: true, codec, mode: 'headphones', spatialVerified: false,
        output: 'Windows native media (verify Spatial Sound in Windows Settings)' }
    }
    session.mode = 'hdmi'
    const proc = spawn(binary, [...outputOptions(process.platform, device), filename], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    session.proc = proc
    let output = ''
    let responseBuffer = ''
    let lastPosition = -1
    let lastDuration = 0
    const reportPosition = (data) => {
      const position = String(data).match(/ANS_time-pos=(\d+(?:\.\d+)?)/)
      const duration = String(data).match(/ANS_duration=(\d+(?:\.\d+)?)/)
      if (duration) lastDuration = Number(duration[1])
      if (position) {
        const next = Number(position[1])
        if (next !== lastPosition && active === session) {
          lastPosition = next
          notify({ state: 'progress', provider, id, mode: 'hdmi',
            position: next, duration: lastDuration, paused: false })
        }
      }
    }
    proc.stdout.on('data', data => {
      responseBuffer = (responseBuffer + String(data)).slice(-512)
      reportPosition(responseBuffer)
    })
    proc.stderr.on('data', data => {
      responseBuffer = (responseBuffer + String(data)).slice(-512)
      reportPosition(responseBuffer)
    })
    await new Promise((resolve, reject) => {
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => finish(new Error('mpv could not confirm compressed E-AC-3 output. Select an HDMI device with Dolby Atmos passthrough support.')), 12000)
      const record = data => {
        output = (output + String(data)).slice(-8192)
        if (isConfirmedBitstream(output)) finish()
        else if (/AO:.*\b(?:float|s16|s24|s32)\b/i.test(output)) {
          finish(new Error('mpv decoded to PCM instead of passing through Atmos. Select an E-AC-3 capable HDMI receiver.'))
        }
      }
      proc.stdout.on('data', record)
      proc.stderr.on('data', record)
      proc.once('error', error => finish(new Error('mpv could not start: ' + error.message)))
      proc.once('exit', code => finish(new Error('HDMI Atmos output failed (mpv exit ' + code + '). Check your selected HDMI receiver and exclusive-mode support.')))
    })
    if (active !== session) throw new Error('Atmos request was cancelled')
    notify({ state: 'playing', provider, id, mode: 'hdmi',
      codec: 'E-AC-3 JOC', output: 'compressed HDMI passthrough' })
    session.positionPoll = setInterval(() => {
      if (active !== session || !proc.stdin.writable || proc.exitCode != null) return
      try { proc.stdin.write('get_property time-pos\nget_property duration\n') } catch {}
    }, 700)
    session.positionPoll.unref?.()
    proc.once('exit', () => {
      if (session.positionPoll) clearInterval(session.positionPoll)
      if (active !== session) return
      active = null
      Promise.resolve(session.artifact?.cleanup()).catch(() => {})
      notify({ state: 'ended', provider, id, mode: 'hdmi' })
    })
    return { ok: true, codec: 'E-AC-3 JOC', output: 'compressed HDMI passthrough' }
  }

  let startGeneration = 0
  ipcMain.handle('atmos:play', async (_, provider, id, device = '', mode = 'hdmi') => {
    const generation = ++startGeneration
    if (!['hdmi', 'headphones'].includes(mode)) return { error: 'Invalid Atmos playback mode' }
    if (!supportedHost()) return { error: 'Atmos native output is not available on this desktop OS.' }
    if (mode === 'headphones' && !headphones.headphoneCapability().available) {
      return { error: 'Windows Media Foundation headphone playback is unavailable. Install the Windows Lokal build with the native bridge.' }
    }
    const binary = mode === 'hdmi' ? await findMpv() : null
    if (mode === 'hdmi' && !binary) return { error: 'mpv was not found. Install mpv or use Locate mpv in the Atmos controls. An HDMI receiver is checked separately when playback starts.' }
    if (typeof id !== 'string' || !id.length || id.length > 1024 ||
        /[\\x00-\\x1f\\x7f]/.test(id) || id === '.' || id === '..') {
      return { error: 'Invalid track ID' }
    }
    let session
    try {
      if (mode === 'hdmi') outputOptions(process.platform, device)
      const sources = require('../online/sources')
      const key = sources.addons.keyOfProvider(provider)
      // HTTP addons use a different protocol from executable Mornye
      // extensions. Their saved /stream quality is already applied by
      // resolveStream(); stage the *returned file*, verify the original
      // compressed codec and only then hand it to native output.
      const httpAddon = key && sources.addons.findByKey(getDB(), key)
      if (httpAddon) {
        const { selectedHttpSpatial, stageHttpSpatialAudio } = require('../online/httpSpatial')
        const chosen = selectedHttpSpatial(httpAddon)
        if (!chosen) return { error: 'Select a Dolby Atmos rendition in this HTTP add-on settings first.' }
        if (chosen.codec === 'ac4' && (mode !== 'headphones' || process.platform !== 'win32')) {
          return { error: 'AC-4 requires the Windows native headphone output.' }
        }
        await stop()
        if (generation !== startGeneration) return { error: 'This Atmos request was superseded.' }
        session = { proc: null, artifact: null, controller: new AbortController() }
        active = session
        notify({ state: 'loading', provider, id: String(id), message: 'Retrieving selected HTTP audio quality…' })
        const stream = await sources.addons.resolveStream(getDB(), key, id)
        if (active !== session) throw new Error('Audio request was cancelled')
        const staged = await stageHttpSpatialAudio(stream.url, { signal: session.controller.signal })
        session.artifact = staged
        if (active !== session) throw new Error('Audio request was cancelled')
        const inspected = await inspectAtmosFile(staged.file, findFfprobe())
        if (chosen.codec === 'ac4' && inspected.codec !== 'AC-4') {
          throw new Error('The HTTP add-on delivered audio other than the selected AC-4 codec. No stereo fallback.')
        }
        if (chosen.codec === 'eac3-joc' && (!inspected.spatialVerified || inspected.codec !== 'E-AC-3 JOC')) {
          throw new Error('The HTTP add-on did not deliver verified E-AC-3 JOC Atmos. No stereo fallback.')
        }
        return await launchFile({
          filename: staged.file, session, provider, id: String(id), device, binary, mode,
          codec: inspected.codec,
        })
      }
      if (!/^[\\w:.-]+$/.test(id) || id.length > 200) return { error: 'Invalid Mornye track ID' }
      const service = require('../mornye/packages').service(getDB())
      const addon = key && service.find(key)
      const { isAtmosQuality, addonPlaybackQuality } = require('../mornye/playbackQuality')
      const amazon = /^amazon(?:-(?:new|web))?$/i.test(addon?.name || '')
      if (!addon) return { error: 'Choose an installed Mornye track' }
      const options = addon.manifest?.qualityOptions || []
      const selected = addonPlaybackQuality(addon, service.settings(addon))
      // Saved native preference takes priority. Manual "Play Atmos" may still
      // choose a manifest Atmos tier when FLAC is configured.
      const preferred = options.find(q => q.id === selected && isAtmosQuality(q.id))
      const offered = preferred || options.find(q =>
        String(q?.id || '').toLowerCase() === (amazon ? 'ac4' : 'dolby_atmos')) ||
        options.find(q => isAtmosQuality(q.id))
      if (!offered) return { error: 'This add-on does not advertise a native Atmos-quality tier' }
      const nativeQuality = offered.id
      const ac4 = /^ac-?4$/i.test(nativeQuality)
      if (ac4 && mode !== 'headphones') return { error: 'AC-4 requires Windows native output. Select Headphones / Windows Spatial Sound, not E-AC-3 HDMI passthrough.' }
      if (ac4 && process.platform !== 'win32') return { error: 'AC-4 native playback currently requires Windows.' }
      await stop()
      if (generation !== startGeneration) return { error: 'This Atmos request was superseded by a newer request.' }
      session = { proc: null, artifact: null, controller: new AbortController() }
      active = session
      notify({ state: 'loading', provider, id: String(id) })
      const artifact = await service.download(key, id, {
        quality: nativeQuality, purpose: 'download', allowAtmos: true, signal: session.controller.signal,
        onProgress: ({ percent, message }) => {
          if (active !== session) return
          const value = Number(percent)
          notify({ state: 'loading', provider, id: String(id),
            percent: percent != null && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null,
            message: String(message || '') })
        },
      })
      session.artifact = artifact
      if (active !== session) throw new Error('Atmos request was cancelled')
      if (ac4) {
        if (artifact.info?.codec !== 'ac4') throw new Error('The addon did not deliver AC-4; no stereo substitution was accepted.')
      } else if (artifact.info?.codec !== 'eac3') {
        // packages.download() independently verifies the decoded file's JOC
        // presentation before returning it. Catalogue tags are not required.
        throw new Error('The addon did not deliver verified E-AC-3 JOC Atmos audio.')
      }
      return await launchFile({ filename: artifact.file, session, provider, id: String(id), device, binary, mode, codec: ac4 ? 'AC-4' : 'E-AC-3 JOC' })
    } catch (error) {
      if (active === session) await stop()
      else { try { await session?.artifact?.cleanup() } catch {} }
      await offerWindowsCodecHelp(error, mode).catch(() => {})
      return { error: error.message || String(error) }
    }
  })

  ipcMain.handle('atmos:openFile', async (_, device = '', mode = 'hdmi') => {
    if (!['hdmi', 'headphones'].includes(mode)) return { error: 'Invalid Atmos playback mode' }
    if (mode === 'headphones' && !headphones.headphoneCapability().available) {
      return { error: 'Windows Media Foundation headphone playback is unavailable in this build.' }
    }
    const binary = mode === 'hdmi' ? await findMpv() : null
    if (mode === 'hdmi' && !binary) return { error: 'mpv was not found. Install mpv or use Locate mpv in the Atmos controls.' }
    let session
    try {
      if (mode === 'hdmi') outputOptions(process.platform, device)
      const { dialog } = require('electron')
      const chosen = await dialog.showOpenDialog({
        title: 'Open Dolby Atmos audio',
        properties: ['openFile'],
        filters: [{ name: 'Dolby encoded audio', extensions: ['m4a', 'mp4', 'ec3', 'eac3'] }],
      })
      if (chosen.canceled || !chosen.filePaths?.[0]) return { cancelled: true }
      const filename = chosen.filePaths[0]
      if (!fs.statSync(filename).isFile()) return { error: 'Choose an audio file.' }
      const { findFfprobe } = require('../ipc/tools')
      const inspected = await inspectAtmosFile(filename, findFfprobe())
      if (inspected.codec === 'AC-4' && mode !== 'headphones') throw new Error('AC-4 requires Windows native media output; select Headphones / Windows Spatial Sound.')
      const generation = ++startGeneration
      await stop()
      if (generation !== startGeneration) return { error: 'This Atmos request was superseded by a newer request.' }
      session = { proc: null, artifact: null, controller: new AbortController() }
      active = session
      const id = 'local:' + path.basename(filename)
      notify({ state: 'loading', provider: 'local', id, message: 'Preparing local Atmos file…' })
      const launched = await launchFile({ filename, session, provider: 'local', id, device, binary, mode, codec: inspected.codec })
      return { ...launched, id, title: path.parse(filename).name, file: filename, mode }
    } catch (error) {
      if (active === session) await stop()
      await offerWindowsCodecHelp(error, mode).catch(() => {})
      return { error: error.message || String(error) }
    }
  })

  process.once('exit', () => {
    try { active?.proc?.kill() } catch {}
    try { headphones.stopHeadphones() } catch {}
  })
  return stop
}

module.exports = {
  supportedHost, nativeAtmosAvailable, outputOptions, isConfirmedBitstream,
  mpvCandidates, findMpvBinary, parseAudioDevices, inspectAtmosFile, registerAtmosHandlers,
  isWindowsDecoderError, offerWindowsCodecHelp,
}
