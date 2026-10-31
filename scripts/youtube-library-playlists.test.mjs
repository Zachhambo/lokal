import assert from 'node:assert/strict'
import { test } from 'node:test'
import youtube from '../electron/online/youtube.js'

const cookies = 'Cookie: __Secure-3PAPISID=test-session-value; __Secure-3PSID=test-login-value'
const playlist = (id, name, responsive = false) => responsive
  ? { musicResponsiveListItemRenderer: {
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: {
        text: { runs: [{ text: name, navigationEndpoint: { browseEndpoint: {
          browseId: 'VL' + id,
          browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: {
            pageType: 'MUSIC_PAGE_TYPE_PLAYLIST',
          } },
        } } }] },
      } }],
    } }
  : { musicTwoRowItemRenderer: {
      title: { runs: [{ text: name }] },
      navigationEndpoint: { browseEndpoint: { browseId: 'VL' + id } },
    } }

test('saved YouTube Music library follows continuations and excludes generated radios', async () => {
  youtube.clearAccountCache()
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    const request = JSON.parse(options.body)
    requests.push(request)
    const contents = request.continuation
      ? [playlist('PLsaved2', 'Second', true), playlist('PLsaved1', 'Duplicate')]
      : [playlist('PLsaved1', 'First'), playlist('RDpersonal', 'Radio')]
    return { ok: true, json: async () => ({
      responseContext: { mainAppWebResponseContext: { loggedOut: false } },
      contents: { gridRenderer: {
        items: contents,
        ...(request.continuation ? {} : { continuations: [{
          nextContinuationData: { continuation: 'page-two' },
        }] }),
      } },
    }) }
  }
  const saved = await youtube.fetchLibraryPlaylists({ cookies, fetchImpl })
  assert.deepEqual(saved.map(p => p.id), ['PLsaved1', 'PLsaved2'])
  assert.deepEqual(saved.map(p => p.title), ['First', 'Second'])
  assert.ok(requests.every(r => r.browseId === 'FEmusic_liked_playlists'))
  assert.equal(requests.filter(r => r.continuation === 'page-two').length, 1)
})
