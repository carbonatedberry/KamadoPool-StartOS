import { rm } from 'node:fs/promises'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { tlsVolumeFiles } from '../utils'

export const regenTlsCert = sdk.Action.withoutInput(
  // id
  'regen-tls-cert',

  // metadata
  async ({ effects }) => ({
    name: i18n('Regenerate TLS Certificate'),
    description: i18n(
      'Clears the current stratum TLS certificate so a fresh one is generated on the next service start. Use this to rotate an expired or untrusted certificate.',
    ),
    warning: i18n(
      'Miners connected via TLS will be disconnected on restart and will need to accept or re-pin the new certificate fingerprint.',
    ),
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  // the execution function
  async ({ effects }) => {
    const removed: string[] = []
    const missing: string[] = []
    for (const f of tlsVolumeFiles) {
      const path = sdk.volumes.main.subpath(f)
      try {
        await rm(path)
        removed.push(f.replace(/^tls\//, ''))
      } catch {
        missing.push(f.replace(/^tls\//, ''))
      }
    }

    const hadCert = removed.length > 0
    const message = hadCert
      ? i18n(
          'TLS certificate cleared, restart the service to generate a new one',
        )
      : i18n('No TLS certificate files found (TLS may not have been enabled)')

    const detail = [
      hadCert
        ? `${i18n('Removed')}: ${removed.join(', ')}`
        : i18n('No certificate files were present.'),
      missing.length > 0
        ? `${i18n('Already absent')}: ${missing.join(', ')}`
        : '',
      '',
      i18n('Next steps:'),
      `  1. ${i18n('Restart Kamado Pool.')}`,
      `  2. ${i18n('Run the Stratum TLS Certificate action to see the new fingerprint and PEM.')}`,
      `  3. ${i18n('Provide the new fingerprint or PEM to miners that pin the certificate.')}`,
    ]
      .filter(Boolean)
      .join('\n')

    return {
      version: '1',
      title: i18n('Regenerate TLS Certificate'),
      message,
      result: {
        type: 'single',
        value: detail,
        copyable: false,
        qr: false,
        masked: false,
      },
    }
  },
)
