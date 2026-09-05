import { T } from '@start9labs/start-sdk'
import {
  rpcHostId as btcRpcHostId,
  rpcPort as btcRpcPort,
  zmqHostId as btcZmqHostId,
  zmqPortBlock as btcZmqPortBlock,
} from 'bitcoin-core-startos/startos/utils'
import { i18n } from './i18n'
import { sdk } from './sdk'

// ── Ports ────────────────────────────────────────────────────────────────────

/**
 * kamado-api HTTP/WebSocket dashboard. Fixed: the OS reverse-proxies this
 * interface, so the browser-facing port is never this number anyway.
 */
export const uiPort = 8080

/**
 * In-container bind ports. These are FIXED and never user-configurable, which
 * is load-bearing: a binding is keyed by (hostId, internalPort), so moving an
 * internal port registers a *new* binding and orphans the old one, StartOS
 * disables the orphan but keeps listing it, and the user sees a duplicate
 * interface. Keeping these constant means each host has exactly one binding
 * for the lifetime of the install, and a port change is a pure rebind that
 * doesn't even restart the daemons.
 */
export const stratumInternalPort = 3333
export const stratumTlsInternalPort = 3334

/**
 * ckpool's loopback-only stratum binds. stunnel forwards decrypted TLS traffic
 * to one of these depending on which certificate terminated the connection,
 * which is how the dashboard tells the two TLS paths apart: ckpool tags every
 * client with the index of the bind it arrived on, and index -> meaning is
 * declared to kamado-api via STRATUM_SERVERS (see stratumServers below).
 *
 * Both are bound unconditionally, even when nothing is listening in front of
 * them. That is deliberate, see stratumServerUrls.
 */
/** Self-signed certificate, for miners on the local network. */
export const ckpoolTlsLoopbackPort = 3437
/**
 * CA-issued certificate for a StartOS public domain (ACME / Let's Encrypt).
 *
 * Unlike the self-signed bind above this one listens on 0.0.0.0, because the
 * terminator in front of it is StartOS itself rather than our in-container
 * stunnel: the OS decrypts on the public interface and forwards over the LXC
 * bridge, which never arrives on loopback. It has to be the OS, StartOS only
 * provisions ACME certificates for bindings it terminates TLS for, so a raw
 * TCP binding is offered no certificate authority at all in the UI.
 */
export const ckpoolPublicTlsPort = 3438

/**
 * Defaults for the user-facing *external* ports (see store.json). These are
 * what miners connect to; they are requested as each interface's
 * `preferredExternalPort` and the OS grants them when free. Same numbers as
 * the internal binds, so the out-of-the-box experience is unchanged.
 */
export const defaultStratumPort = 3333
export const defaultStratumTlsPort = 3334
/** External port for the OS-terminated (CA-issued) TLS endpoint. */
export const defaultStratumPublicTlsPort = 3335

/**
 * Reject external-port choices that cannot work. Since the user no longer
 * picks any container-side port, the only real conflict left is asking for the
 * same external port twice. Returns a human-readable reason, or null when the
 * pair is usable.
 *
 * Deliberately not conditional on the local-TLS toggle: the TLS interface is
 * bound unconditionally now (so a public domain can be attached to it), which
 * means the two external ports always collide if they match, even with the
 * toggle off.
 */
export function validatePorts(opts: {
  stratumPort: number
  stratumTlsPort: number
  stratumPublicTlsPort: number
}): string | null {
  const { stratumPort, stratumTlsPort, stratumPublicTlsPort } = opts

  const claimed: [number, string][] = [
    [stratumPort, 'Preferred Stratum Port'],
    [stratumTlsPort, 'Preferred Stratum TLS Port (Local Network)'],
    [stratumPublicTlsPort, 'Preferred Stratum TLS Port (Public Domain)'],
  ]

  for (let i = 0; i < claimed.length; i++)
    for (let j = i + 1; j < claimed.length; j++)
      if (claimed[i][0] === claimed[j][0])
        return `${claimed[i][1]} and ${claimed[j][1]} must differ (both are ${claimed[i][0]}).`

  return null
}

// ── ckpool serverurl[] contract ──────────────────────────────────────────────

/**
 * How a miner reached the pool. Mirrors state.StratumServer in kamado-api;
 * the dashboard switches on `kind` to label its lock badge.
 */
