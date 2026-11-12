// Cast and desktop linking share one socket per usable LAN interface.
const { EventEmitter } = require('events')
const { lanInterfaces } = require('./lanInterfaces')

function createMdnsPool({ interfaces = () => lanInterfaces(), mdns = options => require('multicast-dns')(options) } = {}) {
  const events = new EventEmitter()
  const sockets = new Map()
  let users = 0
  let timer
  const forward = (event, ...args) => {
    if (event !== 'error' || events.listenerCount('error')) events.emit(event, ...args)
  }
  function closeSocket(socket) {
    try { socket.destroy() } catch (error) { forward('warning', error) }
  }
  function refresh() {
    let addresses
    try { addresses = new Set(interfaces().map(entry => entry.address)) }
    catch (error) { forward('warning', error); return }
    for (const [address, socket] of sockets) {
      if (!addresses.has(address)) { sockets.delete(address); closeSocket(socket) }
    }
    for (const address of addresses) {
      if (sockets.has(address)) continue
      try {
        // Wildcard reception, explicit membership/outgoing multicast route.
        const socket = mdns({ interface: address, bind: '0.0.0.0' })
        sockets.set(address, socket)
        for (const event of ['query', 'response', 'packet', 'warning', 'error', 'ready', 'networkInterface']) {
          socket.on(event, (...args) => {
            if (sockets.get(address) !== socket) return
            if (event === 'error') { sockets.delete(address); closeSocket(socket) }
            forward(event, ...args)
          })
        }
      } catch (error) { forward('warning', error) }
    }
  }
  return function acquire() {
    if (++users === 1) { refresh(); timer = setInterval(refresh, 5000); timer.unref?.() }
    const listeners = []
    let closed = false
    return {
      on(event, listener) { if (!closed) { events.on(event, listener); listeners.push([event, listener]) } return this },
      query(packet) {
        if (closed) return
        refresh()
        for (const socket of sockets.values()) socket.query(packet)
      },
      respond(packet) {
        if (closed) return
        refresh()
        for (const [address, socket] of sockets) {
          // Do not advertise an Ethernet address to a phone on a separate
          // Wi-Fi subnet: DNS answer order is not an interface preference.
          const records = values => values?.filter(record => record.type !== 'A' || record.data === address)
          socket.respond({ ...packet, answers: records(packet.answers), additionals: records(packet.additionals) })
        }
      },
      destroy() {
        if (closed) return
        closed = true
        for (const [event, listener] of listeners) events.removeListener(event, listener)
        if (--users === 0) {
          clearInterval(timer)
          const remaining = [...sockets.values()]
          sockets.clear()
          for (const socket of remaining) closeSocket(socket)
        }
      },
    }
  }
}

module.exports = { acquireMdns: createMdnsPool(), createMdnsPool }
