<p align="center">
  <img src="icon.png" alt="Kamado Pool" width="160" />
</p>

<h1 align="center">Kamado Pool</h1>

Kamado Pool is a solo Bitcoin mining pool: a patched CKPool-solo stratum server, a Go middleware API, and a Svelte dashboard, packaged as one StartOS service. Block rewards are paid by the coinbase directly to the address each miner connects with, so the service holds no balances and performs no payouts.

Everything not listed in this document should behave the same as upstream.

## Image and Container Runtime

The package builds a single image from the repository Dockerfile and runs every process inside one shared subcontainer, so the API can reach CKPool's Unix socket and tail its log file without cross-container plumbing.

| Property | Value |
|---|---|
| Image id | `main` |
| Source | `Dockerfile` at the repository root |
| Architectures | `x86_64`, `aarch64` |
| Base | Debian slim |
| Subcontainer | one shared instance for all processes |

The image is assembled in four stages: CKPool compiled from upstream source with the Kamado patch series applied, the dashboard built to static assets, the Go API cross compiled with those assets embedded in the binary, and a runtime stage carrying the two binaries plus `curl`, `jq`, `stunnel4` and `openssl`.

Processes, in start order:

| Name | Kind | Purpose |
|---|---|---|
| `dirs` | oneshot | Creates the data, TLS, log and socket directories on the volumes |
| `api` | daemon | Serves the dashboard, REST API and WebSocket feed; aggregates CKPool and Bitcoin Core state |
| `ckpool` | daemon | Stratum server; waits for Bitcoin Core, detects the active chain, then execs CKPool |
| `tls-cert` | oneshot | Generates the self-signed stratum certificate when absent or outdated |
| `stunnel` | daemon | Terminates stratum TLS and forwards to CKPool's loopback bind |

## Volume and Data Layout

Two volumes separate the service's own state from CKPool's, because they have different lifetimes and different restore semantics.

| Volume | Mount point | Contents |
|---|---|---|
| `main` | `/root/.kamado` | SQLite database (found blocks, share statistics, accelerated transactions, log cursor), persisted stratum TLS certificate and key |
| `ckpool` | `/root/.ckpool` | CKPool's own state directory and its log files |

Bitcoin Core's data directory is mounted read only at `/mnt/bitcoind`, solely to read the RPC cookie. Nothing is written there.

The rendered CKPool configuration and the stunnel configuration live on the subcontainer root filesystem rather than on a volume. Both are regenerated on every start, because both depend on values that are not known until the service runs: the active chain and the ports the OS actually assigned.

## File Models

The package owns one persisted settings file, and everything else it writes is regenerated from that file plus runtime state.

| File | Location | Seeded | Rewritten by |
|---|---|---|---|
| `store.json` | `main` volume | Defaults on first start, or migrated from the previous package format | The Configure action |
| CKPool configuration | subcontainer rootfs | Rendered on every start | Service start, from `store.json` and the detected chain |
| stunnel configuration | subcontainer rootfs | Rendered on every start | Service start, from `store.json` and the assigned ports |
| TLS certificate and key | `main` volume | Generated on first start | The Regenerate TLS Certificate action, or automatically when the certificate format changes |

Hand edits do not survive. The two rendered configurations are overwritten on every start, and `store.json` is owned by the Configure action. Change settings through Configure rather than by editing files.

## Dependencies

Bitcoin Core is required. Kamado builds block templates from it, validates miner payout addresses against it, and submits solved blocks to it, so the service cannot mine without it.

| Dependency | Requirement | Health checks required | Mounts |
|---|---|---|---|
| Bitcoin Core | Required, must be running | Its own health check and its sync progress | Its data directory, read only, for the RPC cookie |

Sync progress is required deliberately. Mining against an unsynced node produces work on a stale chain tip, so an unsynced node is surfaced as an unsatisfied dependency rather than as a warning.

## Network Access and Interfaces

Four interfaces are published. The dashboard is a web interface; the three stratum interfaces are raw TCP endpoints that miners connect to directly, with no proxy in front of them.

| Interface | Type | Protocol | Purpose |
|---|---|---|---|
| Web Dashboard | ui | http | Dashboard, REST API and WebSocket feed |
| Stratum | api | tcp | Plaintext stratum, the default for miners on a trusted network |
| Stratum (TLS, Local Network) | api | tcp | Stratum over TLS using the package's self-signed certificate |
| Stratum (TLS, Public Domain) | api | tcp | Stratum over TLS using a certificate StartOS issues for an attached domain |

