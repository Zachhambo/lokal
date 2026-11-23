'use strict'

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const EXTRACT_TIMEOUT_MS = 10 * 60 * 1000

async function extractTarArchive(archivePath, destination) {
  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destination], {
      windowsHide: true,
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error("FFmpeg extraction requires the system 'tar' command. Install GNU tar and retry.")
    }

    const detail = String(error?.stderr || error?.message || 'unknown extraction error').trim()
    throw new Error(`FFmpeg archive extraction failed: ${detail}`)
  }
}

module.exports = { extractTarArchive }
