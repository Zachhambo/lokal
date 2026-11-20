// Bounded XML reader for device descriptions and SOAP (no DTD or entities).
const escapeXml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
const decodeXml = value => String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, key) => {
  if (key[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key] ?? all
  const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1))
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
})
function parseXml(source) {
  if (Buffer.byteLength(source) > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Unsupported receiver XML')
  const root = { name: '', attrs: {}, children: [], text: '' }
  const stack = [root]
  for (const match of source.matchAll(/<!--[\s\S]*?-->|<\?[^>]*\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<([^>]+)>|([^<]+)/g)) {
    const parent = stack.at(-1)
    if (match[1] != null) { parent.text += match[1]; continue }
    if (match[3]) { parent.text += decodeXml(match[3]); continue }
    const tag = match[2]
    if (!tag) continue
    if (tag.startsWith('/')) { if (stack.length < 2 || stack.at(-1).tag !== tag.slice(1).trim()) throw new Error('Malformed receiver XML'); stack.pop(); continue }
    const name = tag.match(/^([^\s/]+)/)?.[1]
    if (!name || name.startsWith('!')) throw new Error('Malformed receiver XML')
    const node = { tag: name, name: name.split(':').at(-1), attrs: {}, children: [], text: '' }
    for (const attr of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[attr[1]] = decodeXml(attr[2] ?? attr[3])
    parent.children.push(node)
    if (!tag.endsWith('/')) { if (stack.length > 64) throw new Error('Receiver XML too deep'); stack.push(node) }
  }
  if (stack.length !== 1) throw new Error('Incomplete receiver XML')
  return root
}
function nodes(node, name) { return node.children.flatMap(child => [...(child.name === name ? [child] : []), ...nodes(child, name)]) }
function value(node, name) { return nodes(node, name)[0]?.text || '' }
const timestamp = seconds => {
  const n = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(x => String(x).padStart(2, '0')).join(':')
}
function didl(item, { sonosQueueId } = {}) {
  const sonos = sonosQueueId != null
  const duration = sonos && Number.isFinite(item.duration) && item.duration >= 1
    ? ` duration="${timestamp(item.duration)}"` : ''
  return '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    `<item id="${escapeXml(sonosQueueId ?? item.trackId)}" parentID="0" restricted="1"><dc:title>${escapeXml(item.metadata?.title)}</dc:title>` +
    (sonos ? `<dc:creator>${escapeXml(item.metadata?.artist)}</dc:creator>` : '') +
    `<upnp:class>object.item.audioItem.musicTrack</upnp:class><upnp:artist>${escapeXml(item.metadata?.artist)}</upnp:artist><upnp:album>${escapeXml(item.metadata?.albumName)}</upnp:album>` +
    (item.metadata?.images?.[0]?.url ? `<upnp:albumArtURI>${escapeXml(item.metadata.images[0].url)}</upnp:albumArtURI>` : '') +
    `<res protocolInfo="http-get:*:${escapeXml(item.mime)}:*"${duration}>${escapeXml(item.url)}</res>` +
    (sonos ? '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">RINCON_AssociatedZPUDN</desc>' : '') +
    '</item></DIDL-Lite>'
}
module.exports = { escapeXml, decodeXml, parseXml, nodes, value, didl, timestamp }
