import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  ckpoolPublicTlsPort,
  defaultStratumPort,
  defaultStratumPublicTlsPort,
  defaultStratumTlsPort,
  stratumHostId,
  stratumInternalPort,
  stratumPublicTlsHostId,
  stratumTlsHostId,
  stratumTlsInternalPort,
  uiHostId,
  uiPort,
} from './utils'

export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  // The user's stratum ports are EXTERNAL ports only. Read reactively so
  // changing them in the Configure action re-runs this and updates the
  // binding. The in-container ports stay fixed (see utils.ts), so each change
  // updates the existing binding rather than orphaning it.
  //
  // The TLS toggle is deliberately NOT read here: both stratum interfaces now
  // exist unconditionally, so toggling it no longer rebinds anything, it
  // only changes which certificates stunnel serves, which is main.ts's job.
  const ports = await storeJson
    .read((s) => ({
      stratum: s.stratumPort,
      stratumTls: s.stratumTlsPort,
      publicTls: s.stratumPublicTlsPort,
    }))
    .const(effects)

  const externalStratumPort = ports?.stratum ?? defaultStratumPort
  const externalStratumTlsPort = ports?.stratumTls ?? defaultStratumTlsPort
  const externalPublicTlsPort = ports?.publicTls ?? defaultStratumPublicTlsPort

  // Web dashboard
  const uiMulti = sdk.MultiHost.of(effects, uiHostId)
  const uiMultiOrigin = await uiMulti.bindPort(uiPort, {
    protocol: 'http',
  })
  const ui = sdk.createInterface(effects, {
    name: i18n('Web Dashboard'),
    id: 'ui',
    description: i18n(
      'Real-time Kamado Pool dashboard (hashrate, miners, blocks, best shares)',
    ),
    type: 'ui',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })
  const uiReceipt = await uiMultiOrigin.export([ui])
  const receipts = [uiReceipt]

  // Plaintext stratum, a raw TCP interface. Unlike StartOS 0.3.x, 0.4.0
  // forwards raw TCP on the LAN, so miners connect directly to the host at
  // the assigned external port; no router forward or simpleproxy needed.
  const stratumMulti = sdk.MultiHost.of(effects, stratumHostId)
  const stratumOrigin = await stratumMulti.bindPort(stratumInternalPort, {
    protocol: null,
    preferredExternalPort: externalStratumPort,
    addSsl: null,
    secure: { ssl: false },
  })
  const stratum = sdk.createInterface(effects, {
    name: i18n('Stratum'),
    id: 'stratum',
    description: i18n(
      'Plaintext stratum endpoint. Point miners here with their Bitcoin payout address as the username',
    ),
    type: 'api',
    masked: false,
    schemeOverride: { ssl: 'stratum+ssl', noSsl: 'stratum+tcp' },
    username: null,
    path: '',
    query: {},
  })
  receipts.push(await stratumOrigin.export([stratum]))

  // TLS stratum, stunnel terminates TLS and forwards to one of ckpool's
  // loopback-only binds. The OS sees a raw TCP port; TLS lives at the app
  // layer, so the noSsl scheme is deliberately stratum+ssl.
  //
  // This is bound and exported UNCONDITIONALLY, unlike the local-TLS toggle
  // that used to gate it. A public domain is attached to an interface in the
  // StartOS UI, so gating the interface on the toggle made the Let's Encrypt
  // path unreachable for anyone who had not first enabled the self-signed
  // one, there was nothing to attach the domain to. main.ts decides whether
  // stunnel actually runs; when neither a certificate nor a domain is
  // configured the port simply doesn't answer, and the Stratum TLS health
  // check says so.
  const tlsMulti = sdk.MultiHost.of(effects, stratumTlsHostId)
  const tlsOrigin = await tlsMulti.bindPort(stratumTlsInternalPort, {
    protocol: null,
    preferredExternalPort: externalStratumTlsPort,
    addSsl: null,
    secure: { ssl: false },
  })
  const stratumTls = sdk.createInterface(effects, {
    name: i18n('Stratum (TLS, Local Network)'),
    id: 'stratum-tls',
    description: i18n(
      'TLS-encrypted stratum endpoint for miners on your local network, using the self-signed certificate (see the Stratum TLS Certificate action). Do not attach a public domain here, StartOS cannot issue a certificate for this endpoint; use Stratum (TLS, Public Domain) instead',
    ),
    type: 'api',
    masked: false,
    schemeOverride: { ssl: 'stratum+ssl', noSsl: 'stratum+ssl' },
    username: null,
    path: '',
    query: {},
  })
  receipts.push(await tlsOrigin.export([stratumTls]))

  // TLS stratum over a public domain, terminated by StartOS, not by us.
  //
  // This is the only way to get a publicly-trusted certificate: StartOS
  // provisions ACME certificates solely for bindings it terminates TLS for,
  // so a raw TCP binding (the two above) is offered no certificate authority
  // at all when you attach a domain to it, no Let's Encrypt, not even the
  // StartOS root CA. Declaring `addSsl` hands the OS the TLS layer, which is
  // what makes the LE option appear in the domain dialog.
  //
  // `secure: null` keeps this endpoint TLS-only: the OS publishes the SSL
  // port and does not also expose the decrypted one. It forwards plaintext
  // over the LXC bridge into ckpool's third bind, whose serverurl index is
  // what tells the dashboard this miner arrived on a CA-issued certificate.
  const publicTlsMulti = sdk.MultiHost.of(effects, stratumPublicTlsHostId)
  const publicTlsOrigin = await publicTlsMulti.bindPort(ckpoolPublicTlsPort, {
    protocol: null,
    preferredExternalPort: ckpoolPublicTlsPort,
    addSsl: {
      preferredExternalPort: externalPublicTlsPort,
      alpn: null,
      addXForwardedHeaders: false,
      auth: null,
    },
    secure: null,
  })
  const stratumPublicTls = sdk.createInterface(effects, {
    name: i18n('Stratum (TLS, Public Domain)'),
    id: 'stratum-tls-public',
    description: i18n(
      'TLS-encrypted stratum endpoint for miners connecting over the internet. Attach a domain here and StartOS issues a Let’s Encrypt certificate for it, which any miner validates with nothing pasted in',
    ),
    type: 'api',
    masked: false,
    schemeOverride: { ssl: 'stratum+ssl', noSsl: 'stratum+ssl' },
    username: null,
    path: '',
    query: {},
  })
  receipts.push(await publicTlsOrigin.export([stratumPublicTls]))

  // Drop bindings we no longer use. With fixed internal ports and
  // unconditional TLS bindings, all four are now permanent, this only
  // clears orphans left by older versions of this package, which did move the
  // internal port and did drop the TLS binding when the toggle was off.
  await sdk.clearBindings(effects, {
    except: [
      { id: uiHostId, internalPort: uiPort },
      { id: stratumHostId, internalPort: stratumInternalPort },
      { id: stratumTlsHostId, internalPort: stratumTlsInternalPort },
      { id: stratumPublicTlsHostId, internalPort: ckpoolPublicTlsPort },
    ],
  })

  // Exported service interfaces are a SECOND registry, independent of the
  // bindings above and with its own cleanup effect. Clearing bindings alone
  // leaves an orphaned interface record behind, which the UI still lists, so
  // a port change can produce two identical "Stratum" rows.
  await effects.clearServiceInterfaces({
    except: ['ui', 'stratum', 'stratum-tls', 'stratum-tls-public'],
  })

  return receipts
})