export type StratumServerKind = 'plain' | 'tls-local' | 'tls-public'
export type StratumServer = { kind: StratumServerKind; label: string }

/**
 * ckpool's serverurl[] array, in a FIXED order, with every entry bound
 * unconditionally.
 *
 * ckpool tags each client with the index of the bind it arrived on, and the
 * dashboard turns that index into a connection badge. Emitting the array
 * conditionally (only the binds currently in use) would renumber the indices
 * whenever the user toggles local TLS or attaches a domain, silently
 * relabelling every connected miner. Two idle loopback listeners are a much
 * cheaper price than an index that means different things over time.
 *
 * Keep in lockstep with stratumServers() below.
 */
export function stratumServerUrls(): string[] {
  return [
    `0.0.0.0:${stratumInternalPort}`,
    `127.0.0.1:${ckpoolTlsLoopbackPort}`,
    `0.0.0.0:${ckpoolPublicTlsPort}`,
  ]
}

/**
 * The meaning of each stratumServerUrls() entry, handed to kamado-api as
 * STRATUM_SERVERS so the dashboard can name the transport on hover instead of
 * assuming a bind order. `publicDomains` only affects the label text, the
 * array shape is fixed.
 *
 * These strings surface in the (English-only) dashboard, not the StartOS UI,
 * so they deliberately skip i18n.
 */
export function stratumServers(publicDomains: string[]): StratumServer[] {
  return [
    { kind: 'plain', label: 'Plaintext, not encrypted' },
    {
      kind: 'tls-local',
      label: 'TLS, self-signed certificate (local network)',
    },
    {
      kind: 'tls-public',
      label: publicDomains.length
        ? `TLS, CA-issued certificate for ${publicDomains.join(', ')}`
        : 'TLS, CA-issued certificate for a public domain',
    },
  ]
}

// ── Effective (OS-assigned) external ports ───────────────────────────────────

/**
 * What a stratum endpoint is actually reachable on, versus what we asked for.
 *
 * `preferredExternalPort` is a request, not a reservation: if the port is
 * already claimed the OS grants a different one and nothing fails. Every
 * consumer of that fact reads it here, so the config form can express intent
 * while the Pool Status action and the mismatch warning report the truth.
 */
export type EndpointPort = {
  /** Interface name as it appears in the StartOS UI. */
  label: string
  hostId: string
  /** What the user asked for in Configure. */
  requested: number
  /** What the OS granted, or null while the binding has no assignment yet. */
  assigned: number | null
  /**
   * Public domains attached to this binding, with the port each is published
   * on. That port follows the *requested* value, so it can differ from
   * `assigned`: the domain and the IP addresses of one interface are not
   * necessarily reachable on the same number.
   */
  domains: { fqdn: string; port: number }[]
}

/**
 * Resolve all three stratum endpoints. `mode` picks the read strategy: 'const'
 * in main (so a port reassignment re-fires it), 'once' in an action.
 *
 * The public-domain endpoint is read from `assignedSslPort`, the OS terminates
 * TLS there, so the port miners connect to is the SSL one; `assignedPort` on
 * that binding is the decrypted side, which is not published.
 */
export async function endpointPorts(
  effects: T.Effects,
  requested: { stratum: number; tls: number; publicTls: number },
  mode: 'const' | 'once',
): Promise<EndpointPort[]> {
  const specs: {
    label: string
    hostId: string
    internalPort: number
    requested: number
    ssl: boolean
  }[] = [
    {
      label: 'Stratum',
      hostId: stratumHostId,
      internalPort: stratumInternalPort,
      requested: requested.stratum,
      ssl: false,
    },
    {
      label: 'Stratum (TLS, Local Network)',
      hostId: stratumTlsHostId,
      internalPort: stratumTlsInternalPort,
      requested: requested.tls,
      ssl: false,
    },
    {
      label: 'Stratum (TLS, Public Domain)',
      hostId: stratumPublicTlsHostId,
      internalPort: ckpoolPublicTlsPort,
      requested: requested.publicTls,
      ssl: true,
    },
  ]

  return Promise.all(
    specs.map(async (spec) => {
      const watch = sdk.host.getOwn(effects, spec.hostId, (host) => {
        const binding = host?.bindings[spec.internalPort]
        const net = binding?.net
        // Public domains are published on the port the binding *requested*
        // (addSsl.preferredExternalPort), not the one the OS assigned, so a
        // domain and an IP address on the same interface can advertise
        // different ports. Read the domain entries rather than deriving them.
        const domains = (binding?.addresses.available ?? [])
          .filter((a) => a.metadata.kind === 'public-domain' && a.port !== null)
          .map((a) => ({ fqdn: a.hostname, port: a.port as number }))
        return {
          assigned:
            (spec.ssl ? net?.assignedSslPort : net?.assignedPort) ?? null,
          domains,
        }
      })
      const info = mode === 'const' ? await watch.const() : await watch.once()
      return {
        label: spec.label,
        hostId: spec.hostId,
        requested: spec.requested,
        assigned: info?.assigned ?? null,
        domains: info?.domains ?? [],
      }
    }),
  )
}

