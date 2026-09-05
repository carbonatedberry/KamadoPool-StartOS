import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  defaultStratumPort,
  defaultStratumPublicTlsPort,
  defaultStratumTlsPort,
  logLevels,
  validatePorts,
} from '../utils'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  stratumPort: Value.number({
    name: i18n('Preferred Stratum Port'),
    description: i18n(
      'Network port to publish plaintext stratum on. This is a request, not a guarantee: if the port is already claimed the OS assigns a different one and warns you. Run the Pool Status action to see the ports actually in use. Changing this does not interrupt connected miners.',
    ),
    required: true,
    default: defaultStratumPort,
    integer: true,
    min: 1,
    max: 65535,
  }),
  stratumTlsPort: Value.number({
    name: i18n('Preferred Stratum TLS Port (Local Network)'),
    description: i18n(
      'Network port to publish local-network TLS stratum on, using the self-signed certificate. A request, not a guarantee, see Pool Status for the port actually in use.',
    ),
    required: true,
    default: defaultStratumTlsPort,
    integer: true,
    min: 1,
    max: 65535,
  }),
  stratumPublicTlsPort: Value.number({
    name: i18n('Preferred Stratum TLS Port (Public Domain)'),
    description: i18n(
      'Network port to publish public-domain TLS stratum on. A domain attached to the Stratum (TLS, Public Domain) interface is published on THIS port, which can differ from the one the OS assigns for IP access, and StartOS issues a Let’s Encrypt certificate for it, miners validate it with nothing pasted in. See Pool Status for the ports and domains actually in use.',
    ),
    required: true,
    default: defaultStratumPublicTlsPort,
    integer: true,
    min: 1,
    max: 65535,
  }),
  coinbaseTag: Value.text({
    name: i18n('Coinbase Tag'),
    description: i18n(
      'Short string embedded in the coinbase transaction of solved blocks.',
    ),
    required: true,
    default: '/Kamado/',
    patterns: [],
  }),
  zmqEnabled: Value.toggle({
    name: i18n('ZMQ Block Notifications'),
    description: i18n(
      "Subscribe to Bitcoin Core's hashblock ZMQ topic for sub-second block detection. RPC polling remains active as a fallback either way.",
    ),
    default: true,
  }),
  // Storage key stays `tlsEnabled` so existing installs keep their setting;
  // only the scope it describes narrowed. TLS over a public domain is not
  // covered by this toggle, it follows the domains attached to the Stratum
  // (TLS) interface and needs no configuration here.
  tlsEnabled: Value.toggle({
    name: i18n('Stratum TLS (Local Network)'),
    description: i18n(
      'Serve the self-signed certificate on the local-network TLS port. Miners have to trust it (see the Stratum TLS Certificate action) or connect with verification disabled. You do NOT need this for miners connecting over a public domain: attach the domain to the Stratum (TLS, Public Domain) interface instead, and StartOS issues a publicly trusted certificate for it automatically.',
    ),
    default: false,
  }),
  startDiff: Value.number({
    name: i18n('Starting Difficulty'),
    description: i18n(
      'Initial vardiff target for new miner connections. Bitaxe-class miners typically land around 16384.',
    ),
    required: true,
    default: 16384,
    integer: true,
    min: 1,
  }),
  minDiff: Value.number({
    name: i18n('Minimum Difficulty'),
    description: i18n('Floor for the vardiff algorithm.'),
    required: true,
    default: 1000,
    integer: true,
    min: 1,
  }),
  maxDiff: Value.number({
    name: i18n('Maximum Difficulty'),
    description: i18n('Ceiling for the vardiff algorithm. 0 means no cap.'),
    required: true,
    default: 0,
    integer: true,
    min: 0,
  }),
  dropIdle: Value.number({
    name: i18n('Drop Idle (seconds)'),
    description: i18n(
      'Disconnect clients that have not submitted a share in this many seconds. 0 disables the idle disconnect.',
    ),
    required: true,
    default: 0,
    integer: true,
    min: 0,
    units: i18n('seconds'),
  }),
  logLevel: Value.select({
    name: i18n('Log Level'),
    description: i18n('Verbosity of the kamado-api log output.'),
    values: logLevels,
    default: 'info',
  }),
  mempoolExplorerUrl: Value.text({
    name: i18n('Custom Block Explorer URL'),
    description: i18n(
      'Base URL of a self-hosted mempool instance for dashboard links (e.g. https://mempool.example.com). Kamado appends /address/<addr> and /block/<hash>, so the instance must follow the standard mempool.space URL layout. Leave empty to use the public mempool.space.',
    ),
    required: false,
    default: null,
    patterns: [
      {
        regex: '^https?://[^\\s]+$',
        description: i18n(
          'Must be an http:// or https:// URL with no whitespace',
        ),
      },
    ],
  }),
})

export const config = sdk.Action.withInput(
  // id
  'config',

  // metadata
  async ({ effects }) => ({
    name: i18n('Configure'),
    description: i18n(
      'Customize vardiff, TLS, block notifications, logging, and explorer links',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  // form input specification
  inputSpec,

  // optionally pre-fill the input form
  async ({ effects }) => storeJson.read().once(),

  // the execution function
  async ({ effects, input }) => {
    // Refuse an unusable pair (both stratum ports set to the same number).
    // In-container ports are fixed constants, so the user can no longer create
    // a bind collision, only an ambiguous external-port request.
    const conflict = validatePorts({
      stratumPort: input.stratumPort,
      stratumTlsPort: input.stratumTlsPort,
      stratumPublicTlsPort: input.stratumPublicTlsPort,
    })
    if (conflict) throw new Error(conflict)

    return storeJson.merge(effects, input)
  },
)
