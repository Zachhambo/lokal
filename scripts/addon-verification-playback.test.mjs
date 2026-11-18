import test from 'node:test'
import assert from 'node:assert/strict'
import { addonPlaybackOutputKey } from '../src/audio/addonPlaybackOutputKey.mjs'

test('addon verification metadata does not reload an existing audio source', () => {
  const provider = 'a-test'
  const playing = { [provider]: { nativeSpatialPreferred: false, authenticated: false } }
  const before = addonPlaybackOutputKey(provider, playing)
  const verified = { [provider]: { nativeSpatialPreferred: false, authenticated: true, verified: true } }
  assert.equal(addonPlaybackOutputKey(provider, verified), before)
  assert.equal(addonPlaybackOutputKey(provider, { ...verified, 'a-other': { nativeSpatialPreferred: true } }), before)
  assert.equal(addonPlaybackOutputKey(provider, null), before)
})

test('changing current addon audio mode still reloads its output', () => {
  const provider = 'a-test'
  const stereo = addonPlaybackOutputKey(provider, { [provider]: { nativeSpatialPreferred: false } })
  const atmos = addonPlaybackOutputKey(provider, { [provider]: { nativeSpatialPreferred: true, nativeSpatialCodec: 'eac3' } })
  const ac4 = addonPlaybackOutputKey(provider, { [provider]: { nativeSpatialPreferred: true, nativeSpatialCodec: 'ac4' } })
  assert.notEqual(stereo, atmos)
  assert.notEqual(atmos, ac4)
  assert.equal(addonPlaybackOutputKey('yt', {}), '')
})

import { openAddonVerification } from '../src/audio/addonVerification.mjs'

function verificationFixture(verify) {
  const pending = { key: 'test' }
  let current = pending
  const messages = [], busy = [], completed = [], changes = []
  const options = {
    getPending: () => current, verify,
    complete: async key => { completed.push(key); current = null },
    changed: () => changes.push(true),
    setBusy: value => busy.push(value),
    setMessage: value => messages.push(value),
  }
  return { pending, options, messages, busy, completed, changes,
    replace: value => { current = value } }
}

test('verification opens immediately and duplicate starts share the pending request', async () => {
  let finish, calls = 0
  const fixture = verificationFixture(key => {
    assert.equal(key, 'test')
    calls++
    return new Promise(resolve => { finish = resolve })
  })
  const running = openAddonVerification(fixture.pending, fixture.options)
  assert.equal(calls, 1)
  assert.equal(fixture.pending.verificationStarted, true)
  await openAddonVerification(fixture.pending, fixture.options)
  assert.equal(calls, 1)
  finish({ opened: true })
  await running
  assert.deepEqual(fixture.messages, [''])
  assert.deepEqual(fixture.completed, [])
  assert.deepEqual(fixture.busy, [true, false])
})

test('already verified access resumes the interrupted action without a prompt', async () => {
  const fixture = verificationFixture(async () => ({ authenticated: true }))
  await openAddonVerification(fixture.pending, fixture.options)
  assert.deepEqual(fixture.completed, ['test'])
  assert.deepEqual(fixture.changes, [true])
  assert.deepEqual(fixture.messages, [''])
  assert.equal(fixture.busy.at(-1), false)
})

test('failed verification exposes recovery and permits an explicit retry', async () => {
  const fixture = verificationFixture(async () => { throw new Error('Browser unavailable') })
  await openAddonVerification(fixture.pending, fixture.options)
  assert.equal(fixture.messages.at(-1), 'Browser unavailable')
  fixture.options.verify = async () => ({ opened: true })
  await openAddonVerification(fixture.pending, fixture.options)
  assert.equal(fixture.messages.at(-1), '')
  assert.equal(fixture.pending.verifying, false)
})

test('a declined verification request reports its error', async () => {
  const fixture = verificationFixture(async () => ({ error: 'Verification cancelled' }))
  await openAddonVerification(fixture.pending, fixture.options)
  assert.equal(fixture.messages.at(-1), 'Verification cancelled')
  assert.deepEqual(fixture.completed, [])
})

test('late results cannot resume or replace the error of a newer selection', async () => {
  let finish
  const fixture = verificationFixture(() => new Promise(resolve => { finish = resolve }))
  const running = openAddonVerification(fixture.pending, fixture.options)
  fixture.replace({ key: 'other' })
  finish({ authenticated: true })
  await running
  assert.deepEqual(fixture.completed, [])
  assert.deepEqual(fixture.changes, [])
  assert.deepEqual(fixture.busy, [true])
  assert.deepEqual(fixture.messages, [''])
})
