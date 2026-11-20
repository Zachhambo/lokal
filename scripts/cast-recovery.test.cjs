const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
function fixture(disconnect, connect) {
  const source = fs.readFileSync(path.join(__dirname, '../src/cast/castStore.js'), 'utf8')
    .replace(/^import .*\n/gm, '').replaceAll('export const ', 'const ')
  let state
  const create = init => {
    const set = value => { state = { ...state, ...(typeof value === 'function' ? value(state) : value) } }
    state = init(set, () => state)
    return { getState: () => state, setState: set }
  }
  const api = { castAvailable: () => true, castDisconnect: disconnect, castConnect: connect }
  return new Function('create', 'api', source + '\nreturn useCastStore')(create, api)
}
test('failed Stop preserves the session and its error across routine polls', async () => {
  const store = fixture(async () => ({ error: 'Receiver offline' }))
  store.setState({ status: { state: 'connected' }, session: { at: 1 } })
  await store.getState().disconnect()
  assert.equal(store.getState().ended, null)
  store.getState().setStatus({ state: 'connected' })
  assert.equal(store.getState().error, 'Receiver offline')
  store.getState().setStatus({ state: 'idle' })
  assert.equal(store.getState().error, null)
})
test('explicit abandon releases the receiver with a non-autoplay reason', async () => {
  let options
  const store = fixture(async value => { options = value; return { state: 'connected', position: 25 } })
  store.setState({ status: { state: 'connected' }, session: { at: 1 } })
  await store.getState().leave()
  assert.equal(options.stopReceiver, false)
  assert.equal(store.getState().ended.reason, 'lost')
  assert.equal(store.getState().session, null)
})
test('ordinary confirmed disconnect retains the local-resume reason', async () => {
  const store = fixture(async () => ({ state: 'connected', position: 25 }))
  await store.getState().disconnect()
  assert.equal(store.getState().ended.reason, 'local')
})

test('switching from an unconfirmed receiver requests a paused destination session', async () => {
  const store = fixture(async () => null, async () => ({ previousStopped: false, status: { state: 'connected' } }))
  await store.getState().connect('speaker')
  assert.equal(store.getState().session.paused, true)
})

test('a failed switch detaches the old session and a retry stays paused after an unconfirmed Stop', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/ipc/cast.js'), 'utf8')
  const { EventEmitter } = require('node:events')
  const events = []
  const handlers = new Map()
  const devices = new Map(['old', 'next'].map(id => [id, { id, backend: 'upnp' }]))
  let nextAttempts = 0
  class Discovery extends EventEmitter {
    get(id) { return devices.get(id) }
  }
  class Controller extends EventEmitter {
    status() { return { state: this.connected ? 'connected' : 'idle', device: this.device } }
    async connect(device) {
      this.device = device
      if (device.id === 'next' && ++nextAttempts === 1) throw new Error('Receiver offline')
      this.connected = true
      return { joined: false }
    }
    async disconnect({ stopReceiver }) {
      if (stopReceiver && this.device?.id === 'old') throw new Error('Stop not confirmed')
      this.connected = false
    }
  }
  const modules = {
    '../cast/discovery': { CastDiscovery: Discovery },
    '../cast/upnp': { UpnpDiscovery: Discovery },
    '../cast/upnpController': { UpnpController: Controller },
    '../cast/mediaServer': { createCastMediaServer: () => ({}) },
    '../cast/media': { createCastMedia: () => ({}) },
    './db': { getDB: () => ({ prepare: () => ({ all: () => [], run: () => {} }) }) },
  }
  const mod = { exports: {} }
  new Function('require', 'module', source)(name => modules[name] || {}, mod)
  mod.exports.registerCastHandlers({ handle: (name, handler) => handlers.set(name, handler) }, {
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (channel, payload) => events.push([channel, payload]) },
    }),
  })
  const connect = id => handlers.get('cast:connect')(null, id)
  assert.equal((await connect('old')).previousStopped, true)
  assert.match((await connect('next')).error, /offline/)
  assert.equal(events.find(([channel]) => channel === 'cast:ended')[1].reason, 'lost')
  const retry = await connect('next')
  assert.equal(retry.status.device.id, 'next')
  assert.equal(retry.previousStopped, false)
})
