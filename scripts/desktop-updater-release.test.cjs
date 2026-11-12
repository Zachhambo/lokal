const test = require('node:test')
const assert = require('node:assert/strict')
const semver = require('semver')
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider')

for (const [platform, arch, manifest, extension] of [
  ['win32', 'x64', 'latest.yml', '.exe'],
  ['darwin', 'arm64', 'latest-mac.yml', '-arm64-mac.zip'],
  ['darwin', 'x64', 'latest-mac.yml', '-mac.zip'],
  ['linux', 'x64', 'latest-linux.yml', '.AppImage'],
  ['linux', 'arm64', 'latest-linux-arm64.yml', '-arm64.AppImage'],
]) {
  test(`shipped updater follows rolling desktop release on ${platform}/${arch}`, async () => {
    const previousArch = process.env.TEST_UPDATER_ARCH
    process.env.TEST_UPDATER_ARCH = arch
    try {
      const updater = { allowPrerelease: false, currentVersion: semver.parse('14.3.0'), fullChangelog: false }
      const provider = new GitHubProvider({ owner: 'lokal-music', repo: 'desktop' }, updater, { platform, executor: {} })
      const filename = `Lokal-14.3.1${extension}`
      const requests = []
      provider.httpRequest = async url => {
        requests.push(url.pathname)
        if (url.pathname.endsWith('.atom')) return `<feed><entry><title>Desktop — 14.3.1</title><link href="https://github.com/lokal-music/desktop/releases/tag/desktop"/><content>Release notes</content></entry></feed>`
        if (url.pathname.endsWith('/latest')) return JSON.stringify({ tag_name: 'desktop' })
        assert.equal(url.pathname, `/lokal-music/desktop/releases/download/desktop/${manifest}`)
        return `version: 14.3.1\nfiles:\n  - url: ${filename}\n    sha512: ${Buffer.alloc(64, 1).toString('base64')}\n    size: 42\npath: ${filename}\nsha512: ${Buffer.alloc(64, 1).toString('base64')}\n`
      }
      provider.executor.request = async options => provider.httpRequest(new URL(options.path, `https://${options.hostname}`))
      const info = await provider.getLatestVersion()
      assert.equal(info.version, '14.3.1')
      assert.equal(info.tag, 'desktop')
      assert.ok(semver.gt(info.version, updater.currentVersion))
      const [download] = provider.resolveFiles(info)
      assert.equal(download.url.pathname, `/lokal-music/desktop/releases/download/desktop/${filename}`)
      assert.equal(requests.length, 3)
    } finally {
      if (previousArch === undefined) delete process.env.TEST_UPDATER_ARCH
      else process.env.TEST_UPDATER_ARCH = previousArch
    }
  })
}
