import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { findFolderArtwork, getLibraryFolders } = require('../electron/libraryFolder.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-library-folders-'))

function likeMatches(value, pattern) {
  const regexSpecials = '.^$*+?()[]{}|\\'
  let expression = ''
  for (let i = 0; i < pattern.length; i++) {
    let character = pattern[i]
    if (character === '\\' && i + 1 < pattern.length) {
      character = pattern[++i]
      expression += regexSpecials.includes(character) ? '\\' + character : character
    } else if (character === '%') {
      expression += '.*'
    } else if (character === '_') {
      expression += '.'
    } else {
      expression += regexSpecials.includes(character) ? '\\' + character : character
    }
  }
  return new RegExp('^' + expression + '$', 'i').test(String(value == null ? '' : value))
}

try {
  const musicRoot = path.join(root, 'music')
  const album = path.join(musicRoot, 'Artist', 'Album')
  const emojiAlbum = path.join(musicRoot, '🎧Artist', 'Album')
  const hiddenEmptyFolder = path.join(musicRoot, '.hidden-empty')
  const hiddenWithTracksFolder = path.join(musicRoot, '.hidden-with-tracks')
  fs.mkdirSync(album, { recursive: true })
  fs.mkdirSync(emojiAlbum, { recursive: true })
  fs.mkdirSync(hiddenEmptyFolder, { recursive: true })
  fs.mkdirSync(hiddenWithTracksFolder, { recursive: true })
  const hiddenTrackPath = path.join(hiddenWithTracksFolder, 'hidden-track.flac')
  fs.writeFileSync(hiddenTrackPath, 'audio')
  fs.writeFileSync(path.join(album, 'a.png'), 'image')
  fs.writeFileSync(path.join(album, 'cover.jpg'), 'cover')
  fs.writeFileSync(path.join(album, '01-track.flac'), 'audio')
  fs.writeFileSync(path.join(album, '02-percent.flac'), 'audio')
  fs.writeFileSync(path.join(album, '03-underscore.flac'), 'audio')

  assert.equal(findFolderArtwork(album), path.join(album, 'cover.jpg'), 'named cover art takes priority over other images')
  fs.unlinkSync(path.join(album, 'cover.jpg'))
  assert.equal(findFolderArtwork(album), path.join(album, 'a.png'), 'an image without a conventional name still works as fallback')

  const embeddedArtworkPath = path.join(root, 'stored-artwork', 'track-cover.jpg')
  fs.mkdirSync(path.dirname(embeddedArtworkPath), { recursive: true })
  fs.writeFileSync(embeddedArtworkPath, 'embedded artwork')
  const indexedTracks = [
    { id: 'track-1', title: 'Track One', artist: 'Artist', album: 'Album', file_path: path.join(album, '01-track.flac'), artwork_path: embeddedArtworkPath },
    { id: 'track-percent', title: 'Literal 100% Track', artist: 'Artist', album: 'Album', file_path: path.join(album, '02-percent.flac') },
    { id: 'track-underscore', title: 'Name_with_underscore', artist: 'Artist', album: 'Album', file_path: path.join(album, '03-underscore.flac') },
    { id: 'hidden-track', title: 'Hidden Track', artist: 'Hidden', album: 'Hidden', file_path: hiddenTrackPath },
    // This row is stale: it must not count or appear in a playable queue.
    { id: 'stale', title: 'Deleted Track', artist: 'Artist', album: 'Album', file_path: path.join(album, 'deleted.flac') },
  ]
  for (let i = 0; i < 1001; i++) {
    const filename = 'bulk-' + String(i).padStart(4, '0') + '.flac'
    const filePath = path.join(emojiAlbum, filename)
    fs.writeFileSync(filePath, 'audio')
    indexedTracks.push({
      id: 'bulk-' + i,
      title: 'Bulk Track ' + i,
      artist: 'Bulk Artist',
      album: 'Large Album',
      file_path: filePath,
      artwork_path: i === 0 ? embeddedArtworkPath : null,
    })
  }

  const isInRange = (filePath, start, end) => filePath >= start && filePath < end
  const db = {
    prepare(sql) {
      if (sql.includes("key = 'music_folder'")) return { get: () => ({ value: musicRoot }) }
      if (sql.includes('SELECT file_path FROM tracks')) {
        return {
          all: (start, end) => indexedTracks
            .filter(track => isInRange(track.file_path, start, end))
            .map(track => ({ file_path: track.file_path }))
            .sort((a, b) => a.file_path.localeCompare(b.file_path)),
        }
      }
      if (sql.includes('FROM tracks WHERE file_path IN (')) {
        return { all: (...paths) => indexedTracks.filter(track => paths.includes(track.file_path)) }
      }
      if (sql.includes('substr(file_path, length(?)+1) LIKE ?')) {
        return {
          all: (start, end, titlePattern, artistPattern, albumPattern, pathPrefix, pathPattern) =>
            indexedTracks.filter(track =>
              isInRange(track.file_path, start, end) &&
              (likeMatches(track.title, titlePattern) ||
                likeMatches(track.artist, artistPattern) ||
                likeMatches(track.album, albumPattern) ||
                likeMatches(track.file_path.slice(pathPrefix.length), pathPattern))),
        }
      }
      throw new Error('Unexpected SQL in library folder test: ' + sql)
    },
  }

  const rootView = getLibraryFolders(db, '')
  assert.equal(rootView.available, true)
  assert.deepEqual(rootView.folders.map(folder => folder.name).sort(), ['.hidden-with-tracks', 'Artist', '🎧Artist'])
  assert.equal(rootView.folders.some(folder => folder.name === '.hidden-empty'), false, 'dot-prefixed folders with no tracks are hidden')
  assert.equal(rootView.folders.find(folder => folder.name === '.hidden-with-tracks').trackCount, 1, 'dot-prefixed folders with tracks remain visible')
  assert.equal(rootView.tracks.length, 0)
  assert.equal(rootView.totalTracks, 1005, 'root count excludes stale database paths')
  assert.equal(rootView.allTracks.length, 1005, 'Play All includes every descendant, with no 1,000-track cap')
  assert.equal(rootView.folders.find(folder => folder.name === 'Artist').trackCount, 3, 'child folder count is recursive and excludes stale files')
  assert.equal(rootView.folders.find(folder => folder.name === '🎧Artist').trackCount, 1001, 'emoji-leading folder names are included in the recursive count')
  assert.equal(rootView.folders.find(folder => folder.name === '🎧Artist').coverPath, null, 'folders without a saved image have no file cover')
  assert.equal(rootView.folders.find(folder => folder.name === '🎧Artist').coverTrackId, 'bulk-0', 'folders without a saved image use their first song')
  assert.equal(rootView.folders.find(folder => folder.name === '🎧Artist').coverArtworkPath, embeddedArtworkPath, 'first-song embedded artwork is available as the folder cover')

  const artistView = getLibraryFolders(db, 'Artist')
  assert.equal(artistView.relativePath, 'Artist')
  assert.equal(artistView.tracks.length, 0, 'direct tracks in Artist folder is 0')
  assert.equal(artistView.totalTracks, 3, 'parent subfolder counts tracks below it')
  assert.equal(artistView.allTracks.length, 3, 'parent subfolder Play All includes all valid descendants')
  assert.equal(artistView.folders[0].name, 'Album')
  assert.equal(artistView.folders[0].trackCount, 3)
  assert.equal(artistView.folders[0].coverPath, path.join(album, 'a.png'), 'folder entries expose their saved image cover path')
  assert.equal(artistView.folders[0].coverTrackId, 'track-1', 'folder entries expose the first song for artwork fallback')
  assert.equal(artistView.folders[0].coverArtworkPath, embeddedArtworkPath, 'folder entries expose the first song embedded artwork')

  const emojiView = getLibraryFolders(db, '🎧Artist')
  assert.equal(emojiView.totalTracks, 1001)
  assert.equal(emojiView.allTracks.length, 1001, 'Unicode folder Play All returns every descendant')

  const albumView = getLibraryFolders(db, 'Artist/Album')
  assert.equal(albumView.relativePath, 'Artist/Album')
  assert.equal(albumView.tracks.length, 3)
  assert.equal(albumView.totalTracks, 3)

  const searchView = getLibraryFolders(db, '', 'Track One')
  assert.equal(searchView.deepTracks.length, 1, 'deep search finds tracks in subfolders')
  assert.equal(searchView.deepTracks[0].id, 'track-1')
  assert.equal(searchView.deepTracks[0].subfolderPath, 'Artist/Album')

  assert.equal(getLibraryFolders(db, '', 'lokal-library-folders').deepTracks.length, 0,
    'deep search only searches the path relative to the selected folder')
  assert.deepEqual(getLibraryFolders(db, '', '100%').deepTracks.map(track => track.id), ['track-percent'],
    'percent signs in a query are treated literally')
  assert.deepEqual(getLibraryFolders(db, '', '_').deepTracks.map(track => track.id), ['track-underscore'],
    'underscores in a query are treated literally')

  const outsideView = getLibraryFolders(db, '../../outside')
  assert.equal(outsideView.notFound, true, 'paths cannot escape the configured music folder')

  console.log('Library folder view tests passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
