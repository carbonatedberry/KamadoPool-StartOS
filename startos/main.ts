import { FileHelper } from '@start9labs/start-sdk'
import { manifest as bitcoindManifest } from 'bitcoin-core-startos/startos/manifest'
import { mkdir, writeFile } from 'node:fs/promises'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  bitcoindBridge,
  btcMountpoint,
  ckpoolLogDir,
  ckpoolLogFile,
  ckpoolRoot,
  ckpoolSocketDir,
  curlJson,
  HealthPayload,
  kamadoDataDir,
  kamadoDbPath,
  kamadoRoot,
  parseCookie,
  tlsDir,
  ckpoolTlsLoopbackPort,
  endpointPorts,
  portAssignmentSignature,
  publicDomains,
  stratumInternalPort,
  stratumPublicTlsHostId,
  stratumTlsInternalPort,
  stratumServers,
  stratumServerUrls,
  stunnelConfDir,
  uiPort,
} from './utils'

const healthUrl = `http://127.0.0.1:${uiPort}/api/health`

export const main = sdk.setupMain(async ({ effects }) => {
  /**
   * ======================== Setup ========================
   */
  console.info('Starting Kamado Pool!')

  // Service settings; reactive, so a config-action change restarts the daemons
  // with a freshly rendered ckpool.conf. Deliberately a projection rather than
  // the whole file: stratumPort / stratumTlsPort are EXTERNAL ports owned by
  // interfaces.ts, and the in-container binds are fixed constants. Excluding
  // them here means changing a port is a pure rebind that leaves the pool
  // running instead of kicking every connected miner.
  const store = await storeJson
    .read((s) => ({
      coinbaseTag: s.coinbaseTag,
      startDiff: s.startDiff,
      minDiff: s.minDiff,
      maxDiff: s.maxDiff,
      dropIdle: s.dropIdle,
      logLevel: s.logLevel,
      zmqEnabled: s.zmqEnabled,
      tlsEnabled: s.tlsEnabled,
      mempoolExplorerUrl: s.mempoolExplorerUrl,
    }))
    .const(effects)
  if (!store) throw new Error('No store.json')

  // bitcoind's RPC + ZMQ endpoints over the LXC bridge (see bitcoindBridge in
  // utils.ts). Each resolves null while bitcoind is absent; the .const()
  // watches heal main with a restart when bitcoind appears, disappears, or
  // changes ports, and never on a routine bitcoind update.
  const bitcoind = await bitcoindBridge(effects)

  // Clearnet domains attached to the Stratum (TLS, Public Domain) interface.
  // There is no config field for this: the domain is added in the StartOS
  // interface UI, and attaching or removing one restarts main through the same
  // reactive mechanism as everything else above.
  //
  // Used only to label the connection in the dashboard, the certificates
  // themselves are the OS's concern now, so this never gates anything starting.
  const tlsDomains = await publicDomains(
    effects,
    stratumPublicTlsHostId,
  ).const()

  // Warn when the OS could not grant a port we asked for.
  //
  // `preferredExternalPort` is a request: if the number is already claimed the
  // OS silently assigns another, and the first symptom is a miner that cannot
  // connect on the port the config form shows. Surfacing it here turns a
  // silent substitution into something the user is told about once, naming
  // both numbers. Pool Status prints the effective ports on demand.
  //
  // Read `.const()` so a later reassignment re-fires this; the store field
  // that de-dupes the warning is read `.once()` and is deliberately absent
  // from the projection above, so writing it cannot restart the service.
  const portRequests = await storeJson
    .read((s) => ({
      stratum: s.stratumPort,
      tls: s.stratumTlsPort,
      publicTls: s.stratumPublicTlsPort,
    }))
    .const(effects)
  if (portRequests) {
    const ports = await endpointPorts(effects, portRequests, 'const')
    const mismatched = ports.filter(
      (p) => p.assigned !== null && p.assigned !== p.requested,
    )
    const signature = portAssignmentSignature(ports)
    const lastNotified = await storeJson
      .read((s) => s.notifiedPortAssignment)
      .once()

    if (mismatched.length > 0 && signature !== lastNotified) {
      await sdk.notification.create(effects, {
        level: 'warning',
        title: i18n('Stratum port changed by StartOS'),
        message: mismatched
          .map((p) =>
            i18n('{label}: requested {requested}, assigned {assigned}')
              .replace('{label}', p.label)
              .replace('{requested}', String(p.requested))
              .replace('{assigned}', String(p.assigned)),
          )
          .concat(
            i18n(
              'The port you asked for was already in use, so StartOS assigned another one. Point your miners at the assigned port, or pick a free one in Configure.',
            ),
          )
          .join('\n'),
      })
    }
    if (signature !== lastNotified)
      await storeJson.merge(effects, { notifiedPortAssignment: signature })
  }

  // All Kamado processes (kamado-api, ckpool, stunnel) share ONE
  // subcontainer, mirroring the single 0.3.x container: kamado-api reaches
  // ckpool's Unix socket in /run/ckpool and tails its log file without any
  // cross-container plumbing.
  const kamadoSub = await sdk.SubContainer.eager(
    effects,
    { imageId: 'main' },
    sdk.Mounts.of()
      .mountVolume({
        volumeId: 'main',
        subpath: null,
        mountpoint: kamadoRoot,
        readonly: false,
      })
      .mountVolume({
        volumeId: 'ckpool',
        subpath: null,
        mountpoint: ckpoolRoot,
        readonly: false,
      })
      .mountDependency<typeof bitcoindManifest>({
        dependencyId: 'bitcoind',
        volumeId: 'main',
        subpath: null,
        mountpoint: btcMountpoint,
        readonly: true,
      }),
    'kamado',
  )

  // bitcoind uses cookie authentication in 0.4.0 (no more rpcuser/rpcpassword
  // pointers). Read the cookie from the read-only dependency mount and watch
  // it: a cookie rotation (bitcoind restart) restarts Kamado with fresh
  // credentials. Null until bitcoind has started at least once.
  const cookieRaw = await FileHelper.string(
    `${kamadoSub.rootfs}/mnt/bitcoind/.cookie`,
  )
    .read()
    .const(effects)
  const cookie = parseCookie(cookieRaw)

  // Placeholders keep kamado-api bootable while bitcoind is unresolved: the
  // dashboard comes up, reports Bitcoin Core as unreachable, and the reactive
  // reads above heal everything once the dependency is satisfied.
  const rpcAddr = bitcoind.rpc ?? '127.0.0.1:8332'
  const rpcUser = cookie?.user ?? '__cookie__'
  const rpcPassword = cookie?.password ?? 'bitcoind-not-yet-available'

  // ckpool has TWO independent new-block detection paths. Wire up both so
  // we're never blind to a tip change (every second of stale work in solo
  // mode is hashrate burned on a dead block):
  //   1. Blockpoll thread: polls getbestblockhash every `blockpoll` ms. Only
  //      runs when notify=false, so keep notify=false.
  //   2. ZMQ hashblock subscriber: instant push from bitcoind. Point it at
  //      the real bridge endpoint; fall back to ckpool's (dead, harmless)
  //      loopback default while bitcoind's ZMQ interface is unavailable.
  const ckpoolZmqBlock = bitcoind.zmqBlock
    ? `tcp://${bitcoind.zmqBlock}`
    : 'tcp://127.0.0.1:28332'

  // Rendered ckpool.conf, written to the subcontainer rootfs (ephemeral, so
  // RPC credentials never touch a persisted volume). `btcaddress` is only
  // consulted once at startup for ckpool's coinbase-builder self-test; solo
  // mode pays the worker's stratum address, never this one. The right
  // self-test address depends on the active network, which ckpool-run.sh
  // detects from bitcoind at startup and substitutes for the placeholder.
  const ckpoolConfTemplate = JSON.stringify(
    {
      btcd: [
        {
          url: rpcAddr,
          auth: rpcUser,
          pass: rpcPassword,
          notify: false,
        },
      ],
      btcaddress: '@SELFTEST_ADDRESS@',
      btcsig: store.coinbaseTag,
      blockpoll: 100,
      update_interval: 30,
      // Fixed three-entry array; see stratumServerUrls for why it never
      // varies with the TLS settings.
      serverurl: stratumServerUrls(),
      mindiff: store.minDiff,
      startdiff: store.startDiff,
      maxdiff: store.maxDiff,
      dropidle: store.dropIdle,
      zmqblock: ckpoolZmqBlock,
      logdir: ckpoolLogDir,
    },
    null,
    2,
  )

  await mkdir(`${kamadoSub.rootfs}/etc/ckpool`, { recursive: true })
  await writeFile(
    `${kamadoSub.rootfs}/etc/ckpool/ckpool.conf.template`,
    ckpoolConfTemplate,
  )

  // Public-domain TLS is StartOS's job, not ours, see the stratum-tls-public
  // interface in interfaces.ts. The OS terminates ACME-backed TLS and forwards
  // plaintext into ckpool's third bind, so nothing here fetches, writes or
  // serves a certificate for a public domain.
  //
  // This package used to do that itself with sdk.getSslCertificate() plus
  // stunnel SNI sections, which cannot work: StartOS only provisions ACME
  // certificates for bindings it terminates TLS for, so a raw TCP binding was
  // handed no CA-issued certificate to serve and miners got the self-signed
  // one (mbedtls -0x2700, X509_CERT_VERIFY_FAILED).
  //
  // stunnel is therefore left with exactly one job: the self-signed
  // certificate for miners on the local network.
  await mkdir(`${kamadoSub.rootfs}${stunnelConfDir}`, { recursive: true })
  const stunnelEnabled = store.tlsEnabled

  // stunnel.conf is rendered here rather than shipped as a static asset so it
  // stays next to the ports it references. `accept` is the fixed in-container
  // TLS port, which the OS forwards the user's chosen external port to.
  //
  // Certificate selection is by SNI, and it degrades in exactly the direction
  // we need. The primary service's certificate is what a client gets when it
  // sends no SNI or an unrecognised one, which is precisely the miner that
  // connected to a bare LAN IP and therefore cannot use a public certificate
  // anyway. A miner that connected by domain name sends SNI, matches a
  // secondary service, and gets the CA-issued certificate for that name.
  //
  // Each service `connect`s to a different ckpool loopback bind so ckpool
  // tags the two paths with different serverurl indices, which is how the
  // dashboard's lock badge can name the certificate in use.
  if (stunnelEnabled) {
    const stunnelConf = [
      'foreground = yes',
      'pid =',
      'output = /dev/stdout',
      // debug = 5 (notice) so each successful TLS handshake produces a
      // "Service [stratum] accepted connection" / "connected from" pair in the
      // service logs. Failures (bad cert, alerts, cipher rejection) surface at
      // level 3, so both happy- and sad-path events are visible without
      // flipping levels per incident.
      'debug = 5',
      // Pin a modern TLS floor. Any miner firmware younger than ~2018 speaks
      // TLS 1.2, and TLS 1.0/1.1 are deprecated anyway.
      'sslVersion = all',
      'options = NO_SSLv2',
      'options = NO_SSLv3',
      'options = NO_TLSv1',
      'options = NO_TLSv1_1',
      '',
      '[stratum]',
      `accept = 0.0.0.0:${stratumTlsInternalPort}`,
      `connect = 127.0.0.1:${ckpoolTlsLoopbackPort}`,
      `cert = ${tlsDir}/stratum.pem`,
      // No client-cert auth, stratum over TLS is opportunistic encryption;
      // the stratum protocol layer handles miner auth via username.
      'verify = 0',
      '',
    ].join('\n')

    await writeFile(
      `${kamadoSub.rootfs}${stunnelConfDir}/stratum.conf`,
      stunnelConf,
    )
  }

  /**
   * ======================== Daemons ========================
   */
  return sdk.Daemons.of(effects)
    .addOneshot('dirs', {
      subcontainer: kamadoSub,
      exec: {
        command: [
          'mkdir',
          '-p',
          kamadoDataDir,
          tlsDir,
          ckpoolLogDir,
          ckpoolSocketDir,
        ],
      },
      requires: [],
    })
    .addDaemon('api', {
      subcontainer: kamadoSub,
      exec: {
        command: ['kamado-api'],
        env: {
          LISTEN_ADDR: `:${uiPort}`,
          CKPOOL_SOCKDIR: ckpoolSocketDir,
          CKPOOL_LOGFILE: ckpoolLogFile,
          DB_PATH: kamadoDbPath,
          BITCOIN_RPC_URL: `http://${rpcAddr}`,
          BITCOIN_RPC_USER: rpcUser,
          BITCOIN_RPC_PASSWORD: rpcPassword,
          POLL_INTERVAL: '5s',
          KAMADO_LOG_LEVEL: store.logLevel,
          // Empty disables kamado-api's ZMQ subscriber (RPC polling fallback
          // remains active either way).
          BITCOIN_ZMQ_BLOCK:
            store.zmqEnabled && bitcoind.zmqBlock
              ? `tcp://${bitcoind.zmqBlock}`
              : '',
          // Empty means "use mempool.space defaults" for dashboard links.
          MEMPOOL_BASE_URL: store.mempoolExplorerUrl ?? '',
          // Tells the dashboard what each ckpool serverurl index means, so
          // the lock badge can name the certificate a miner is using instead
          // of assuming a bind order. Labels only mention domains we actually
          // managed to load a certificate for.
          STRATUM_SERVERS: JSON.stringify(stratumServers(tlsDomains)),
        },
      },
      ready: {
        display: i18n('Web Dashboard'),
        gracePeriod: 15_000,
        fn: () =>
          sdk.healthCheck.checkPortListening(effects, uiPort, {
            successMessage: i18n('The Kamado dashboard is reachable'),
            errorMessage: i18n('The Kamado dashboard is not reachable'),
          }),
      },
      requires: ['dirs'],
    })
    .addDaemon('ckpool', {
      subcontainer: kamadoSub,
      exec: {
        // Waits until bitcoind answers getblockchaininfo, resolves the
        // network-correct self-test address, renders the final ckpool.conf,
        // then execs ckpool. When kamado-api kills ckpool on bitcoind
        // failure (so miners can fail over), StartOS restarts the daemon and
        // the script blocks again until bitcoind recovers, the 0.3.x
        // supervised-restart loop, expressed as a daemon.
        command: ['kamado-ckpool-run.sh'],
        env: {
          BITCOIN_RPC_URL: `http://${rpcAddr}`,
          BITCOIN_RPC_USER: rpcUser,
          BITCOIN_RPC_PASSWORD: rpcPassword,
          CKPOOL_SOCKDIR: ckpoolSocketDir,
        },
      },
      ready: {
        display: i18n('Stratum Server'),
        gracePeriod: 30_000,
        fn: () =>
          sdk.healthCheck.checkPortListening(effects, stratumInternalPort, {
            successMessage: i18n('The stratum server is accepting connections'),
            errorMessage: i18n(
              'The stratum server is not accepting connections',
            ),
          }),
      },
      requires: ['dirs'],
    })
    .addHealthCheck('bitcoin', {
      ready: {
        display: i18n('Bitcoin Core RPC'),
        fn: async () => {
          const h = await curlJson<HealthPayload>(kamadoSub, healthUrl)
          if (!h)
            return {
              result: 'failure',
              message: i18n('Kamado API is unreachable, service may be down'),
            }
          if (h.bitcoin)
            return {
              result: 'success',
              message: i18n('Connected to Bitcoin Core'),
            }
          return {
            result: 'failure',
            message: h.last_error
              ? `${i18n('Bitcoin Core RPC is unreachable')} (${h.last_error})`
              : i18n('Bitcoin Core RPC is unreachable'),
          }
        },
      },
      requires: ['api'],
    })
    .addHealthCheck('submit-gap', {
      ready: {
        display: i18n('Block Submission'),
        fn: async () => {
          const h = await curlJson<HealthPayload>(kamadoSub, healthUrl)
          if (!h)
            return {
              result: 'failure',
              message: i18n('Kamado API is unreachable, service may be down'),
            }
          const gap = h.submit_gap ?? 0
          if (gap === 0)
            return {
              result: 'success',
              message: i18n('All block submissions confirmed'),
            }
          return {
            result: 'failure',
            message: `${gap} ${i18n(
              'block(s) submitted to bitcoind but not confirmed, check Bitcoin Core logs',
            )}`,
          }
        },
      },
      requires: ['api'],
    })
    .addHealthCheck('zmq', () =>
      store.zmqEnabled
        ? {
            ready: {
              display: i18n('ZMQ Block Feed'),
              fn: async () => {
                const h = await curlJson<HealthPayload>(kamadoSub, healthUrl)
                if (!h)
                  return {
                    result: 'failure',
                    message: i18n(
                      'Kamado API is unreachable, service may be down',
                    ),
                  }
                if (h.zmq_stale)
                  return {
                    result: 'failure',
                    message: i18n(
                      'ZMQ block feed is stale, block notifications are falling back to RPC polling',
                    ),
                  }
                return {
                  result: 'success',
                  message: i18n('ZMQ block notifications are flowing'),
                }
              },
            },
            requires: ['api'],
          }
        : null,
    )
    .addOneshot('tls-cert', () =>
      store.tlsEnabled
        ? {
            subcontainer: kamadoSub,
            exec: {
              // Generates (or migrates) the persisted self-signed stratum
              // certificate under /root/.kamado/tls. Idempotent: regenerates
              // only when files are missing or the cert-format version marker
              // is outdated.
              command: ['kamado-tls-init.sh'],
              env: { TLS_DIR: tlsDir },
            },
            requires: ['dirs'],
          }
        : null,
    )
    .addDaemon('stunnel', () =>
      stunnelEnabled
        ? {
            subcontainer: kamadoSub,
            exec: {
              command: ['stunnel4', `${stunnelConfDir}/stratum.conf`],
            },
            ready: {
              display: i18n('Stratum TLS'),
              fn: () =>
                sdk.healthCheck.checkPortListening(
                  effects,
                  stratumTlsInternalPort,
                  {
                    successMessage: i18n(
                      'TLS stratum is accepting connections',
                    ),
                    errorMessage: i18n(
                      'TLS stratum is not accepting connections',
                    ),
                  },
                ),
            },
            // stunnel now runs only when local TLS is on, and that is exactly
            // when the self-signed certificate it serves is generated, so the
            // oneshot is always the dependency.
            requires: ['tls-cert'],
          }
        : null,
    )
})
