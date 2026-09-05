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
          // The Dockerfile clones Kamado's source rather than taking it
          // from the build context, so this package builds from a clone
          // of itself with no sibling checkout present. Pin a full
          // commit SHA, never a branch: this is the only thing tying a
          // package version to the code it ships, so it has to be
          // updated before the version bump that releases that code.
          //
          // KAMADO_SOURCE comes from the environment so the Makefile can
          // select the local sibling checkout for fast iteration. The
          // Makefile always exports it, defaulting to `git`.
          buildArgs: {
            KAMADO_REPO: 'https://github.com/carbonatedberry/KamadoPool',
            KAMADO_COMMIT: '7bc894dbaf972f69694c2fd3346b86fcc90242b2',
            KAMADO_SOURCE: { env: 'KAMADO_SOURCE' },
          },
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
