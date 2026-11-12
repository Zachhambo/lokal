const os = require('os')
const { acquireMdns } = require('../network/mdns')
const { lanInterfaces } = require('../network/lanInterfaces')
const SERVICE = '_lokal._tcp.local'
function advertise({ id, port, name = os.hostname(), version }, { mdnsFactory = acquireMdns, interfaces = lanInterfaces } = {}) {
  const mdns = mdnsFactory()
  const instance = `${id}.${SERVICE}`, host = `lokal-${id}.local`
  const records = ttl => {
    const answers = [
      { name: SERVICE, type: 'PTR', ttl, data: instance },
      { name: instance, type: 'SRV', ttl, data: { port, target: host, priority: 0, weight: 0 } },
      { name: instance, type: 'TXT', ttl, data: [`id=${id}`, `name=${name}`, `v=${version}`, 'proto=1'].map(value => Buffer.from(value)) },
    ]
    for (const entry of interfaces()) answers.push({ name: host, type: 'A', ttl, data: entry.address })
    return answers
  }
  mdns.on('query', packet => { if (packet.questions?.some(q => [SERVICE,instance,host].includes(q.name))) mdns.respond({ answers: records(120) }) })
  mdns.on('error', () => {})
  mdns.respond({ answers: records(120) })
  const timer = setInterval(() => mdns.respond({ answers: records(120) }), 60000)
  timer.unref?.()
  return () => { clearInterval(timer); try { mdns.respond({ answers: records(0) }) } finally { mdns.destroy() } }
}
// Discovery belongs to the paired desktop, not the renderer's current profile.
// Restart its lease after Phone Remote is toggled back on.
function reconcileDiscovery({ enabled, paired, stop, start }) {
  if (!enabled) { stop?.(); return undefined }
  return stop || (paired ? start() : undefined)
}
module.exports = { advertise, reconcileDiscovery }
