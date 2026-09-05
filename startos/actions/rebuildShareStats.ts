import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { uiPort } from '../utils'

export const rebuildShareStats = sdk.Action.withoutInput(
  // id
  'rebuild-share-stats',

  // metadata
  async ({ effects }) => ({
    name: i18n('Rebuild Share Statistics'),
    description: i18n(
      'Recounts the all-time share statistics, the difficulty distribution and rejection reasons on the Stats page, by rereading CKPool’s log from the beginning. Use this if those totals look wrong or reset. The stored totals are only replaced when the log accounts for more shares than they do, so this can add history back but never erase it.',
    ),
    warning: i18n(
      'On a pool with a long history this reads millions of log lines and can take a while. The pool keeps mining throughout.',
    ),
    allowedStatuses: 'only-running',
    group: null,
    visibility: 'enabled',
  }),

  // the execution function
  async ({ effects }) => {
    // No --max-time: the scan is deliberately unbounded on a large log.
    const res = await sdk.SubContainer.withTemp(
      effects,
      { imageId: 'main' },
      null,
      'rebuild-share-stats',
      async (sub) =>
        sub.exec([
          'curl',
          '-sf',
          '-X',
          'POST',
          `http://127.0.0.1:${uiPort}/api/admin/rebuild-share-stats`,
        ]),
    )

    if (res.exitCode !== 0) {
      return {
        version: '1',
        title: i18n('Rebuild Share Statistics'),
        message: i18n(
          'Failed to rebuild share statistics, the Kamado API did not respond',
        ),
        result: null,
      }
    }

    let adopted = false
    let shares = 0
    try {
      const parsed = JSON.parse((res.stdout || '').toString())
      adopted = parsed.adopted === true
      shares = Number(parsed.shares_in_log ?? 0)
    } catch {
      // Fall through to the generic message below.
    }

    return {
      version: '1',
      title: i18n('Rebuild Share Statistics'),
      message: adopted
        ? i18n('Share statistics rebuilt from the CKPool log')
        : i18n('Share statistics left unchanged'),
      result: {
        type: 'single',
        value: adopted
          ? `${shares.toLocaleString()} accepted shares were counted in the log and are now reflected in the all-time difficulty distribution and rejection reasons on the Stats page.`
          : `The log accounts for ${shares.toLocaleString()} accepted shares, which is no more than the stored totals already hold, so nothing was replaced.`,
        copyable: false,
        qr: false,
        masked: false,
      },
    }
  },
)
