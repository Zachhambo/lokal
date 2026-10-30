'use strict'

const { parentPort } = require('node:worker_threads')
const metadata = require('../musicMetadata')

// Keep random-access file parsing for formats whose tags/duration live at
// the end of the file. Terminating this worker also discards its file handles
// and pending parse instead of leaving abandoned NAS reads in the main process.
parentPort.on('message', async ({ id, filePath, options }) => {
  try {
    const result = await metadata.parseFile(filePath, options)
    parentPort.postMessage({ id, result })
  } catch (error) {
    parentPort.postMessage({
      id,
      error: { message: error?.message || 'Could not read file metadata', code: error?.code || null },
    })
  }
})
