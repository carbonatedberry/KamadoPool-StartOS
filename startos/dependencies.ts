import { autoconfig } from 'bitcoin-core-startos/startos/actions/config/autoconfig'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'

export const setDependencies = sdk.setupDependencies(async ({ effects }) => {
  // When the user wants sub-second block detection, ask bitcoind to enable
  // its ZMQ publishers. Kamado degrades gracefully to RPC polling without it,
  // so this is 'important', not 'critical'. Reactive: toggling ZMQ off in
  // Kamado's config withdraws the request on the next re-run.
  const zmqWanted = await storeJson.read((s) => s.zmqEnabled).const(effects)

  if (zmqWanted) {
    await sdk.action.createTask(effects, 'bitcoind', autoconfig, 'important', {
      input: {
        kind: 'partial',
        accept: [{ zmqEnabled: true }],
        set: { zmqEnabled: true },
      },
      when: { condition: 'input-not-matches', once: false },
      reason: i18n(
        'Kamado Pool uses ZMQ block notifications for sub-second stale-work detection, every second of stale work in solo mode is hashrate burned on a dead block.',
      ),
    })
  }

  return {
    bitcoind: {
      kind: 'running',
      versionRange: '>=28.4:13',
      // sync-progress included deliberately: mining on an unsynced node
      // produces invalid work, so surface IBD as an unsatisfied dependency.
      healthChecks: ['bitcoind', 'sync-progress'],
    },
  }
})
