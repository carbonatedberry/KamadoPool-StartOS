import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'
import {
  defaultStratumPort,
  defaultStratumPublicTlsPort,
  defaultStratumTlsPort,
} from '../utils'

/**
 * Persisted service settings (the 0.4.0 replacement for the 0.3.x
 * config.yaml). Every field carries a `.catch()` default, so merging `{}`
 * on install materializes a fully-populated file, and a corrupt or
 * hand-edited file self-heals to defaults instead of crashing the service.
 *
 * Ports are intentionally absent: internal ports are fixed constants (see
 * utils.ts) and external ports are remapped by the user through the StartOS
 * interface UI, not service config.
 */
export const storeJson = FileHelper.json(
  {
    base: sdk.volumes.main,
    subpath: '/store.json',
  },
  z.object({
    /**
     * EXTERNAL port miners connect to for plaintext stratum, requested as the
     * interface's `preferredExternalPort`. The in-container bind is a fixed
     * constant (see utils.ts), so changing this rebinds without restarting
     * ckpool and never orphans a binding.
     */
    stratumPort: z.number().int().min(1).max(65535).catch(defaultStratumPort),
    /** EXTERNAL port for TLS stratum with the self-signed (local) certificate. */
    stratumTlsPort: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .catch(defaultStratumTlsPort),
    /**
     * EXTERNAL port for TLS stratum with a CA-issued certificate, terminated
     * by StartOS. Separate from stratumTlsPort because the two endpoints are
     * terminated by different things, the OS owns this one, stunnel owns the
     * other, and a single external port cannot be handed to both.
     */
    stratumPublicTlsPort: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .catch(defaultStratumPublicTlsPort),
    /** Short string embedded in the coinbase transaction of solved blocks (ckpool btcsig). */
    coinbaseTag: z.string().catch('/Kamado/'),
    /** Initial vardiff target for new miner connections. */
    startDiff: z.number().int().min(1).catch(16384),
    /** Floor for the vardiff algorithm. */
    minDiff: z.number().int().min(1).catch(1000),
    /** Ceiling for the vardiff algorithm. 0 means no cap. */
    maxDiff: z.number().int().min(0).catch(0),
    /** Disconnect clients idle for this many seconds. 0 disables. */
    dropIdle: z.number().int().min(0).catch(0),
    /** kamado-api log verbosity. */
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).catch('info'),
    /** Subscribe kamado-api to bitcoind's hashblock ZMQ topic. */
    zmqEnabled: z.boolean().catch(true),
    /** Terminate TLS for stratum via the stunnel sidecar on stratumTlsPort. */
    tlsEnabled: z.boolean().catch(false),
    /**
     * Base URL of a self-hosted mempool instance for dashboard explorer
     * links. null -> use the public mempool.space.
     */
    mempoolExplorerUrl: z.string().nullable().catch(null),
    /**
     * Internal state, not a config field: signature of the port assignment the
     * user was last warned about (see portAssignmentSignature). Lets main warn
     * once per distinct outcome instead of on every start, and re-warn if the
     * assignment later changes. main must never read this reactively, it is
     * written from main, and a reactive read would restart the service in a
     * loop.
     */
    notifiedPortAssignment: z.string().nullable().catch(null),
  }),
)