/**
 * Stable signature of the current assignment, used to notify about a
 * mismatch exactly once per distinct outcome rather than on every start.
 */
export function portAssignmentSignature(ports: EndpointPort[]): string {
  return ports.map((p) => `${p.hostId}:${p.requested}>${p.assigned}`).join('|')
}

// ── Host ids (the `sdk.MultiHost.of` groups) ─────────────────────────────────
export const uiHostId = 'ui'
export const stratumHostId = 'stratum'
export const stratumTlsHostId = 'stratum-tls'
/**
 * Host for the OS-terminated TLS interface. Separate from stratumTlsHostId
 * because the two differ in exactly the way StartOS cares about: this one
 * declares `addSsl`, so the OS owns the certificate and offers Let's Encrypt
 * when a domain is attached; that one is opaque TCP that stunnel terminates.
 */
export const stratumPublicTlsHostId = 'stratum-tls-public'

// ── In-container paths ───────────────────────────────────────────────────────

/** main volume mountpoint: SQLite DB (data/kamado.db) and TLS certs (tls/) */
export const kamadoRoot = '/root/.kamado'
/** ckpool volume mountpoint: ckpool's own state + daily logs (logs/) */
export const ckpoolRoot = '/root/.ckpool'
/** bitcoind's data dir (read-only dependency mount), used for .cookie auth */
export const btcMountpoint = '/mnt/bitcoind'

export const ckpoolLogDir = `${ckpoolRoot}/logs`
export const ckpoolLogFile = `${ckpoolLogDir}/ckpool.log`
export const ckpoolSocketDir = '/run/ckpool'
export const kamadoDataDir = `${kamadoRoot}/data`
export const kamadoDbPath = `${kamadoDataDir}/kamado.db`
export const tlsDir = `${kamadoRoot}/tls`

/**
 * stunnel's config directory, on the subcontainer rootfs rather than a volume.
 * The config is re-rendered on every main run, so, like ckpool.conf and its
 * RPC credentials, it lives somewhere ephemeral. The self-signed certificate
 * it serves is the one thing that stays on the volume, because its fingerprint
 * has to survive restarts for miners that pin it.
 */
export const stunnelConfDir = '/etc/stunnel'

/** Files that make up the persisted stratum TLS certificate (relative to the main volume) */
export const tlsVolumeFiles = [
  'tls/stratum.crt',
  'tls/stratum.key',
  'tls/stratum.pem',
  'tls/cert_version',
  'tls/fingerprint.txt',
]

// ── Misc constants ───────────────────────────────────────────────────────────

/**
 * CKPool loglevel: 6 = LOG_INFO, required for share-level logging
 * (Accepted/Rejected client lines) used by the stats feature.
 */
export const ckpoolLogLevel = '6'

export const logLevels = {
  debug: i18n('Debug'),
  info: i18n('Info'),
  warn: i18n('Warn'),
  error: i18n('Error'),
}

export type LogLevel = keyof typeof logLevels

// ── Health payload served by kamado-api at /api/health ──────────────────────
export type HealthPayload = {
  ok: boolean
  ckpool: boolean
  bitcoin: boolean
  submit_gap: number
  zmq_stale: boolean
  last_error?: string
}

/** Minimal structural type for anything exec-able (SubContainer, temp subcontainer). */
export type Execable = {
  exec(command: string[]): Promise<{
    exitCode: number | null
    stdout: string | Buffer
    stderr: string | Buffer
  }>
}

/**
 * Fetch a URL from *inside* the service's network namespace by exec'ing curl
 * in a subcontainer. Daemon and standalone health checks run in the host JS
 * runtime, which cannot reach the container's 127.0.0.1 directly.
 */
