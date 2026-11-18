const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { bitmap24 } = require('./generate-installer-assets.cjs')
const root = path.resolve(__dirname, '..')
test('NSIS bitmap encoder writes bottom-up BGR rows with padding', () => {
  const bytes = bitmap24(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), 2, 2)
  assert.equal(bytes.subarray(0, 2).toString(), 'BM')
  assert.equal(bytes.readUInt32LE(2), bytes.length)
  assert.equal(bytes.readUInt32LE(10), 54)
  assert.equal(bytes.readInt32LE(18), 2)
  assert.equal(bytes.readInt32LE(22), 2)
  assert.equal(bytes.readUInt16LE(28), 24)
  assert.deepEqual([...bytes.subarray(54)], [255,0,0,255,255,255,0,0, 0,0,255,0,255,0,0,0])
})
test('generated NSIS images have their required native sizes and no compression', { skip: !fs.existsSync(path.join(root, 'build/installer/generated/sidebar.bmp')) }, () => {
  for (const [name, width, height] of [['sidebar',164,314], ['header',150,57]]) {
    const bytes = fs.readFileSync(path.join(root, 'build/installer/generated', name + '.bmp'))
    assert.equal(bytes.readInt32LE(18), width)
    assert.equal(bytes.readInt32LE(22), height)
    assert.equal(bytes.readUInt32LE(30), 0)
    assert.equal(bytes.readUInt32LE(2), bytes.length)
  }
})
test('DMG artwork fits the configured Finder window and both icon targets', () => {
  const { dmg } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).build
  const svg = fs.readFileSync(path.join(root, 'build/installer/dmg.svg'), 'utf8')
  assert.match(svg, new RegExp('width="' + dmg.window.width + '" height="' + dmg.window.height + '"'))
  assert.equal(dmg.contents.length, 2)
  assert.equal(dmg.contents[1].path, '/Applications')
  for (const icon of dmg.contents) {
    assert.ok(icon.x - dmg.iconSize / 2 > 0 && icon.x + dmg.iconSize / 2 < dmg.window.width)
    assert.ok(icon.y - dmg.iconSize / 2 > 150 && icon.y + dmg.iconSize / 2 < 320)
  }
})
