// Package the production installer design with an isolated, harmless payload.
const fs = require('node:fs/promises')
const path = require('node:path')
const { build, Platform, Arch } = require('electron-builder')
const root = path.resolve(__dirname, '..')
async function main() {
  const mac = process.platform === 'darwin'
  const fixtureRoot = path.join(process.env.RUNNER_TEMP, 'lokal-installer-fixture')
  const fixture = mac ? path.join(fixtureRoot, 'LokalInstallerSmoke.app') : fixtureRoot
  if (mac) {
    await fs.mkdir(path.join(fixture, 'Contents', 'MacOS'), { recursive: true })
    await fs.mkdir(path.join(fixture, 'Contents', 'Resources'), { recursive: true })
    await fs.writeFile(path.join(fixture, 'Contents', 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>LokalInstallerSmoke</string><key>CFBundleIdentifier</key><string>com.lokal.installer-smoke</string><key>CFBundleName</key><string>LokalInstallerSmoke</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0.0</string></dict></plist>')
    const executable = path.join(fixture, 'Contents', 'MacOS', 'LokalInstallerSmoke')
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n')
    await fs.chmod(executable, 0o755)
  } else {
    await fs.mkdir(path.join(fixture, 'resources'), { recursive: true })
    await fs.writeFile(path.join(fixture, 'LokalInstallerSmoke.exe'), 'Packaging fixture; not an application.')
  }
  const { build: config } = require('../package.json')
  await build({
    targets: mac ? Platform.MAC.createTarget('dmg', process.arch === 'arm64' ? Arch.arm64 : Arch.x64) : Platform.WINDOWS.createTarget('nsis', Arch.x64),
    prepackaged: fixture, publish: 'never',
    config: {
      ...config, appId: 'com.lokal.installer-smoke', productName: 'LokalInstallerSmoke',
      directories: { ...config.directories, output: path.join(root, 'installer-test-output') },
      win: { ...config.win, target: ['nsis'], signAndEditExecutable: false },
      mac: { ...config.mac, identity: null, notarize: false },
      nsis: { ...config.nsis, runAfterFinish: false },
    },
  })
  const files = await fs.readdir(path.join(root, 'installer-test-output'))
  if (!files.some(file => file.endsWith(mac ? '.dmg' : '.exe') && !file.includes('__uninstaller'))) throw new Error('No installer was produced')
}
main().catch(error => { console.error(error); process.exit(1) })
