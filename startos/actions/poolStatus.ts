import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  ckpoolLogFile,
  ckpoolRoot,
  curlJson,
  defaultStratumPort,
  defaultStratumPublicTlsPort,
  defaultStratumTlsPort,
  endpointPorts,
  uiPort,
} from '../utils'

const API_BASE = `http://127.0.0.1:${uiPort}`

// ── formatting helpers ────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().slice(11, 22)
}

function fmtHR(hs: number): string {
  if (hs <= 0) return '0 H/s'
  if (hs >= 1e18) return `${(hs / 1e18).toFixed(2)} EH/s`
  if (hs >= 1e15) return `${(hs / 1e15).toFixed(2)} PH/s`
  if (hs >= 1e12) return `${(hs / 1e12).toFixed(2)} TH/s`
  if (hs >= 1e9) return `${(hs / 1e9).toFixed(2)} GH/s`
  if (hs >= 1e6) return `${(hs / 1e6).toFixed(2)} MH/s`
  if (hs >= 1e3) return `${(hs / 1e3).toFixed(2)} kH/s`
  return `${hs.toFixed(0)} H/s`
}

function fmtDiff(d: number): string {
  if (d <= 0) return '0'
  if (d >= 1e12) return `${(d / 1e12).toFixed(2)}T`
  if (d >= 1e9) return `${(d / 1e9).toFixed(2)}G`
  if (d >= 1e6) return `${(d / 1e6).toFixed(2)}M`
  if (d >= 1e3) return `${(d / 1e3).toFixed(2)}K`
  return d.toFixed(2)
}

