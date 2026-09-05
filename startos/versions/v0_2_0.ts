import { IMPOSSIBLE, VersionInfo, YAML } from '@start9labs/start-sdk'
import { readFile, rm } from 'fs/promises'
import { storeJson } from '../fileModels/store.json'
import { defaultStratumPort, defaultStratumTlsPort, LogLevel } from '../utils'

/** Shape of the 0.3.5.1 wrapper's config.yaml (main volume, start9/config.yaml). */
type LegacyConfig = {
  bitcoind?: { type?: string }
  'stratum-port'?: number
  tls?: { enabled?: string; port?: number }
  'zmq-enabled'?: boolean
  advanced?: {
    'pool-identifier'?: string
    startdiff?: number
    mindiff?: number
    maxdiff?: number
    dropidle?: number
    'log-level'?: LogLevel
    'mempool-explorer'?: { type?: string; url?: string }
  }
}

export const v0_2_0 = VersionInfo.of({
  version: '0.2.0:3',
  releaseNotes: {
    en_US:
      'The configurable stratum ports now set only the external (network-facing) port. The in-container ports are fixed, so changing a port no longer leaves a duplicate Stratum interface behind and no longer restarts the pool, connected miners stay connected. StartOS 0.4.0 port: stratum is exposed directly on the LAN as a raw TCP interface (no more router forwards or simpleproxy), Bitcoin Core is reached over the internal network bridge with cookie authentication, and settings moved from Config to the Configure action. Existing settings, found-block history, and the stratum TLS certificate are migrated automatically.',
    es_ES:
      'Los puertos stratum configurables ahora solo definen el puerto externo (de red). Los puertos internos del contenedor son fijos, así que cambiar un puerto ya no deja una interfaz Stratum duplicada ni reinicia el pool: los mineros conectados siguen conectados. Adaptación a StartOS 0.4.0: Stratum se expone directamente en la LAN como interfaz TCP, Bitcoin Core se alcanza a través del puente de red interno con autenticación por cookie, y la configuración se movió a la acción Configurar. Los ajustes existentes, el historial de bloques y el certificado TLS se migran automáticamente.',
    de_DE:
      'Die konfigurierbaren Stratum-Ports legen jetzt nur noch den externen (netzseitigen) Port fest. Die containerinternen Ports sind fix, sodass eine Portänderung keine doppelte Stratum-Schnittstelle hinterlässt und den Pool nicht neu startet, verbundene Miner bleiben verbunden. Portierung auf StartOS 0.4.0: Stratum wird direkt im LAN als TCP-Schnittstelle bereitgestellt, Bitcoin Core wird über die interne Netzwerk-Bridge mit Cookie-Authentifizierung erreicht, und die Einstellungen sind in die Aktion „Konfigurieren“ umgezogen. Bestehende Einstellungen, Blockhistorie und das TLS-Zertifikat werden automatisch migriert.',
    pl_PL:
      'Konfigurowalne porty stratum ustawiają teraz wyłącznie port zewnętrzny (sieciowy). Porty wewnątrz kontenera są stałe, więc zmiana portu nie pozostawia już zduplikowanego interfejsu Stratum ani nie restartuje puli, podłączeni górnicy pozostają połączeni. Port na StartOS 0.4.0: Stratum jest udostępniany bezpośrednio w sieci LAN jako interfejs TCP, Bitcoin Core jest osiągany przez wewnętrzny mostek sieciowy z uwierzytelnianiem cookie, a ustawienia przeniesiono do akcji Konfiguruj. Istniejące ustawienia, historia bloków i certyfikat TLS są migrowane automatycznie.',
    fr_FR:
      'Les ports stratum configurables ne définissent plus que le port externe (côté réseau). Les ports internes au conteneur sont fixes : changer un port ne laisse plus d’interface Stratum en double et ne redémarre plus le pool, les mineurs connectés le restent. Portage vers StartOS 0.4.0 : Stratum est exposé directement sur le LAN comme interface TCP, Bitcoin Core est atteint via le pont réseau interne avec authentification par cookie, et les réglages ont migré vers l’action Configurer. Les réglages existants, l’historique des blocs et le certificat TLS sont migrés automatiquement.',
  },
  migrations: {
    up: async ({ effects }) => {
      // Migrate from the 0.3.5.1 wrapper: its config.yaml lives on the main
      // volume under start9/. The SQLite DB (data/kamado.db), TLS certs
      // (tls/) and the ckpool volume carry over untouched, only the config
      // format changed.
      const configYaml: LegacyConfig | undefined = await readFile(
        '/media/startos/volumes/main/start9/config.yaml',
        'utf-8',
      ).then(YAML.parse, () => undefined)

      if (configYaml) {
        const adv = configYaml.advanced ?? {}
        const mempool = adv['mempool-explorer']
        await storeJson.merge(effects, {
          // Carried over so miners pointed at the old forwarded port keep
          // working: the same number is requested as the interface's
          // preferred external port.
          stratumPort: configYaml['stratum-port'] ?? defaultStratumPort,
          stratumTlsPort: configYaml.tls?.port ?? defaultStratumTlsPort,
          coinbaseTag: adv['pool-identifier'] ?? '/Kamado/',
          startDiff: adv.startdiff ?? 16384,
          minDiff: adv.mindiff ?? 1000,
          maxDiff: adv.maxdiff ?? 0,
          dropIdle: adv.dropidle ?? 0,
          logLevel: adv['log-level'] ?? 'info',
          zmqEnabled: configYaml['zmq-enabled'] ?? true,
          tlsEnabled: configYaml.tls?.enabled === 'enabled',
          mempoolExplorerUrl:
            mempool?.type === 'custom' && mempool.url ? mempool.url : null,
        })

        // remove old start9 dir
        await rm('/media/startos/volumes/main/start9', {
          recursive: true,
        }).catch(console.error)
      }
    },
    down: IMPOSSIBLE,
  },
})
