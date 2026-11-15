import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { globalArtistDestination } from '../src/globalArtistNavigation.mjs'

const source = readFileSync(new URL('../src/artistPortraitLookup.js', import.meta.url), 'utf8')

async function isolatedLookup(api) {
  globalThis.artistPortraitTestApi = api
  const transformed = source.replace("import { api } from './api'",
    'const api = globalThis.artistPortraitTestApi')
  return import('data:text/javascript;base64,' +
    Buffer.from(transformed + '\n// ' + Math.random()).toString('base64'))
}

test('Search and follow reuse the same exact-name portrait without duplicate fetches', async () => {
  const queried = []
  const lookup = await isolatedLookup({
    artistSearchMetadata: async (name, options) => {
      queried.push([name, options.source])
      return [
        { title: 'Bones & Beeker', imageUrl: 'https://images.example/mismatch.jpg' },
        { title: 'BONES', imageUrl: 'https://images.example/bones.jpg' },
      ]
    },
  })
  const first = await lookup.resolveSearchArtistPortrait('Bones')
  assert.equal(first, 'https://images.example/bones.jpg')
  assert.equal(lookup.peekSearchArtistPortrait('bones'), first)
  assert.equal(await lookup.resolveSearchArtistPortrait('BONES'), first)
  assert.deepEqual(queried, [['Bones', 'deezer']])
})

test('name lookup cannot attribute a partial namesake or an insecure image', async () => {
  const lookup = await isolatedLookup({
    artistSearchMetadata: async () => [
      { title: 'Bones & Beeker', imageUrl: 'https://images.example/mismatch.jpg' },
      { title: 'Bones', imageUrl: 'http://images.example/unsafe.jpg' },
    ],
  })
  assert.equal(await lookup.resolveSearchArtistPortrait('BONES'), '')
})

test('Global Search forwards explicit portrait provenance distinct from saved follows', () => {
  const base = { catalogue: 'apple', catalogue_id: '200', title: 'Bones',
    artwork_url: 'https://images.example/bones.jpg' }
  const search = globalArtistDestination(base)
  const saved = globalArtistDestination({ ...base, portraitSource: 'followed' })
  assert.equal(search.state.artistPortrait, 'https://images.example/bones.jpg')
  assert.equal(search.state.artistPortraitSource, 'search')
  assert.equal(saved.state.artistPortraitSource, 'followed')
  assert.equal(search.search, saved.search)
})

test('Search, Follow, Artists and detail all consume the same portrait resolver', () => {
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const search = read('src/components/SearchArtistPortrait.jsx')
  const follow = read('src/components/FollowArtistButton.jsx')
  const artists = read('src/pages/Artists.jsx')
  const detail = read('src/components/OnlineArtist.jsx')
  const artistPage = read('src/pages/Artist.jsx')
  assert.match(search, /resolveSearchArtistPortrait\(name\)/)
  assert.match(follow, /await resolveSearchArtistPortrait\(name\)/)
  assert.match(artists, /preferNameLookup=\{artist\.catalogue === 'apple'\}/)
  assert.match(artists, /peekSearchArtistPortrait\(artist\.name\)/)
  assert.match(detail, /resolveSearchArtistPortrait\(lookupName\)/)
  assert.match(detail, /directSearchPortrait \|\|/)
  assert.match(detail, /searchPortrait \|\| portrait \|\| songs\.image/)
  assert.match(artistPage, /portraitSource=\{location\.state\?\.artistPortraitSource \|\| ''\}/)
})
