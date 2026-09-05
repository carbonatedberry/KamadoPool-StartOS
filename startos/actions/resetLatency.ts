import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { uiPort } from '../utils'

export const resetLatency = sdk.Action.withoutInput(
  // id
  'reset-latency',

  // metadata
  async ({ effects }) => ({
    name: i18n('Reset Block Latency'),
    description: i18n(
      'Zeroes the block-update latency counters (avg, last, wasted work, block count). Use this after tuning ZMQ or ckpool to start fresh measurements.',
    ),
    warning: null,
    allowedStatuses: 'only-running',
    group: null,
    visibility: 'enabled',
  }),

  // the execution function
  async ({ effects }) => {
    const ok = await sdk.SubContainer.withTemp(
      effects,
      { imageId: 'main' },
      null,
      'reset-latency',
      async (sub) => {
        const res = await sub.exec([
          'curl',
          '-sf',
          '--max-time',
          '10',
          '-X',
          'POST',
          `http://127.0.0.1:${uiPort}/api/admin/reset-latency`,
        ])
        return res.exitCode === 0
      },
    )

    if (!ok) {
      return {
        version: '1',
        title: i18n('Reset Block Latency'),
        message: i18n(
          'Failed to reset latency stats, the Kamado API did not respond',
        ),
        result: null,
      }
    }

    return {
      version: '1',
      title: i18n('Reset Block Latency'),
      message: i18n('Block latency stats reset to zero'),
      result: {
        type: 'single',
        value: i18n(
          'All latency counters (count, avg, last, wasted work) have been cleared. New measurements will accumulate from the next block.',
        ),
        copyable: false,
        qr: false,
        masked: false,
      },
    }
  },
)
