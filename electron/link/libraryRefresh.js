// Renderer refresh for library operations received from a paired phone.
// The desktop database is updated in the link socket handler, outside of the
// normal scanner/IPC mutation paths that notify the React library views.
function broadcastLibraryChanged(videoClips) {
  // Headless tests and shutdown may not have a live Electron renderer.
  try {
    const { BrowserWindow } = require('electron')
    if (!BrowserWindow?.getAllWindows) return
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('library:changed', {
          added: [], removed: [], updated: [], reason: 'link-library-sync', videoClips
        })
      }
    }
  } catch {}
}

function createLinkedLibraryRefresh({ publish = broadcastLibraryChanged, delayMs = 100 } = {}) {
  let timer = null
  const videoClips = new Map()
  return {
    accepted(count, changes = []) {
      for (const row of changes) videoClips.set(row.id, row)
      // Replayed operation IDs are ignored by LinkStore; they should not cause
      // a redundant library reload. Coalesce multi-page playlist transfers.
      if ((!Number.isSafeInteger(count) || count <= 0) && changes.length === 0) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const changed = [...videoClips.values()]
        videoClips.clear()
        publish(changed)
      }, delayMs)
      timer.unref?.()
    },
    close() {
      if (timer) clearTimeout(timer)
      timer = null
      videoClips.clear()
    }
  }
}

module.exports = { createLinkedLibraryRefresh }
