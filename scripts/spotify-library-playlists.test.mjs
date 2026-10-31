import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { libraryPlaylists } = require('../electron/artwork/spotify.js')
const A = 'A'.repeat(22), B = 'B'.repeat(22)
const item = (id, name, kind = 'PlaylistResponseWrapper') => ({
  item: {
    __typename: kind,
    _uri: `spotify:playlist:${id}`,
    data: {
      __typename: 'Playlist', name,
      ownerV2: { data: { name: 'Listener' } },
      content: { totalCount: 23 },
      images: { items: [{ sources: [
        { url: 'https://i.scdn.co/low', width: 100 },
        { url: 'https://i.scdn.co/high', width: 640 },
      ] }] },
    },
  },
})

test('library playlists use flattened libraryV3 and keep nested/collaborative items', async () => {
  const seen = []
  const playlists = await libraryPlaylists('', {
    limit: 3, pageSize: 2,
    fetchPage: async url => {
      const variables = JSON.parse(new URL(url).searchParams.get('variables'))
      seen.push(variables)
      if (variables.offset === 0) return { data: { me: { libraryV3: {
        totalCount: 3, items: [
          item(A, 'Saved in a folder'),
          { item: { __typename: 'FolderResponseWrapper' } },
        ],
      } } } }
      return { data: { me: { libraryV3: {
        totalCount: 3, items: [item(B, 'Collaborative', 'CollaborativePlaylistResponseWrapper')],
      } } } }
    },
  })
  assert.deepEqual(seen.map(x => x.offset), [0, 2])
  assert.ok(seen.every(x => x.flatten === true && x.filters[0] === 'Playlists'))
  assert.deepEqual(playlists.map(x => x.id), [A, B])
  assert.equal(playlists[0].thumbnail, 'https://i.scdn.co/high')
  assert.equal(playlists[1].name, 'Collaborative')
})

test('library read failures are not misrepresented as empty playlists', async () => {
  await assert.rejects(
    () => libraryPlaylists('', { fetchPage: async () => ({ data: { me: null }, errors: [{ message: 'Session lost' }] }) }),
    /Session lost/,
  )
})
