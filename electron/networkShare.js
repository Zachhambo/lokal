'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

function resolveNetworkLibraryLocation(value, platform = process.platform) {
  const input = String(value || '').trim()
  if (!input || input.includes('\0')) {
    throw new Error('Enter an SMB share or an existing mounted network folder.')
  }
  if (/^smb:\/\//i.test(input)) {
    // WHATWG URL would otherwise normalize away ../ before validation.
    if (/\/(?:\.{1,2}|%2e(?:%2e|\.)?|\.%2e)(?:\/|$)/i.test(input)) {
      throw new Error('Specify a valid share name and path without traversal.')
    }
    if (platform !== 'win32') {
      throw new Error('Mount the SMB share in your file manager, then enter its mounted folder path. Direct smb:// access is available only through Windows UNC shares.')
    }
    let uri
    try { uri = new URL(input) } catch { throw new Error('Invalid SMB URL. Use smb://server/share') }
    if (uri.username || uri.password || uri.search || uri.hash || !uri.hostname) {
      throw new Error('Use smb://server/share without embedded credentials, query or fragment.')
    }
    // Validate the raw URL path as well: URL() normalizes dot segments.
    const rawPath = input.match(/^smb:\/\/[^/]+\/([^?#]*)/i)?.[1] ?? '';
    let parts;
    try {
      parts = rawPath.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    } catch {
      parts = [];
    }
    if (!parts.length || parts.some(part =>
      part === '..' || part === '.' || [0, 47, 58, 92].some(code => part.includes(String.fromCharCode(code))))) {
      throw new Error('Specify a valid share name after the SMB server.')
    }
    if (uri.port) throw new Error('Windows UNC shares use the system SMB port. Remove the custom port.')
    return '\\\\' + uri.hostname + '\\' + parts.join('\\')
  }
  if (input.startsWith('\\\\')) {
    if (platform !== 'win32') throw new Error('Windows UNC paths are only supported on Windows. Use the mounted folder path.')
    const parts = input.slice(2).split('\\').filter(Boolean)
    if (parts.length < 2 || parts.some(part =>
      part === '..' || part === '.' || [0, 47].some(code => part.includes(String.fromCharCode(code))))) {
      throw new Error('Use a complete UNC path such as \\\\nas\\Music.')
    }
    return path.win32.normalize(input)
  }
  if (/^https?:\/\//i.test(input)) {
    if (platform !== 'win32') {
      throw new Error('Mount the WebDAV share with your file manager first, then enter the mounted absolute folder path.')
    }
    let uri
    try { uri = new URL(input) } catch { throw new Error('Invalid WebDAV URL.') }
    if (uri.protocol !== 'https:') {
      throw new Error('Use HTTPS for WebDAV with credentials; HTTP is not supported for automatic import.')
    }
    if (uri.username || uri.password || uri.search || uri.hash) {
      throw new Error('WebDAV URLs must not contain credentials, query or fragment.')
    }
    const raw = input.match(/^https:\/\/[^/]+(?:\/(.*))?$/i)?.[1] ?? ''
    let parts
    try {
      parts = raw.split('/').filter(Boolean).map(segment => decodeURIComponent(segment))
    } catch {
      throw new Error('Malformed percent-encoding in WebDAV path.')
    }
    if (parts.some(segment => segment === '.' || segment === '..' ||
        [0, 47, 58, 92].some(code => segment.includes(String.fromCharCode(code))))) {
      throw new Error('Invalid WebDAV path segment.')
    }
    // Windows WebClient maps HTTPS WebDAV to its virtual UNC filesystem.
    // Keep TLS on and use the configured port, never silently downgrade.
    const server = uri.hostname + '@SSL' +
      (uri.port && uri.port !== '443' ? '@' + uri.port : '')
    return '\\\\' + server + '\\DavWWWRoot' +
      (parts.length ? '\\' + parts.join('\\') : '')
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    throw new Error('Unsupported network URL. Use SMB, HTTPS WebDAV or a mounted folder.')
  }
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (!paths.isAbsolute(input)) {
    throw new Error('Use an absolute, existing mounted directory path.')
  }
  return paths.normalize(input)
}

async function probeNetworkLibraryLocation(value, {
  platform = process.platform,
  stat = fs.stat,
  readdir = fs.readdir,
} = {}) {
  const folder = resolveNetworkLibraryLocation(value, platform)
  let details
  try {
    details = await stat(folder)
  } catch (error) {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new Error('Share access denied. Connect to the NAS with your OS credentials, then retry.')
    }
    throw new Error('Cannot open the network folder. Check the share name, network connection and OS credentials.')
  }
  if (!details.isDirectory()) throw new Error('The network location is not a directory.')
  try {
    await readdir(folder)
  } catch {
    throw new Error('The share exists but this user cannot list files in it.')
  }
  return { folder, type: 'mounted', accessible: true }
}

module.exports = { resolveNetworkLibraryLocation, probeNetworkLibraryLocation }
