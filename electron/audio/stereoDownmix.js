'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

function isMultichannelEac3(stream) {
  return String(stream?.codec_name || '').toLowerCase() === 'eac3' &&
    Number(stream?.channels) >= 6
}

function stereoDownmixArgs(input, output) {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:a:0', '-vn', '-sn', '-dn',
    // FFmpeg's libavcodec/libswresample downmix matrix applies the standard
    // centre/surround/LFE coefficients for the source channel layout.
    '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le',
    '-f', 'wav', output,
  ]
}

async function probeAudioFile(filename, ffprobe) {
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,channels,channel_layout',
    '-of', 'json', filename,
  ], { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024 })
  const streams = JSON.parse(stdout).streams
  return streams?.[0] || null
}

function runFfmpeg(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`))
    })
  })
}

async function prepareEac3Stereo({ filename, ffmpeg, ffprobe, cacheDirectory }) {
  const stat = await fs.promises.stat(filename)
  if (!stat.isFile()) throw new Error('The selected audio file is unavailable.')
  const stream = await probeAudioFile(filename, ffprobe)
  if (!isMultichannelEac3(stream)) return { converted: false }
  if (!ffmpeg) throw new Error('FFmpeg is required to play multichannel E-AC-3 in stereo. Install it in Settings → Tools.')
  await fs.promises.mkdir(cacheDirectory, { recursive: true })
  const key = crypto.createHash('sha256')
    .update(filename).update('\0').update(String(stat.size)).update('\0').update(String(stat.mtimeMs))
    .digest('hex')
  const output = path.join(cacheDirectory, `${key}.wav`)
  try {
    const cached = await fs.promises.stat(output)
    if (cached.isFile() && cached.size > 44) return { converted: true, output, cached: true, channels: 2 }
  } catch {}
  const temporary = `${output}.${process.pid}.${Date.now()}.partial.wav`
  try {
    await runFfmpeg(ffmpeg, stereoDownmixArgs(filename, temporary))
    const converted = await fs.promises.stat(temporary)
    if (!converted.isFile() || converted.size <= 44) throw new Error('FFmpeg produced an empty stereo audio file.')
    await fs.promises.rename(temporary, output).catch(async error => {
      // Another playback request may have completed the same cache entry.
      try { await fs.promises.access(output); await fs.promises.unlink(temporary) }
      catch { throw error }
    })
    return { converted: true, output, cached: false, channels: 2 }
  } catch (error) {
    try { await fs.promises.unlink(temporary) } catch {}
    throw error
  }
}

module.exports = { isMultichannelEac3, stereoDownmixArgs, probeAudioFile, prepareEac3Stereo }
