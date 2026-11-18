#!/usr/bin/env node
// Offline artwork. SVG masters are reviewed in git; generated bitmaps are not
// part of the app payload. NSIS needs bottom-up, padded, 24-bit BGR bitmaps.
const fs = require('node:fs/promises')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'build', 'installer', 'generated')
function bitmap24(pixels, width, height) {
  const stride = (width * 3 + 3) & ~3
  const bytes = Buffer.alloc(54 + stride * height)
  bytes.write('BM')
  bytes.writeUInt32LE(bytes.length, 2)
  bytes.writeUInt32LE(54, 10)
  bytes.writeUInt32LE(40, 14)
  bytes.writeInt32LE(width, 18)
  bytes.writeInt32LE(height, 22)
  bytes.writeUInt16LE(1, 26)
  bytes.writeUInt16LE(24, 28)
  bytes.writeUInt32LE(stride * height, 34)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (y * width + x) * 3
    const target = 54 + (height - 1 - y) * stride + x * 3
    bytes[target] = pixels[source + 2]
    bytes[target + 1] = pixels[source + 1]
    bytes[target + 2] = pixels[source]
  }
  return bytes
}
async function main() {
  require('./build-setup-ui.cjs')()
  const sharp = require('sharp')
  await fs.mkdir(output, { recursive: true })
  for (const [name, width, height] of [['sidebar', 164, 314], ['header', 150, 57]]) {
    const source = path.join(root, 'build', 'installer', name + '.svg')
    const image = sharp(source).resize(width, height).flatten({ background: '#080b0c' }).removeAlpha().toColourspace('srgb')
    const pixels = await image.clone().raw().toBuffer()
    await fs.writeFile(path.join(output, name + '.bmp'), bitmap24(pixels, width, height))
    await image.png().toFile(path.join(output, name + '.png'))
  }
  await sharp(path.join(root, 'build', 'installer', 'dmg.svg')).png().toFile(path.join(output, 'dmg.png'))
  console.log('[installer] NSIS bitmaps and macOS DMG background generated')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { main, bitmap24 }
