import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { LinkStore } = require('../electron/link/store')
const phone = 'phone_names_123', user = 'owner'
function open(path = ':memory:') {
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, uuid TEXT)')
  return {db, store: new LinkStore(db)}
}
function pair(store, name = 'Lokal phone', owner = user) {
  const {code} = store.createPairing(owner)
  return store.pair({code, deviceId: phone, deviceName: name}, '127.0.0.1')
}

test('a reported name updates existing pairings without replacing their credentials', () => {
  const {db, store} = open()
  try {
    const {token} = pair(store)
    assert.equal(store.updateDeviceName(phone, user, '  Pixel Tablet\n '), true)
    assert.equal(store.devices(user)[0].name, 'Pixel Tablet')
    assert.equal(store.authenticate(token).id, phone)
    for (const invalid of [undefined, null, {}, '', '\n\u0000']) {
      assert.equal(store.updateDeviceName(phone, user, invalid), false)
      assert.equal(store.devices(user)[0].name, 'Pixel Tablet')
    }
    store.updateDeviceName(phone, user, '📱'.repeat(101))
    assert.equal(store.devices(user)[0].name, '📱'.repeat(100))
  } finally { db.close() }
})

test('a desktop label survives reconnect, desktop restart, and a same-owner re-pair', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lokal-device-names-'))
  const path = join(directory, 'link.db')
  let {db, store} = open(path)
  try {
    pair(store, 'iPad')
    store.renameDevice(phone, user, 'Living room iPad')
    store.updateDeviceName(phone, user, 'iPad Pro')
    assert.equal(store.devices(user)[0].name, 'Living room iPad')
    assert.equal(store.devices(user)[0].reportedName, 'iPad Pro')
    db.close(); ({db, store} = open(path))
    assert.equal(store.devices(user)[0].name, 'Living room iPad')
    pair(store, 'New iPad')
    assert.equal(store.devices(user)[0].name, 'Living room iPad')
    store.renameDevice(phone, user, '')
    assert.equal(store.devices(user)[0].name, 'New iPad')
    assert.equal(store.devices(user)[0].customName, '')
  } finally { db.close(); rmSync(directory, {recursive:true, force:true}) }
})

test('renaming is scoped to the active profile and revoked devices cannot update', () => {
  const {db, store} = open()
  try {
    pair(store, 'Galaxy Tab')
    assert.equal(store.renameDevice(phone, 'other-profile', 'Wrong'), false)
    assert.equal(store.updateDeviceName(phone, 'other-profile', 'Wrong'), false)
    assert.equal(store.devices(user)[0].name, 'Galaxy Tab')
    assert.throws(() => store.renameDevice(phone, user, {}), {status:400})
    assert.throws(() => store.renameDevice(phone, user, 'a'.repeat(101)), {status:400})
    store.revoke(phone, user)
    assert.equal(store.renameDevice(phone, user, 'Wrong'), false)
    assert.equal(store.updateDeviceName(phone, user, 'Wrong'), false)
  } finally { db.close() }
})

test('re-pairing under another profile clears the previous owner’s desktop label', () => {
  const {db, store} = open()
  try {
    pair(store, 'iPhone')
    store.renameDevice(phone, user, 'Personal phone')
    pair(store, 'iPhone', 'new-owner')
    assert.deepEqual(store.devices(user), [])
    assert.equal(store.devices('new-owner')[0].name, 'iPhone')
    assert.equal(store.devices('new-owner')[0].customName, '')
  } finally { db.close() }
})

test('legacy device-table migration retains the original token, identity and name', () => {
  const {db, store} = open()
  try {
    const {token} = pair(store, 'Existing phone')
    const id = store.deviceId
    db.exec('ALTER TABLE remote_devices DROP COLUMN custom_name')
    const upgraded = new LinkStore(db)
    assert.equal(upgraded.deviceId, id)
    assert.equal(upgraded.devices(user)[0].name, 'Existing phone')
    assert.equal(upgraded.authenticate(token).id, phone)
    upgraded.renameDevice(phone, user, 'Renamed offline')
    assert.equal(upgraded.devices(user)[0].name, 'Renamed offline')
  } finally { db.close() }
})
