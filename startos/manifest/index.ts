import { setupManifest } from '@start9labs/start-sdk'
import { bitcoindDescription, long, short } from './i18n'

export const manifest = setupManifest({
  id: 'kamado-pool',
  title: 'Kamado Pool',
  license: 'GPL-3.0',
  packageRepo: 'https://github.com/carbonatedberry/KamadoPool-StartOS',
  upstreamRepo: 'https://github.com/carbonatedberry/KamadoPool',
  marketingUrl: 'https://github.com/carbonatedberry/KamadoPool',
  donationUrl: 'https://gist.github.com/carbonatedberry/e618849b563d7a16d18408de8975f6ff',
  description: { short, long },
  volumes: ['main', 'ckpool'],
  images: {
    main: {
      source: {
        dockerBuild: {
          dockerfile: 'Dockerfile',
          workdir: '.',
        },
      },
      arch: ['x86_64', 'aarch64'],
    },
  },
  dependencies: {
    bitcoind: {
      description: bitcoindDescription,
      optional: false,
      metadata: {
        title: 'Bitcoin Core',
        icon: 'https://raw.githubusercontent.com/Start9Labs/bitcoin-core-startos/refs/heads/30.x/dep-icon.svg',
      },
    },
  },
})