All three stratum endpoints run at the same time on separate ports. The stratum ports are configurable, but the numbers set in Configure are requests rather than guarantees: the OS assigns a different port when the requested one is already claimed, and the Pool Status action reports the ports actually in use.

The two TLS interfaces exist because they are secured differently. The local-network one serves a self-signed certificate that miners must be told to trust, since no public certificate authority will sign a bare LAN address. The public-domain one relies on StartOS issuing and renewing a publicly trusted certificate for a domain attached to that interface, which requires that domain to be reachable for the issuance challenge.

The dashboard's API refuses cross-origin browser requests on its WebSocket and on every request that changes state, so another site cannot drive it using a signed-in browser session.

## Installation and First-Run Flow

Installation differs from upstream mainly in that there is no payout address to configure and no pool account to create.

1. Install and start Bitcoin Core and let it finish syncing. The dependency stays unsatisfied until it does.
2. Accept the suggested task to enable ZMQ on Bitcoin Core. It is recommended rather than required; without it the service falls back to RPC polling.
3. Start Kamado Pool. On first start it creates its directories, generates a self-signed stratum certificate, detects which chain Bitcoin Core is running, and renders the CKPool configuration for that chain.
4. Open the Web Dashboard and point miners at the stratum port.

Miners authenticate with a Bitcoin address as the stratum username, optionally followed by a worker name for labelling. The service validates that username against Bitcoin Core and refuses to authorise a worker whose username is not a valid address on the active chain, so a misconfigured miner fails loudly instead of mining to nowhere.

## Actions

Every action is user-facing; none are hidden. Configure is the only one that changes settings, and the rest are diagnostic or maintenance operations.

| Action | Run it when | What it changes | Cost | Safe to repeat |
|---|---|---|---|---|
| Configure | Changing ports, vardiff, the coinbase tag, ZMQ, local TLS, log level or the explorer URL | Writes `store.json` | Rebinds interfaces; a port change does not restart the pool | Yes |
| Pool Status | Diagnosing anything | Nothing | One pass of internal queries | Yes |
| Stratum TLS Certificate | Setting up a miner that must trust the self-signed certificate | Nothing | Reads the stored certificate | Yes |
| Regenerate TLS Certificate | Rotating an expired or distrusted certificate | Deletes the stored certificate and key | A fresh certificate is generated on the next start | Yes, but miners pinning the old fingerprint must be updated |
| Reset Block Latency | After tuning ZMQ or the node, to start fresh measurements | Zeroes the block-update latency counters | Immediate | Yes |
| Rebuild Share Statistics | The all-time difficulty distribution or rejection reasons look wrong | Replaces the stored totals, but only when the log accounts for more shares than they hold | Reads the entire CKPool log, which can run to millions of lines | Yes; a second run is refused while one is in progress |

Pool Status returns a full text report: dependency and sync state, pool health, connected miners, hashrate, found blocks, the gap between attempted and confirmed block submissions, the endpoints and any domains actually in use, and the state of proof-of-work header capture. Stratum TLS Certificate returns both the SHA-256 fingerprint, for firmware that pins fingerprints, and the full PEM, for firmware that accepts a custom root. Rebuild Share Statistics reports how many shares the log accounted for and whether the stored totals were replaced.

## Tasks

One task is raised, and only when the operator has asked for ZMQ.

| Task | Raised when | Severity | Cleared when |
|---|---|---|---|
| Enable ZMQ on Bitcoin Core | ZMQ is enabled in Configure and Bitcoin Core does not have its ZMQ publishers on | Important | Bitcoin Core's configuration matches, or ZMQ is turned off in Configure |

It is important rather than critical because the service degrades gracefully. Without ZMQ it polls the RPC for new blocks instead, at the cost of slower stale-work detection.

## Health Checks

Six checks cover the two daemons, the dependency, and three failure modes that process state alone cannot reveal.

