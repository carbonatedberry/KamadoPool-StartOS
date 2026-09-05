# Kamado Pool

Kamado is a solo Bitcoin mining pool built on a patched fork of CKPool-solo, with a Go middleware API and a real-time Svelte dashboard. When a miner connected to your Kamado instance solves a block, **the full block reward goes to the payout address that miner connected with**, no pool fees, no splits, no share accounting.

## What you get on StartOS

- **A running solo pool**: stratum server (ckpool), middleware API, and web dashboard, supervised as separate daemons with individual health checks.
- **A real-time dashboard** with live hashrate, per-miner stats, hardware detection, block history, best-share leaderboards, and a transaction accelerator.
- **Direct LAN stratum access**: StartOS 0.4.0 exposes the stratum TCP port on your network, no router port-forward or proxy needed (this was a 0.3.x limitation).
- **Stratum TLS on both sides of the network**: a Let's Encrypt certificate issued by StartOS for miners connecting over a clearnet domain, and a persisted self-signed certificate for miners on the LAN, each on its own port, both alongside the plaintext endpoint.
- **Verifiable proof of work**: the actual block header behind your best share, with a full-screen walkthrough of the SHA-256 that anyone can repeat for themselves.

## Setup

1. Install and start **Bitcoin Core**. Kamado requires it running and synced; mining on an unsynced node produces invalid work.
2. Accept the suggested task to enable **ZMQ** on Bitcoin Core (recommended, it gives sub-second new-block detection; without it Kamado falls back to RPC polling).
3. Start Kamado Pool and open the **Web Dashboard** from the interface list.

There is no payout address to configure. CKPool-solo pays the full block reward directly to whichever Bitcoin address the miner connects with as its stratum username, see **Connecting miners** below. Kamado validates worker usernames against Bitcoin Core and **refuses to authenticate any worker whose username is not a valid address on the active network**, so misconfigured miners fail loudly instead of silently mining to the wrong place.

## Connecting miners

The stratum port defaults to **3333** and can be changed in the *Configure* action, that setting is the network port your miners connect to. Check the **Stratum** interface after saving to see the port actually in use, since the OS assigns a different one if your choice is already claimed by another service. Point each miner at:

```text
stratum+tcp://<your-server-lan-address>:<stratum-port>
```

- **Username**: the Bitcoin address that should receive the block reward, optionally followed by `.workername` for labelling in the dashboard (e.g. `bc1q....myBitaxe`).
- **Password**: ignored, anything works.

### Stratum over TLS

Kamado offers two separate TLS endpoints, because they are secured in different ways:

**Over the internet, Stratum (TLS, Public Domain).** Attach a domain to this interface in the StartOS UI and choose Let's Encrypt. StartOS obtains and renews the certificate and terminates TLS itself, so miners validate it against their normal root store with nothing pasted in. See *Reaching the pool from the internet* below, attaching the domain is not quite the whole setup.

**On your local network, Stratum (TLS, Local Network).** Enable **Stratum TLS (Local Network)** in *Configure* to serve a self-signed certificate on its own port. Public certificate authorities cannot sign a bare LAN IP or a `.local` name, so this path stays self-signed and miners must be told to trust it. Run the **Stratum TLS Certificate** action to get:

- the **SHA-256 fingerprint** for firmwares that pin fingerprints, and
- the **full PEM** to paste into firmwares that accept a custom root (AxeOS exposes a *Stratum SSL Cert* field for exactly this).

Otherwise connect with `stratum+ssl://` and certificate verification disabled. Use the **Regenerate TLS Certificate** action to rotate it; miners that pin it will need the new fingerprint.

Both TLS endpoints and the plaintext one run at the same time on their own ports, and the dashboard's padlock names which certificate each miner arrived on when you hover it.

### Reaching the pool from the internet

Miners outside your network use the **Stratum (TLS, Public Domain)** interface:

1. **Attach a domain** to that interface and choose Let's Encrypt. Point its DNS at whatever address the internet reaches your server on.
2. **Point miners at the domain and its port.** A domain is published on the port set in *Configure* (Preferred Stratum TLS Port (Public Domain)), which can differ from the port shown for IP-based access on the same interface. The **Pool Status** action lists every endpoint and every attached domain with the port it is published on.

```text
stratum+ssl://<your-domain>:<public-tls-port>
```

Set the miner to use its **system/built-in certificates**, a Let's Encrypt chain validates against any normal root store with nothing pasted in.

Two things worth knowing if a certificate never appears:

- **Issuance validates on port 443 of your domain**, using the TLS-ALPN-01 challenge, regardless of which port the pool itself runs on. If your server isn't reachable on 443 for that name, issuance fails and StartOS falls back to a self-signed certificate that public clients reject.
- **A hostname that has failed validation repeatedly gets rate-limited** by Let's Encrypt (5 failures per hostname per hour), and StartOS retries roughly every minute, so a name that failed early can stay stuck long after the original cause is fixed. Check `start-cli server logs | grep -i acme`; if you see `ACME order failed` looping, remove the domain to stop the retries, wait for the hour to clear, then re-add it. Using a fresh hostname sidesteps it entirely.

## Proving your best share

Every share that sets a new record is stored with the block header behind it, version, previous block, merkle root, time, bits and nonce, plus the coinbase transaction and merkle branches needed to rebuild that merkle root. The dashboard's **best share** tile opens an analysis page, and **Show PoW** there opens the header itself, drawn as a block with every field in place.

