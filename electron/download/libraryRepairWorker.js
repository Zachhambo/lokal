// Legacy library identity reconciliation reads physical files and repairs
// references in SQLite. Keep ALL work in a worker, and commit in small
// transactions separated by a scheduling gap so main-process library IPC
// never waits behind one unbounded startup write transaction.
const { parentPort, workerData } = require('node:worker_threads')
const Database = require('better-sqlite3')

async function run() {
  let db
  try {
    db = new Database(workerData.databasePath, { fileMustExist: true })
    db.pragma('busy_timeout = 5000')
    const repaired = await require('../libraryPathIdentity').repairSameFileRowsCooperative(db)
    parentPort.postMessage({ repaired })
  } catch (error) {
    parentPort.postMessage({ error: error.message || String(error) })
  } finally {
    try { db?.close() } catch {}
  }
}

void run()
