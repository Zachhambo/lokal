import assert from 'node:assert/strict'
import { test } from 'node:test'

function makeStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

test('sidebar tab selection is restored and saved', async () => {
  const storage = makeStorage()
  storage.setItem('lokal-side-panel-view', 'queue')
  globalThis.localStorage = storage

  const { usePlayerStore } = await import(`../src/store/player.js?side-panel-${Date.now()}`)

  assert.equal(usePlayerStore.getState().sidePanelView, 'queue')

  usePlayerStore.getState().setSidePanelView('lyrics')
  assert.equal(storage.getItem('lokal-side-panel-view'), 'lyrics')
  assert.equal(usePlayerStore.getState().sidePanelView, 'lyrics')

  delete globalThis.localStorage
})
