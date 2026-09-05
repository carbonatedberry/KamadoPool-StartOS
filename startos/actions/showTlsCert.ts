import { readFile } from 'node:fs/promises'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { defaultStratumTlsPort } from '../utils'

/**
 * 0.4.0 replacement for the 0.3.x "properties" that published the stratum
 * TLS fingerprint and full PEM. Miners whose firmware verifies against a CA
 * bundle (AxeOS / Bitaxe) need the PEM pasted in as a custom root, or the
 * SHA-256 fingerprint pinned, depending on what the firmware exposes.
 */
export const showTlsCert = sdk.Action.withoutInput(
  // id
  'show-tls-cert',

  // metadata
  async ({ effects }) => ({
    name: i18n('Stratum TLS Certificate'),
    description: i18n(
      'Shows the self-signed stratum TLS certificate: SHA-256 fingerprint for pinning and the full PEM to paste into miner firmware (e.g. the AxeOS "Stratum SSL Cert" field).',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: (await storeJson.read((s) => s.tlsEnabled).const(effects))
      ? 'enabled'
      : { disabled: i18n('Enable Stratum TLS in Configure first') },
  }),

  // the execution function
  async ({ effects }) => {
    const tlsPort =
      (await storeJson.read((s) => s.stratumTlsPort).once()) ??
      defaultStratumTlsPort
    const notYet = i18n('(not yet generated, start the service once)')
    const fingerprint = await readFile(
      sdk.volumes.main.subpath('tls/fingerprint.txt'),
      'utf-8',
    )
      .then((s) => s.trim())
      .catch(() => notYet)
    const certPem = await readFile(
      sdk.volumes.main.subpath('tls/stratum.crt'),
      'utf-8',
    )
      .then((s) => s.trim())
      .catch(() => notYet)

    return {
      version: '1',
      title: i18n('Stratum TLS Certificate'),
      message: i18n(
        'Connect miners with stratum+ssl:// to the Stratum (TLS, Local Network) interface. The certificate is self-signed: paste the PEM into firmware that accepts a custom root, pin the fingerprint, or disable verification. Miners connecting over a public domain do not need any of this, they use the Stratum (TLS, Public Domain) interface and its CA-issued certificate.',
      ),
      result: {
        type: 'group',
        value: [
          {
            name: i18n('TLS Port (internal)'),
            description: i18n(
              'Container-side TLS stratum port. The externally reachable port is shown on the Stratum (TLS, Local Network) interface.',
            ),
            type: 'single',
            value: String(tlsPort),
            copyable: true,
            qr: false,
            masked: false,
          },
          {
            name: i18n('Fingerprint (SHA-256)'),
            description: i18n(
              'Use this for fingerprint pinning on miner firmwares that support it. Changes only when the certificate is regenerated.',
            ),
            type: 'single',
            value: fingerprint,
            copyable: true,
            qr: false,
            masked: false,
          },
          {
            name: i18n('Certificate (PEM)'),
            description: i18n(
              'Full self-signed certificate. Copy the whole block including the BEGIN/END CERTIFICATE markers.',
            ),
            type: 'single',
            value: certPem,
            copyable: true,
            qr: false,
            masked: false,
          },
        ],
      },
    }
  },
)
