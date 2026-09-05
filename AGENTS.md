# Maintaining this package

Notes for whoever builds and ships the package. Nothing here is repeated
from `README.md`, which describes the runtime surface, or from
`instructions.md`, which is written for end users.

## Source layout

Kamado's own source is not vendored. The Makefile rsyncs `api/`, `ui/`
and `ckpool/` from a sibling checkout into `./kamado-src/`, which is
gitignored, before packing. Override the location with
`KAMADO_SRC=/path/to/KamadoPool`.

```text
startos/
  manifest/        id, image, volumes, bitcoind dependency
  main.ts          subcontainer, config rendering, daemons, health checks
  interfaces.ts    dashboard and the three stratum interfaces
  fileModels/      store.json
  actions/         the user-facing actions
  dependencies.ts  bitcoind requirement and the ZMQ task
  backups.ts       both volumes
  versions/        version graph and release notes
  init/            store seeding and init ordering
  i18n/            dictionaries for every user-facing string
assets/scripts/    ckpool run wrapper, TLS certificate init
Dockerfile         ckpool, dashboard, API, runtime
```

## Prerequisites

Node and npm, Docker with buildx, `rsync`, and `start-cli`.

`start-cli` must be recent enough to pack `instructions.md`. Run
`start-cli s9pk list-ingredients`: if `./instructions.md` is absent from
the output, the build will silently ship without instructions and the
StartOS instructions page will be blank. Older builds also lack the
`--instructions` flag on `s9pk pack`.

`start-cli` resolves its configured StartOS host on every command,
including local ones like `s9pk pack`. The workspace config at
`.startos/config.yaml` (found by walking up from the working directory)
sets that host under `host.default`, and it must be a name that resolves
on the build machine even though packing never contacts it. The template
that `s9pk init-workspace` writes points at a Start9 development host,
which is what produces `Failed to resolve hostname` on a fresh workspace.

## Building

```sh
npm ci      # once
make setup  # once per boot: binfmt handlers and a multi-platform builder
make        # kamado-pool.s9pk, universal, ship this
```

`make x86` and `make arm` emit single-arch packages and skip the other
architecture, which is much faster while iterating.

Only the CKPool and runtime stages are built for the target
architecture, and the aarch64 half of those runs under emulation on an
x86 host, which is why `make setup` is needed. The dashboard and API
stages pin `--platform=$BUILDPLATFORM` and cross compile instead: the
dashboard emits architecture-independent assets, and the API is
`CGO_ENABLED=0` with a pure-Go SQLite driver, so `GOARCH` cross
compilation is exact and the two slowest stages never run emulated.

`make setup` installs binfmt handlers from `tonistiigi/binfmt`. The
older `multiarch/qemu-user-static` image ships a qemu whose emulated gcc
segfaults intermittently part way through the CKPool build, which
presents as an unexplained compiler failure in bundled jansson or in the
test link step.

## Build failures worth recognising

**`Failed to resolve hostname`.** The workspace host does not resolve.
See Prerequisites above.

**A compiler crash inside the CKPool stage.** Usually emulation, not the
code. Re-run `make`; cached layers make the retry cheap. If it recurs,
confirm `make setup` installed the current binfmt handlers.

**`429 Too Many Requests` pulling base images.** Docker Hub's anonymous
pull limit, reached easily when iterating. It clears on its own, or
`docker login` raises the ceiling immediately.

## Installing

```sh
make install
```

Requires the workspace host to point at a real server. Otherwise
sideload the produced `.s9pk` through the StartOS web interface, which
accepts a reinstall of the same version.

## Release checklist

1. Add a version file under `startos/versions/` with release notes in
   every locale the package already supports, and register it in
   `versions/index.ts` as `current`, moving the previous version into
   `other` so existing installs keep a migration path.
2. Keep `migrations` empty unless stored data actually changes shape,
   and say why in a comment either way.
3. Update `README.md` if the runtime surface changed: processes,
   volumes, interfaces, actions, tasks, health checks, backups or
   limitations. Update `instructions.md` if operator-facing behaviour
   changed.
4. Add any new user-facing string to the i18n dictionaries. The `i18n`
   helper is typed against them, so a missing entry fails the typecheck
   rather than shipping untranslated.
5. `npm run check` and `make`, then confirm the packed manifest reports
   the intended version and that `instructions.md` is present in the
   archive.
