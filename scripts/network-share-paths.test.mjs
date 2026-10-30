import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { resolveNetworkLibraryLocation, probeNetworkLibraryLocation } = require('../electron/networkShare.js')

test('Windows SMB URLs map to UNC paths without interpreting URL passwords', () => {
  assert.equal(resolveNetworkLibraryLocation('smb://192.168.8.1/disk1_part1', 'win32'),
    String.fromCharCode(92, 92) + '192.168.8.1' + String.fromCharCode(92) + 'disk1_part1')
  assert.equal(resolveNetworkLibraryLocation('smb://nas/My%20Music/Albums', 'win32'),
    String.fromCharCode(92, 92) + 'nas' + String.fromCharCode(92) + 'My Music' + String.fromCharCode(92) + 'Albums')
  assert.throws(() => resolveNetworkLibraryLocation('smb://user:secret@nas/share', 'win32'), /without embedded credentials/)
  assert.throws(() => resolveNetworkLibraryLocation('smb://nas/', 'win32'), /valid share name/)
  assert.throws(() => resolveNetworkLibraryLocation('smb://nas/share/../other', 'win32'), /valid share name/)
})

test('Windows GL.iNet WebDAV uses HTTPS WebClient with custom port', () => {
  const actual = resolveNetworkLibraryLocation(
    'https://192.168.8.1:6008/disk1_part1', 'win32')
  const expected = String.fromCharCode(92, 92) +
      '192.168.8.1@SSL@6008' + String.fromCharCode(92) +
      'DavWWWRoot' + String.fromCharCode(92) + 'disk1_part1'
  assert.equal(actual, expected)
  assert.equal(resolveNetworkLibraryLocation(
    'https://nas.example/dav/My%20Music', 'win32'),
    String.fromCharCode(92, 92) + 'nas.example@SSL' +
      String.fromCharCode(92) + 'DavWWWRoot' +
      String.fromCharCode(92) + 'dav' +
      String.fromCharCode(92) + 'My Music')
  assert.throws(() => resolveNetworkLibraryLocation(
    'http://nas.example/dav', 'win32'), /HTTPS/)
  assert.throws(() => resolveNetworkLibraryLocation(
    'https://user:secret@nas.example/dav', 'win32'), /must not contain credentials/)
  assert.throws(() => resolveNetworkLibraryLocation(
    'https://nas.example/dav/%2e%2e/private', 'win32'), /Invalid WebDAV path segment/)
})

test('non-Windows only accepts mounted absolute paths', () => {
  assert.equal(resolveNetworkLibraryLocation('/mnt/nas/Music', 'linux'), '/mnt/nas/Music')
  assert.throws(() => resolveNetworkLibraryLocation('smb://nas/Music', 'linux'), /Mount/)
  assert.throws(() => resolveNetworkLibraryLocation('https://nas.example/dav', 'linux'), /Mount WebDAV/)
  assert.throws(() => resolveNetworkLibraryLocation('Downloads', 'linux'), /absolute/)
})

test('probe confirms directory read rights before import', async () => {
  const ok = await probeNetworkLibraryLocation('/mnt/music', {
    platform: 'linux', stat: async () => ({ isDirectory: () => true }),
    readdir: async () => ['song.flac'],
  })
  assert.equal(ok.folder, '/mnt/music')
  await assert.rejects(() => probeNetworkLibraryLocation('/mnt/music', {
    platform: 'linux', stat: async () => ({ isDirectory: () => true }),
    readdir: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) },
  }), /cannot list/)
  await assert.rejects(() => probeNetworkLibraryLocation('/mnt/music', {
    platform: 'linux', stat: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) },
  }), /Share access denied/)
})
