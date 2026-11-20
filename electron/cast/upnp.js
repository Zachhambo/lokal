const { EventEmitter } = require('events')
const { escapeXml, parseXml, nodes, value, timestamp } = require('./upnpXml')
const TYPES = ['urn:schemas-upnp-org:device:MediaRenderer:1', 'urn:schemas-upnp-org:device:ZonePlayer:1']
const AV = 'urn:schemas-upnp-org:service:AVTransport:1'
const RC = 'urn:schemas-upnp-org:service:RenderingControl:1'
const ZG = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1'
const GROUP_RC = 'urn:schemas-upnp-org:service:GroupRenderingControl:1'

function lanUrl(input, base) {
  const url = new URL(input, base)
  // Descriptions may advertise URLs on other LAN interfaces, never credentials
  // or non-HTTP protocols. Playback media itself is served by Lokal's server.
  const octets = url.hostname.split('.').map(Number)
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && octets.every(n => n >= 0 && n <= 255)
  const privateHost = ipv4 && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 ||
    octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 169 && octets[1] === 254)
  if (url.protocol !== 'http:' || url.username || url.password || !privateHost) throw new Error('Unsupported receiver address')
  return url.href
}
async function request(url, options = {}, fetchImpl = fetch) {
  url = lanUrl(url)
  const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) })
  const text = await response.text()
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Receiver response too large')
  const doc = parseXml(text)
  if (!response.ok || nodes(doc, 'Fault').length) throw new Error(value(doc, 'errorDescription') || `Receiver HTTP ${response.status}`)
  return doc
}
async function soap(url, type, action, args = {}, fetchImpl = fetch) {
  return request(url, {
    method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${type}#${action}"` },
    body: '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
      `<u:${action} xmlns:u="${type}">` + Object.entries(args).map(([key, val]) => `<${key}>${escapeXml(val)}</${key}>`).join('') + `</u:${action}></s:Body></s:Envelope>`,
  }, fetchImpl)
}
async function speakerArtwork(controlUrl, mediaUrl, fetchImpl = fetch) {
  try {
    const url = new URL('/getaa', lanUrl(controlUrl))
    url.searchParams.set('u', mediaUrl)
    const response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(800) })
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    await response.body?.cancel()
    if (response.status === 200 && ['image/jpeg', 'image/png'].includes(type)) return url.pathname + url.search
  } catch {} // Missing embedded cover or unsupported extraction.
  return null
}
async function describe(location, fetchImpl = fetch) {
  location = lanUrl(location)
  const doc = await request(location, {}, fetchImpl)
  const device = nodes(doc, 'device').find(d => /MediaRenderer|ZonePlayer/.test(d.children.find(x => x.name === 'deviceType')?.text || ''))
  if (!device) return null
  const services = {}
  const base = value(doc, 'URLBase') || location
  for (const svc of nodes(device, 'service')) {
    const type = value(svc, 'serviceType')
    const name = type.split(':').at(-2)
    if (name && value(svc, 'controlURL')) services[name] = { type, url: lanUrl(value(svc, 'controlURL'), base) }
  }
  if (!services.AVTransport) return null
  const sonos = /sonos/i.test(value(device, 'manufacturer')) || !!services.ZoneGroupTopology
  return { id: `upnp:${value(device, 'UDN') || location}`, uuid: value(device, 'UDN').replace(/^uuid:/, ''), name: value(device, 'roomName') || value(device, 'friendlyName') || new URL(location).hostname,
    model: value(device, 'modelName'), host: new URL(location).hostname, kind: 'speaker', backend: 'upnp', sonos, location, services }
}

// Resolves a selected room to its current group coordinator without regrouping.
async function coordinator(device, fetchImpl = fetch) {
  if (!device.sonos || !device.services.ZoneGroupTopology) return device
  const svc = device.services.ZoneGroupTopology
  const result = await soap(svc.url, svc.type || ZG, 'GetZoneGroupState', {}, fetchImpl)
  const doc = parseXml(value(result, 'ZoneGroupState'))
  const group = nodes(doc, 'ZoneGroup').find(g => nodes(g, 'ZoneGroupMember').some(m => m.attrs.UUID === device.uuid))
  const members = group && nodes(group, 'ZoneGroupMember')
  const master = members?.find(m => m.attrs.UUID === group.attrs.Coordinator)
  if (!master) throw new Error('The Sonos room has no reachable group coordinator')
  const target = master.attrs.UUID === device.uuid ? device : await describe(master.attrs.Location, fetchImpl)
  if (!target) throw new Error('The Sonos coordinator could not be resolved')
  return { ...target, id: device.id, name: members.length > 1 ? `${device.name} (${members.length} rooms)` : device.name, kind: members.length > 1 ? 'group' : 'speaker' }
}

class UpnpDiscovery extends EventEmitter {
  constructor({ log = () => {}, fetchImpl = fetch, createSocket = () => require('dgram').createSocket({ type: 'udp4', reuseAddr: true }) } = {}) {
    super(); this.log = log; this.fetch = fetchImpl; this.createSocket = createSocket; this.devices = new Map(); this.pending = new Set()
  }
  scan() {
    if (!this.socket) {
      this.socket = this.createSocket()
      this.socket.on('error', error => this.log(`UPnP discovery: ${error.message}`))
      this.socket.on('message', data => this.onMessage(data))
      this.socket.bind(0, () => this.ask())
    } else this.ask()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { try { this.socket?.close() } catch {} this.socket = null }, 4500)
    this.timer.unref?.()
  }
  ask() {
    for (const type of TYPES) {
      const query = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${type}\r\n\r\n`)
      try { this.socket.send(query, 1900, '239.255.255.250') } catch {}
    }
  }
  async onMessage(data) {
    const location = String(data).match(/^location\s*:\s*(.+)$/im)?.[1]?.trim()
    if (!location || this.pending.has(location)) return
    this.pending.add(location)
    try { const device = await describe(location, this.fetch); if (device) { this.devices.set(device.id, { device, at: Date.now() }); this.emit('change', this.list()) } } catch (error) { this.log(`UPnP: ${error.message}`) }
    finally { this.pending.delete(location) }
  }
  list() { return [...this.devices.values()].filter(x => Date.now() - x.at < 240000).map(x => x.device) }
  get(id) { return this.list().find(d => d.id === id) }
  stop() { clearTimeout(this.timer); try { this.socket?.close() } catch {} this.socket = null }
}
const seconds = time => { const p = String(time).split(':').map(Number); return p.length === 3 && p.every(Number.isFinite) ? p[0] * 3600 + p[1] * 60 + p[2] : 0 }
module.exports = { UpnpDiscovery, describe, coordinator, soap, speakerArtwork, AV, RC, GROUP_RC, seconds, timestamp, TYPES }
