import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { extractTarArchive } = require('../electron/ipc/systemTar.js')
const linuxOnly = { skip: process.platform !== 'linux' }

test('extracts an xz-compressed FFmpeg-style archive with the system tar command', linuxOnly, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-ffmpeg-tar-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  const source = path.join(root, 'ffmpeg-master-latest-linux64-gpl', 'bin')
  const destination = path.join(root, 'extracted')
  const archive = path.join(root, 'ffmpeg.tar.xz')
  await fs.mkdir(source, { recursive: true })
  await fs.mkdir(destination, { recursive: true })
  await fs.writeFile(path.join(source, 'ffmpeg'), 'ffmpeg fixture')
  await fs.writeFile(path.join(source, 'ffprobe'), 'ffprobe fixture')

  execFileSync('tar', ['-cJf', archive, '-C', root, 'ffmpeg-master-latest-linux64-gpl'])
  await extractTarArchive(archive, destination)

  assert.equal(
    await fs.readFile(path.join(destination, 'ffmpeg-master-latest-linux64-gpl', 'bin', 'ffmpeg'), 'utf8'),
    'ffmpeg fixture',
  )
  assert.equal(
    await fs.readFile(path.join(destination, 'ffmpeg-master-latest-linux64-gpl', 'bin', 'ffprobe'), 'utf8'),
    'ffprobe fixture',
  )
})

test('returns a clear extraction error for an invalid archive', linuxOnly, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-ffmpeg-tar-invalid-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  const archive = path.join(root, 'invalid.tar.xz')
  const destination = path.join(root, 'extracted')
  await fs.writeFile(archive, 'not a tar archive')
  await fs.mkdir(destination)

  await assert.rejects(
    extractTarArchive(archive, destination),
    /FFmpeg archive extraction failed:/,
  )
})

test('the Linux FFmpeg path does not load the optional npm tar module', async () => {
  const toolsPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../electron/ipc/tools.js')
  const toolsSource = await fs.readFile(toolsPath, 'utf8')
  assert.match(toolsSource, /await extractTarArchive\(archivePath, extractFolder\)/)
  assert.doesNotMatch(toolsSource, /require\(['"]tar['"]\)/)
})