function fmtUptime(s: number): string {
  if (s <= 0) return '0m'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtBTC(btc: number): string {
  return `${btc.toFixed(8)} BTC`
}
function pad(s: string, w: number): string {
  return s.padEnd(w)
}

const chainNames: Record<string, string> = { main: 'mainnet' }
function displayChain(c: string): string {
  return chainNames[c] ?? c
}

// ── snapshot shape ────────────────────────────────────────────────────────────

interface PoolStats {
  workers: number
  users: number
  accepted: number
  rejected: number
  shares: number
  dsps1: number
  dsps5: number
  dsps60: number
  dsps1440: number
}
interface Chain {
  chain: string
  blocks: number
  headers: number
  difficulty: number
  initialblockdownload: boolean
  verificationprogress: number
  bestblockhash: string
}
interface Worker {
  worker: string
  dsps1: number
  bestdiff: number
  bestever: number
  idle: boolean
}
interface Client {
  id: number
  workername: string
  diff: number
  dsps1: number
  useragent: string
}
interface BlockRecord {
  height: number
  hash?: string
  reward_btc?: number
  found_at: string
  orphaned_at?: string
  chain?: string
}
interface Snapshot {
  pool: PoolStats | null
  uptime_seconds: number
  hashrate_hs_1m: number
  hashrate_hs_5m: number
  hashrate_hs_1h: number
  hashrate_hs_24h: number
  best_diff: number
  best_share_hash?: string
  best_share_pow?: {
    sdiff: number
    height: number
    hash: string
    seen_at: string
  }
  // Log-derived (tailer) session stats, nonzero proves kamado-api is
  // actually reading ckpool's log, as opposed to the socket-derived
  // share counters above.
  diff_dist_session: number[]
  cumulative_shares: number
  next_block_reward_btc: number
  next_difficulty_percent: number
  chain: Chain | null
  network_hashrate_hs: number
  recent_blocks: BlockRecord[]
  ckpool_ok: boolean
  bitcoin_ok: boolean
  last_error?: string
  block_submit_attempts: number
  block_submits_confirmed: number
  zmq_enabled: boolean
  zmq_stale: boolean
  has_last_zmq_event: boolean
  last_zmq_event_age: number
  workers: Worker[]
  clients: Client[]
}
interface DebugBlocks {
  memory: {
    height: number
    hash: string
    chain: string
    orphaned_at: string
    found_at: string
  }[]
  db: {
    height: number
    hash: string
    chain: string
    orphaned_at: string
    found_at: string
  }[]
}

export const poolStatus = sdk.Action.withoutInput(
  // id
  'pool-status',

  // metadata
  async ({ effects }) => ({
    name: i18n('Pool Status'),
    description: i18n(
      'Displays a full status snapshot: Bitcoin Core sync state, ckpool health, connected miners, hashrate, found blocks, and submit-gap diagnostics.',
    ),
    warning: null,
    allowedStatuses: 'only-running',
    group: null,
    visibility: 'enabled',
  }),

  // the execution function
  async ({ effects }) => {
    // Effective external ports, straight from the OS. The Configure form holds
    // a *request*; if the port was taken the OS granted a different one, and
    // this is where the user finds out what miners must actually connect to.
    const requests = (await storeJson
      .read((s) => ({
        stratum: s.stratumPort,
        tls: s.stratumTlsPort,
        publicTls: s.stratumPublicTlsPort,
      }))
      .once()) ?? {
      stratum: defaultStratumPort,
      tls: defaultStratumTlsPort,
      publicTls: defaultStratumPublicTlsPort,
    }
    const ports = await endpointPorts(effects, requests, 'once')
    const stratumPort = ports[0].assigned ?? ports[0].requested

    // Fetch from inside the service's network namespace: temp subcontainers
    // share it, so curl reaches kamado-api on 127.0.0.1. The ckpool volume
    // is mounted read-only so the PoW diagnostics below can inspect the
    // ckpool log directly.
    const { snap, dbg, pow } = await sdk.SubContainer.withTemp(
      effects,
      { imageId: 'main' },
      sdk.Mounts.of().mountVolume({
        volumeId: 'ckpool',
        subpath: null,
        mountpoint: ckpoolRoot,
        readonly: true,
      }),
      'pool-status',
      async (sub) => {
        // PoW capture pipeline (ckpool patch 0008 → log → kamado-api):
        // check each link so a break is attributable. grep -a treats the
        // ckpool binary and log as text; counts are "0" on no match.
        const countIn = async (target: string): Promise<number> => {
          const res = await sub.exec([
            'sh',
            '-c',
            `grep -ac "Best share PoW data" ${target} 2>/dev/null || true`,
          ])
          return parseInt((res.stdout || '').toString().trim(), 10) || 0
        }
        const acceptedRes = await sub.exec([
          'sh',
          '-c',
          `grep -ac "Accepted client" ${ckpoolLogFile} 2>/dev/null || true`,
        ])
        // The newest PoW line verbatim (bounded), so the action can run
        // the exact same regex + JSON.parse kamado-api uses and report
        // WHERE ingestion breaks on real data rather than guessing.
        const lastPowRes = await sub.exec([
          'sh',
          '-c',
          `grep -a "Best share PoW data" ${ckpoolLogFile} 2>/dev/null | tail -1 | cut -c1-8000 || true`,
        ])
        return {
          snap: await curlJson<Snapshot>(sub, `${API_BASE}/api/snapshot`),
          dbg: await curlJson<DebugBlocks>(
            sub,
            `${API_BASE}/api/admin/debug-blocks`,
          ),
          pow: {
            binaryPatched: (await countIn('/usr/local/bin/ckpool')) > 0,
            logPowLines: await countIn(ckpoolLogFile),
            logAcceptedLines:
              parseInt((acceptedRes.stdout || '').toString().trim(), 10) || 0,
            lastPowLine: (lastPowRes.stdout || '').toString().trim(),
          },
        }
      },
    )

    const lines: string[] = []
    const log = (s: string) => lines.push(`[${ts()}] ${s}`)
    const sep = () => log('──────────────────────────────────────────')
    let allPass = true

    log('Kamado Pool, Status')
    sep()

    // ── 1. Full snapshot ────────────────────────────────────────────────────
    log('● Pool & Bitcoin Core status')
    if (!snap) {
      log('  API unreachable, service may still be starting.')
      allPass = false
    }

    if (snap) {
      const chain = snap.chain
      const pool = snap.pool

      log(`  Bitcoin Core:     ${snap.bitcoin_ok ? 'OK' : 'FAIL'}`)
      if (chain) {
        const ibd = chain.initialblockdownload
        const syncPct = (chain.verificationprogress * 100).toFixed(2)
        log(
          `  Network:          ${chain.chain}  height=${chain.blocks}  headers=${chain.headers}`,
        )
        log(
          `  Sync:             ${
            ibd
              ? `IBD, ${syncPct}% (pool will not mine until synced)`
              : `${syncPct}%, fully synced`
          }`,
        )
        log(`  Block hash:       ${chain.bestblockhash}`)
        log(`  Difficulty:       ${fmtDiff(chain.difficulty)}`)
        log(`  Network hashrate: ${fmtHR(snap.network_hashrate_hs)}`)
        if (ibd) allPass = false
      }
      if (!snap.bitcoin_ok) allPass = false

      if (snap.next_block_reward_btc > 0)
        log(`  Next block reward: ${fmtBTC(snap.next_block_reward_btc)}`)
      if (snap.next_difficulty_percent !== 0) {
        const sign = snap.next_difficulty_percent > 0 ? '+' : ''
        log(
          `  Next diff adjust:  ${sign}${snap.next_difficulty_percent.toFixed(1)}%`,
        )
      }

      if (snap.zmq_enabled) {
        const age = snap.has_last_zmq_event
          ? `last event ${snap.last_zmq_event_age.toFixed(0)}s ago`
          : 'no event yet since startup'
        log(`  ZMQ:              ${snap.zmq_stale ? 'STALE, ' : 'OK, '}${age}`)
        if (snap.zmq_stale) allPass = false
      } else {
        log(`  ZMQ:              disabled`)
      }

      log('')
      log(`  ckpool process:   ${snap.ckpool_ok ? 'OK' : 'FAIL'}`)
      if (!snap.ckpool_ok) allPass = false
      if (snap.last_error) log(`  last_error:       ${snap.last_error}`)
      if (pool) {
        log(`  Uptime:           ${fmtUptime(snap.uptime_seconds)}`)
        log(
          `  Workers online:   ${pool.workers}  (${pool.users} user${
            pool.users !== 1 ? 's' : ''
          })`,
        )
        log(`  Shares accepted:  ${pool.accepted}  rejected: ${pool.rejected}`)
        log(`  Hashrate 1m:      ${fmtHR(snap.hashrate_hs_1m)}`)
        log(`  Hashrate 5m:      ${fmtHR(snap.hashrate_hs_5m)}`)
        log(`  Hashrate 1h:      ${fmtHR(snap.hashrate_hs_1h)}`)
        log(`  Hashrate 24h:     ${fmtHR(snap.hashrate_hs_24h)}`)
        log(`  Best share ever:  diff ${fmtDiff(snap.best_diff)}`)
        log(
          `  Cumul. work:      ${fmtDiff(snap.cumulative_shares)} diff-1 shares`,
        )
      }

      const gap = snap.block_submit_attempts - snap.block_submits_confirmed
      log(
        `  Submit attempts:  ${snap.block_submit_attempts}  confirmed: ${snap.block_submits_confirmed}`,
      )
      log(
        `  Submit gap:       ${gap > 0 ? `WARN, ${gap} unconfirmed` : 'OK (all confirmed)'}`,
      )
      if (gap > 0) allPass = false

      if (snap.clients && snap.clients.length > 0) {
        log('')
        log(`● Connected miners (${snap.clients.length})`)
        for (const c of snap.clients) {
          const tag = c.useragent ? ` [${c.useragent}]` : ''
          log(
            `  ${pad(c.workername || `client#${c.id}`, 30)} diff=${fmtDiff(
              c.diff,
            )}  ${fmtHR(c.dsps1 * 4294967296)}${tag}`,
          )
        }
      } else {
        log('')
        log('● Connected miners: none')
      }

      if (snap.workers && snap.workers.length > 0) {
        log('')
        log('● Workers, best shares')
        for (const w of snap.workers) {
          const ever = w.bestever > 0 ? w.bestever : w.bestdiff
          log(
            `  ${pad(w.worker, 30)} best=${fmtDiff(ever)}${w.idle ? ' (idle)' : ''}`,
          )
        }
      }

      log('')
      if (snap.recent_blocks && snap.recent_blocks.length > 0) {
        const currentNetwork = chain?.chain ?? ''
        log(`● Blocks found (${snap.recent_blocks.length})`)
        for (const b of snap.recent_blocks) {
          let status = ''
          if (b.orphaned_at) {
            status = ' ORPHANED'
          } else if (b.chain && currentNetwork && b.chain !== currentNetwork) {
            status = ` [${displayChain(b.chain)}]`
          }
          const reward = b.reward_btc ? `  ${fmtBTC(b.reward_btc)}` : ''
          const hash = b.hash ? `  ${b.hash.slice(0, 16)}…` : ''
          log(
            `  height=${b.height}  ${b.found_at.slice(0, 19)}${reward}${hash}${status}`,
          )
          log(
            `    chain="${b.chain ?? ''}"  orphaned_at="${b.orphaned_at ?? ''}"  hash="${b.hash ?? ''}"`,
          )
        }
      } else {
        log('● Blocks found: none yet')
      }
    }

    // ── 1b. Debug: memory vs DB comparison ─────────────────────────────────
    if (dbg) {
      log('')
      log('● Debug: memory vs DB')
      log(
        `  Memory blocks: ${dbg.memory?.length ?? 0}  DB blocks: ${dbg.db?.length ?? 0}`,
      )
      if (dbg.memory && dbg.memory.length > 0) {
        for (const m of dbg.memory) {
          const dbRow = dbg.db?.find((d) => d.height === m.height)
          const memOrph = m.orphaned_at || 'none'
          const dbOrph = dbRow?.orphaned_at || 'none'
          const match = memOrph === dbOrph ? '✓' : 'MISMATCH'
          log(
            `  h=${m.height} mem_orphan="${memOrph}" db_orphan="${dbOrph}" ${match}`,
          )
          if (memOrph !== dbOrph) {
            log(
              `    mem: chain="${m.chain}" hash="${(m.hash || '').slice(0, 20)}…"`,
            )
            log(
              `    db:  chain="${dbRow?.chain ?? '?'}" hash="${(dbRow?.hash || '').slice(0, 20)}…"`,
            )
          }
        }
      }
    } else {
      log('  (debug endpoint unavailable)')
    }

    // ── 1c. PoW capture pipeline ────────────────────────────────────────────
    // Traces best-share header capture (ckpool patch 0008) link by link:
    // patched binary → "Best share PoW data" log lines → kamado-api ingest.
    log('')
    log('● PoW capture (best-share header inspector)')
    log(
      `  ckpool binary:    ${pow.binaryPatched ? 'patched (0008) ✓' : 'NOT PATCHED, image predates patch 0008'}`,
    )
    log(
      `  ckpool log:       ${pow.logPowLines} PoW data line${pow.logPowLines === 1 ? '' : 's'}, ${pow.logAcceptedLines} accepted-share lines`,
    )
    const snapPow = snap?.best_share_pow
    log(
      `  kamado-api:       ${
        snapPow
          ? `record held, diff ${fmtDiff(snapPow.sdiff)} at height ${snapPow.height} (${snapPow.seen_at.slice(0, 19)})`
          : 'no PoW record in snapshot'
      }`,
    )
    // Log-derived session stats prove the tailer reads the log at all,
    // the share counters above come from ckpool's socket instead.
    const tailerShares = (snap?.diff_dist_session ?? []).reduce(
      (a, b) => a + b,
      0,
    )
    log(
      `  log tailer:       ${tailerShares} accepted shares ingested this session`,
    )
    // Replay kamado-api's parse on the newest real PoW line: decode one
    // brace-balanced JSON object after the marker, ignoring any trailing
    // bytes, the same tolerance the Go parser applies.
    if (pow.lastPowLine) {
      let parseVerdict: string
      const start = pow.lastPowLine.indexOf(
        '{',
        pow.lastPowLine.indexOf('Best share PoW data'),
      )
      if (start < 0) {
        parseVerdict = 'NO JSON OBJECT after marker'
      } else {
        // Walk to the matching close brace, honouring strings/escapes.
        let depth = 0
        let inStr = false
        let esc = false
        let end = -1
        for (let i = start; i < pow.lastPowLine.length; i++) {
          const c = pow.lastPowLine[i]
          if (esc) esc = false
          else if (inStr) {
            if (c === '\\') esc = true
            else if (c === '"') inStr = false
          } else if (c === '"') inStr = true
          else if (c === '{') depth++
          else if (c === '}' && --depth === 0) {
            end = i
            break
          }
        }
        if (end < 0) {
          parseVerdict = 'UNTERMINATED JSON, line truncated mid-record'
        } else {
          try {
            const j = JSON.parse(pow.lastPowLine.slice(start, end + 1))
            parseVerdict =
              typeof j.header === 'string' && j.header.length === 160
                ? `parses ✓ (sdiff ${fmtDiff(j.sdiff ?? 0)}, height ${j.height}, header 160 hex)`
                : `JSON ok but header field is ${typeof j.header === 'string' ? `${j.header.length} chars` : 'missing'}`
          } catch (e) {
            parseVerdict = `JSON PARSE FAILED, ${String(e).slice(0, 120)}`
          }
        }
      }
      log(`  last PoW line:    ${parseVerdict}`)
      log(`    head: ${pow.lastPowLine.slice(0, 200)}…`)
      // Tail rendered via JSON.stringify so control bytes (\r,  ,
      // an interleaved second message…) are visible, not invisible.
      log(`    tail: ${JSON.stringify(pow.lastPowLine.slice(-80))}`)
    }
    if (!pow.binaryPatched) {
      log('  → verdict: installed image is stale. Sideload the current s9pk.')
      allPass = false
    } else if (pow.logAcceptedLines === 0) {
      log(
        '  → verdict: no accepted shares in the current log file, ckpool logging problem or log freshly rotated. Wait for shares, then re-run.',
      )
      allPass = false
    } else if (pow.logPowLines === 0) {
      log(
        '  → verdict: binary is patched but has never logged PoW data, the running ckpool process likely predates the update. Restart the service.',
      )
      allPass = false
    } else if (!snapPow) {
      log(
        '  → verdict: ckpool logged PoW data but kamado-api holds no record, restart the service so the startup backfill adopts it from the log.',
      )
      allPass = false
    } else {
      log('  → verdict: pipeline healthy ✓')
    }

    // ── 2. Stratum ───────────────────────────────────────────────────────────
    log('')
    sep()
    log('● Endpoints (the ports miners connect to)')
    for (const p of ports) {
      const assigned = p.assigned ?? p.requested
      const note =
        p.assigned === null
          ? '  (not assigned yet)'
          : p.assigned !== p.requested
            ? `  <- REQUESTED ${p.requested}, reassigned by StartOS`
            : ''
      log(`  ${pad(p.label, 30)} ${assigned}${note}`)
      // Domains publish on the requested port rather than the assigned one, so
      // list them explicitly instead of letting the reader assume the number
      // above applies to them too.
      for (const d of p.domains) {
        log(`  ${pad('  domain:', 30)} ${d.fqdn}:${d.port}`)
      }
    }
    log('')
    log(`● Stratum (port ${stratumPort})`)
    if (snap?.ckpool_ok) {
      log(
        '  ckpool process: healthy, stratum port is served by the same process',
      )
    } else {
      log(
        '  FAIL, ckpool is not running, stratum port will not accept connections',
      )
    }

    // ── 3. Overall ──────────────────────────────────────────────────────────
    log('')
    sep()
    const pass = allPass && (snap?.ckpool_ok ?? false)
    const summary = pass
      ? i18n('PASS, pool is healthy')
      : i18n('FAIL, see details above')
    log(`Overall: ${summary}`)

    return {
      version: '1',
      title: i18n('Pool Status'),
      message: summary,
      result: {
        type: 'single',
        value: lines.join('\n'),
        copyable: true,
        qr: false,
        masked: false,
      },
    }
  },
)
