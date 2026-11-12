// Testable IPC boundary for desktop scheduled backups. The backup service
// controls persistence and worker execution; this module only handles user
// actions and fresh renderer preference snapshots.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

/** Connect main-process backup service to the preload renderer bridge. */
function registerAutomaticBackupIpc({
  ipcMain, BrowserWindow, dialog, shell, documentsPath, createBackups,
  getWindow = () => null, schedule = true,
}) {
  const requests = new Map()
  async function requestFreshPreferences() {
    const candidates = [getWindow(), ...BrowserWindow.getAllWindows()]
    const win = candidates.find(w =>
      w && !w.isDestroyed() && !w.webContents.isDestroyed() &&
      !w.webContents.isLoadingMainFrame(),
    )
    if (!win) throw new Error('Open a Lokal window to capture current backup preferences.')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        requests.delete(id)
        reject(new Error('Lokal did not respond with current backup preferences.'))
      }, 8000)
      requests.set(id, { senderId: win.webContents.id, resolve, timeout })
      try { win.webContents.send('backup:requestPrefs', id) }
      catch (e) { clearTimeout(timeout); requests.delete(id); reject(e) }
    })
  }
  const backups = createBackups(requestFreshPreferences)
  function runDue() {
    return backups.run().catch(error => {
      console.warn('[backups] Automatic backup failed:', error.message)
    })
  }
  ipcMain.handle('backup:deliverPrefs', (event, { id, prefs } = {}) => {
    const request = requests.get(id)
    if (!request || request.senderId !== event.sender.id) return { ok: false }
    clearTimeout(request.timeout)
    requests.delete(id)
    request.resolve(prefs)
    return { ok: true }
  })
  ipcMain.handle('backup:status', () => backups.status())
  ipcMain.handle('backup:configure', (_, options) => {
    const state = backups.configure(options || {})
    if (schedule && state.frequency !== 'off') {
      setTimeout(runDue, 1000).unref?.()
    }
    return state
  })
  ipcMain.handle('backup:chooseFolder', async () => {
    const window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose automatic backup folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    let state = backups.status()
    if (!result.canceled && result.filePaths?.[0]) {
      const selected = result.filePaths[0]
      const stat = await fs.stat(selected)
      if (!stat.isDirectory()) throw new Error('Selected backup folder is not a directory.')
      state = backups.configure({
        directory: selected,
        directoryIdentity: `${stat.dev}:${stat.ino}`,
      })
      if (schedule && state.frequency !== 'off') setTimeout(runDue, 1000).unref?.()
    }
    return state
  })
  ipcMain.handle('backup:runNow', () => backups.run({ force: true }).catch(
    error => ({ ...backups.status(), error: error.message }),
  ))
  ipcMain.handle('backup:openFolder', async () => {
    const directory = backups.status().directory
    if (directory === path.resolve(documentsPath, 'Lokal Backups')) {
      await fs.mkdir(directory, { recursive: true })
    }
    const error = await shell.openPath(directory)
    return error ? { error } : { ok: true }
  })
  if (schedule) {
    setTimeout(runDue, 30 * 1000).unref?.()
    setInterval(runDue, 30 * 60 * 1000).unref?.()
  }
  return backups
}

module.exports = { registerAutomaticBackupIpc }