export async function curlJson<Res>(
  sub: Execable,
  url: string,
  opts: { method?: 'GET' | 'POST'; timeoutSeconds?: number } = {},
): Promise<Res | null> {
  const args = ['curl', '-sf', '--max-time', String(opts.timeoutSeconds ?? 10)]
  if (opts.method === 'POST') args.push('-X', 'POST')
  args.push(url)
  const res = await sub.exec(args).catch(() => null)
  if (!res || res.exitCode !== 0) return null
  try {
    return JSON.parse(res.stdout.toString()) as Res
  } catch {
    return null
  }
}

/**
 * Bridge address (`10.0.3.1:<assigned external port>`) of a dependency's
 * binding, as a minimal reactive value. Chain `.const()` in main: the mapped
 * string only changes when the address itself does, so main restarts exactly
 * on dependency install/uninstall/port-change and never on dependency
 * updates. Chain `.once()` in an action context. Resolves null while the
 * dependency is absent. Drop-in for the planned SDK
 * `sdk.host.getBridgeAddress` helper.
 */
export function bridgeAddress(
  effects: T.Effects,
  opts: { packageId: string; hostId: string; internalPort: number },
): { const(): Promise<string | null>; once(): Promise<string | null> } {
  const watchable = async () => {
    const osIp = await sdk.getOsIp(effects)
    return sdk.host.get(
      effects,
      { packageId: opts.packageId, hostId: opts.hostId },
      (host) => {
        const port = host?.bindings[opts.internalPort]?.net.assignedPort
        if (port == null) return null
        return `${osIp}:${port}`
      },
    )
  }
  return {
    const: async () => (await watchable()).const(),
    once: async () => (await watchable()).once(),
  }
}

/**
 * Public (clearnet) domains the user has attached to a host, as a minimal
 * reactive value, the same pattern as bridgeAddress.
 *
 * The user adds these in the StartOS interface UI, so this is the package's
 * only source of truth for "is there a domain to get a CA-issued certificate
 * for": no config field to drift out of sync with what the OS actually has,
 * and adding or removing one heals the service with a restart.
 *
 * The watched projection is a sorted, comma-joined *string* rather than an
 * array on purpose: a fresh array is a new reference on every poll, which
 * would restart main continuously.
 */
export function publicDomains(
  effects: T.Effects,
  hostId: string,
): { const(): Promise<string[]>; once(): Promise<string[]> } {
  const split = (joined: string | null) =>
    joined ? joined.split(',').filter(Boolean) : []
  const watchable = async () =>
    sdk.host.get(effects, { hostId }, (host) =>
      Object.keys(host?.publicDomains ?? {})
        .sort()
        .join(','),
    )
  return {
    const: async () => split(await (await watchable()).const()),
    once: async () => split(await (await watchable()).once()),
  }
}

/**
 * bitcoind's RPC and ZMQ-block endpoints over the LXC bridge. Two reactive
 * bridge-address watches, one per bitcoind host, each chained `.const()`,
 * so main restarts only when an address actually changes: a bitcoind update
 * is 0 restarts, bitcoind installed after Kamado is one healing restart, and
 * uninstall is one restart. Each resolves null while bitcoind is absent (or,
 * for ZMQ, while bitcoind has ZMQ disabled).
 */
export const bitcoindBridge = async (effects: T.Effects) => {
  const rpc = await bridgeAddress(effects, {
    packageId: 'bitcoind',
    hostId: btcRpcHostId,
    internalPort: btcRpcPort,
  }).const()
  const zmqBlock = await bridgeAddress(effects, {
    packageId: 'bitcoind',
    hostId: btcZmqHostId,
    internalPort: btcZmqPortBlock,
  }).const()
  return { rpc, zmqBlock }
}

/**
 * Parse bitcoind's RPC cookie (`__cookie__:<random>`) into credentials.
 * Returns null if the cookie is absent or malformed (e.g. bitcoind has not
 * started yet, so the cookie file does not exist).
 */
export function parseCookie(
  cookie: string | null | undefined,
): { user: string; password: string } | null {
  if (!cookie) return null
  const trimmed = cookie.trim()
  const i = trimmed.indexOf(':')
  if (i <= 0) return null
  return { user: trimmed.slice(0, i), password: trimmed.slice(i + 1) }
}