This is worth having because a screenshot of a big difficulty number proves nothing, anyone can edit one, and a picture cannot show whether the work was ever done. The raw 80 bytes on that page are the share hash's exact preimage: anyone can hash them and see for themselves both that the hash is genuine and that finding it took the work claimed. Because the header commits to the previous block, and through the merkle root to the coinbase transaction that pays you, the proof cannot be lifted from another miner's share or replayed from a different block.

Press **Verify** and the page takes over the screen to replay the entire verification in your browser, from the real computation: rebuilding the merkle root fold by fold, padding the header into two 512-bit message blocks, then every SHA-256 compression round with a live view of all 256 bits of the working state, ending on the block hash and its comparison against the share and network targets. A copyable one-line terminal command is on the page too, if you would rather check it outside the browser entirely.

Headers are recorded from version 0.2.3 onward. A best share found before that cannot be reconstructed, CKPool discards job data once work moves on, so until a new record is set, the page shows the best share since the update and says so plainly.

## Configuration

Everything lives in the **Configure** action: the three stratum ports (plaintext, local-network TLS, public-domain TLS), vardiff (starting/min/max difficulty), idle-client disconnect, the coinbase tag embedded in solved blocks, ZMQ, local-network TLS, log level, and an optional self-hosted mempool explorer URL for dashboard links.

Which domain is used for public TLS is deliberately *not* a config option, it follows whatever you attach to the **Stratum (TLS, Public Domain)** interface, so there is no second copy of that setting to drift out of sync with what the OS actually has. Only its port lives in *Configure*.

Changing a port rebinds the interface without restarting the pool, so miners already connected on other ports keep hashing, but anything pointed at the old port must be updated. Setting any two of the three ports to the same number is rejected when you save.

## Actions

- **Pool Status**: full text snapshot: Bitcoin Core sync, ckpool health, miners, hashrate, found blocks, submit-gap and proof-of-work capture diagnostics.
- **Stratum TLS Certificate**: fingerprint + PEM for miner setup.
- **Regenerate TLS Certificate**: clears the cert; a fresh one is generated on next start.
- **Reset Block Latency**: zeroes the block-update latency counters after tuning.
- **Rebuild Share Statistics**: recounts the all-time difficulty distribution and rejection reasons by rereading CKPool's log, for when those totals look wrong.

## Troubleshooting

- **No miners appear after connecting**: check the Stratum interface for the right port, and confirm the miner reaches it (`telnet <server> <port>`). Check the Kamado logs.
- **Bitcoin Core RPC errors**: make sure Bitcoin Core is running and fully synced; Kamado's *Bitcoin Core RPC* health check shows the current state.
- **Best share resets to 0 after a block is found**: upstream CKPool zeroes the "current round" best diff on solve. Kamado ships a patch that also exposes the all-time best, so the dashboard has both columns.
- **The proof-of-work page is empty**: headers are only recorded from 0.2.3 onward, and only for shares accepted after the service restarted into that version, nothing earlier can be reconstructed. The next accepted share fills it in. If it stays empty, the **Pool Status** action traces the capture pipeline link by link and names which one is broken.
- **All-time share statistics look wrong or reset**: run the **Rebuild Share Statistics** action. It recounts them from CKPool's log, and only replaces the stored totals when the log accounts for more shares than they hold, so it can restore history but never erase it.
- **A burst of rejected shares right after restarting**: fixed in 0.2.3. Earlier versions sent miners work before telling them the difficulty and reset every miner to the pool's starting difficulty, so the first shares after each restart came back rejected. If you still see it, confirm the service is on 0.2.3 or later.
- **Miner rejects the TLS certificate**: re-check that the PEM was pasted completely (including the BEGIN/END lines), or pin the SHA-256 fingerprint, or disable verification in the miner.
- **A miner set to system certificates rejects the public-domain endpoint** (`No matching trusted root certificate found`, mbedTLS `-0x2700`/`-0x3000`): StartOS is serving its own self-signed certificate because Let's Encrypt never issued one. Check `start-cli server logs | grep -i acme` for `ACME order failed`, and confirm your server is reachable on **port 443** for that domain, that is where the TLS-ALPN-01 challenge is performed, whatever port the pool runs on. A hostname that failed repeatedly may also be rate-limited; see *Reaching the pool from the internet* above. Verify what is actually served with:

  ```sh
  openssl s_client -connect <domain>:<port> -servername <domain> </dev/null 2>/dev/null | openssl x509 -noout -issuer
  ```
- **Miner rejects the certificate on a public domain**: make sure it is connecting by the domain name, not by IP, the certificate is only valid for the name. If it is using the name and still fails, the firmware's CA root store may not include Let's Encrypt's ISRG Root X1; pin the certificate or use the plaintext endpoint for that miner.
- **The public domain's certificate is not being served**: it takes a few minutes after adding a domain for StartOS to complete the ACME challenge, and the certificate is the OS's to issue, check the domain on the **Stratum (TLS, Public Domain)** interface, that its DNS points at your server, and that the port is reachable from the internet. The other endpoints keep serving meanwhile.

## Upstream

CKPool-solo by Con Kolivas: <https://bitbucket.org/ckolivas/ckpool>
