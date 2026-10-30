'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_TIMEOUT_MS = 20000
let current = null
let queue = Promise.resolve()
let stoppingWorker = null
let nextId = 0

function clearPending(session, error = null) {
  const pending = session.pending
  if (!pending) return
  session.pending = null
  clearTimeout(pending.timer)
  if (error) pending.reject(error)
}

function ensureWorker() {
  if (current) return current
  const worker = new Worker(path.join(__dirname, 'scannerMetadataThread.js'))
  worker.unref()
  const session = { worker, pending: null }
  worker.on('message', message => {
    const pending = session.pending
    if (!pending || pending.id !== message?.id) return
    clearPending(session)
    if (message.error) {
      const error = new Error(message.error.message)
      if (message.error.code) error.code = message.error.code
      pending.reject(error)
    } else {
      pending.resolve(message.result)
    }
  })
  worker.on('error', error => {
    clearPending(session, error)
    if (current === session) current = null
  })
  worker.on('exit', code => {
    clearPending(session, new Error(`Metadata worker exited (code ${code})`))
    if (current === session) current = null
  })
  current = session
  return session
}

/**
 * Keep a single reusable parser worker rather than one thread per audio file.
 * A timed-out mm.parseFile cannot be cancelled by Promise.race alone; terminate
 * its worker, and refuse more reads until that termination is acknowledged.
 * This contains lingering kernel/NAS I/O instead of accumulating stuck reads.
 */
async function run(filePath, options, timeoutMs) {
  if (stoppingWorker) {
    const error = new Error('Previous NAS metadata parser is still stopping')
    error.code = 'ETIMEDOUT'
    throw error
  }
  const session = ensureWorker()
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      if (session.pending?.id !== id) return
      const error = new Error('NAS metadata read timed out')
      error.code = 'ETIMEDOUT'
      clearPending(session, error)
      if (current === session) current = null
      const termination = session.worker.terminate()
      stoppingWorker = termination
      termination.catch(() => {}).finally(() => {
        if (stoppingWorker === termination) stoppingWorker = null
      })
    }, timeoutMs)
    session.pending = { id, resolve, reject, timer }
    try {
      session.worker.postMessage({ id, filePath, options })
    } catch (error) {
      clearPending(session, error)
    }
  })
}

function parseWithDeadline(filePath, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  // A scanner iterates tracks sequentially; enforce that invariant even if a
  // second scan starts during a slow NAS read.
  const task = queue.then(() => run(filePath, options, timeoutMs))
  queue = task.catch(() => {})
  return task
}

// Allow deterministic cleanup in tests and when the scanner shuts down.
async function stopMetadataWorker() {
  const session = current
  current = null
  if (!session) return
  clearPending(session, new Error('Metadata worker stopped'))
  try { await session.worker.terminate() } catch {}
}

module.exports = { parseWithDeadline, stopMetadataWorker }
