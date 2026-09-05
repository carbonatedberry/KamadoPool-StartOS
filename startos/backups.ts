import { sdk } from './sdk'

/**
 * Back up both volumes:
 *  - main: SQLite DB (found blocks, best shares, accelerated txs, log
 *    cursor), store.json settings, and the persisted stratum TLS certificate
 *    (so miners' pinned fingerprints survive a restore).
 *  - ckpool: ckpool's own state files (users/, workers/, pool status) and
 *    daily logs. The log file is included deliberately: the log-tailer's
 *    cursor in the DB references it, so restoring both keeps block-solve
 *    detection consistent.
 */
export const { createBackup, restoreInit } = sdk.setupBackups(
  async ({ effects }) => sdk.Backups.ofVolumes('main', 'ckpool'),
)