| Check | Probes | Grace period | Failure means | Remediation |
|---|---|---|---|---|
| Web Dashboard | The dashboard port is accepting connections | 15 seconds | The API is not serving | Check the service logs |
| Stratum Server | The stratum port is accepting connections | 30 seconds | Miners cannot connect | Check the service logs; CKPool waits for Bitcoin Core before it binds |
| Bitcoin Core RPC | The API can reach Bitcoin Core and it reports itself synced | Startup only | No usable templates, so no useful work is served | Check that Bitcoin Core is running and synced |
| Block Submission | Every attempted block submission reached confirmation | Startup only | A solved block was submitted but never confirmed | Check the Bitcoin Core logs; of these checks this is the one worth investigating immediately |
| ZMQ Block Feed | Block notifications are still arriving, when ZMQ is enabled | Startup only | Notifications have gone stale and detection has fallen back to polling | Re-run the ZMQ task, or check Bitcoin Core's publishers |
| Stratum TLS | The TLS stratum port is accepting connections, when local TLS is enabled | Startup only | Miners using TLS cannot connect | Confirm the certificate exists; regenerate it if not |

## Backups and Restore

Both volumes are backed up in full, because the service's history has no other source.

The `main` volume carries the SQLite database and the stratum TLS certificate, so a restore preserves found blocks, share statistics, best-share records, and the certificate that miners may have pinned. The `ckpool` volume carries CKPool's state and its logs. The logs are included deliberately rather than treated as disposable: the database holds a read cursor into them and the share statistics can be rebuilt from them, so restoring one without the other leaves the two inconsistent.

Nothing is excluded. There is no wallet, no key material beyond the stratum certificate, and no accounting state to rebuild, because rewards are paid by the coinbase directly to miners.

## Limitations and Differences

These are the places where the packaged service is narrower than upstream, or where the OS rather than the package has the final say. None of them prevent normal solo mining.

1. Only the chain Bitcoin Core is already running is supported. The service detects it at start; there is no chain selector.
2. The stratum ports set in Configure are requests, not guarantees. The OS assigns a different port when the requested one is taken.
3. The domain used for public-domain TLS is not a package setting. It follows whatever domain is attached to that interface, and only its port is configurable.
4. Certificates for a public domain are issued by StartOS rather than by the package. If issuance fails, that endpoint serves the self-signed certificate instead, which public clients reject.
5. The dashboard's read-only endpoints are not individually authenticated. Anything that can reach the dashboard port on the network can read pool data, including payout addresses and per-worker hashrates.
6. Proof-of-work header capture covers only shares accepted after that feature was introduced. Earlier best shares cannot be reconstructed, because CKPool discards job data once work moves on.
7. Share statistics can only be rebuilt as far back as the current CKPool log reaches.
8. The service kills CKPool when Bitcoin Core becomes unreachable, so miners fail over to a backup pool instead of mining stale work. CKPool restarts automatically once Bitcoin Core recovers.

## Quick Reference for AI Consumers

The block below summarises the operable surface in one place, for tooling and support agents that need the shape of the service without reading the sections above.

```yaml
service:
  purpose: solo Bitcoin mining pool; rewards paid by coinbase directly to the miner
  holds_funds: false
  payout_address: supplied by each miner as its stratum username

image:
  id: main
  architectures: [x86_64, aarch64]
  subcontainer: single, shared by all processes

processes:
  oneshots: [dirs, tls-cert]
  daemons: [api, ckpool, stunnel]

volumes:
  main: {mount: /root/.kamado, holds: [sqlite database, tls certificate]}
  ckpool: {mount: /root/.ckpool, holds: [ckpool state, logs]}
  bitcoind: {mount: /mnt/bitcoind, mode: read-only, purpose: rpc cookie}

dependencies:
  bitcoind: {required: true, must_be: [running, synced]}

interfaces:
  ui: {name: Web Dashboard, protocol: http}
  stratum: {protocol: tcp, tls: false}
  stratum-tls: {protocol: tcp, tls: self-signed}
  stratum-tls-public: {protocol: tcp, tls: issued-by-startos}

actions:
  configure: {mutates: settings}
  pool-status: {mutates: nothing, use_for: diagnosis}
  stratum-tls-certificate: {mutates: nothing, returns: [fingerprint, pem]}
  regenerate-tls-certificate: {mutates: tls certificate}
  reset-block-latency: {mutates: latency counters}
  rebuild-share-statistics: {mutates: all-time share statistics, cost: full log scan}

health_checks:
  [web dashboard, stratum server, bitcoin core rpc, block submission,
   zmq block feed, stratum tls]

tasks:
  enable-zmq: {target: bitcoind, severity: important, optional: true}

backups:
  volumes: [main, ckpool]
  excluded: none

first_run:
  requires: bitcoin core running and synced
  generates: self-signed stratum certificate
  configuration_needed: none for mining; miners supply their own payout address
```
