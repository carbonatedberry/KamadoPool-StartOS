import { VersionInfo } from '@start9labs/start-sdk'

export const v0_2_1 = VersionInfo.of({
  version: '0.2.1:0',
  releaseNotes: {
    en_US:
      'Stratum TLS now works over the internet with no certificate setup: attach a clearnet domain to the Stratum (TLS) interface and StartOS issues a Let’s Encrypt certificate that Kamado serves automatically. The self-signed certificate is still served on the same port for miners on your local network, chosen per connection, so both work at once without a second port. The TLS switch in Configure is now "Stratum TLS (Local Network)" and covers only the self-signed certificate, and the TLS interface is always listed so you can attach a domain to it without enabling local TLS first. The dashboard padlock now shows which of the two certificates each miner is using when you hover it.',
    es_ES:
      'Stratum TLS ahora funciona por internet sin configurar ningún certificado: adjunte un dominio de clearnet a la interfaz Stratum (TLS) y StartOS emitirá un certificado de Let’s Encrypt que Kamado sirve automáticamente. El certificado autofirmado se sigue sirviendo en el mismo puerto para los mineros de su red local, elegido por conexión, así que ambos casos funcionan a la vez sin un segundo puerto. El interruptor TLS en Configurar ahora se llama «Stratum TLS (red local)» y cubre solo el certificado autofirmado, y la interfaz TLS aparece siempre, de modo que puede adjuntarle un dominio sin activar antes el TLS local. El candado del panel ahora indica, al pasar el ratón, cuál de los dos certificados usa cada minero.',
    de_DE:
      'Stratum-TLS funktioniert jetzt ohne Zertifikatseinrichtung über das Internet: Hängen Sie eine Clearnet-Domain an die Schnittstelle Stratum (TLS) an, und StartOS stellt ein Let’s-Encrypt-Zertifikat aus, das Kamado automatisch bereitstellt. Das selbstsignierte Zertifikat wird weiterhin auf demselben Port für Miner im lokalen Netzwerk bereitgestellt, pro Verbindung ausgewählt, beides funktioniert gleichzeitig, ohne zweiten Port. Der TLS-Schalter unter „Konfigurieren“ heißt jetzt „Stratum-TLS (lokales Netzwerk)“ und betrifft nur das selbstsignierte Zertifikat, und die TLS-Schnittstelle wird immer angezeigt, sodass Sie ihr eine Domain zuweisen können, ohne zuvor lokales TLS zu aktivieren. Das Schloss-Symbol im Dashboard zeigt beim Daraufzeigen, welches der beiden Zertifikate ein Miner verwendet.',
    pl_PL:
      'Stratum TLS działa teraz przez internet bez konfigurowania certyfikatu: podłącz domenę clearnet do interfejsu Stratum (TLS), a StartOS wystawi certyfikat Let’s Encrypt, który Kamado udostępnia automatycznie. Certyfikat samopodpisany jest nadal udostępniany na tym samym porcie dla górników w sieci lokalnej, wybierany dla każdego połączenia, więc oba przypadki działają jednocześnie bez drugiego portu. Przełącznik TLS w akcji Konfiguruj nazywa się teraz „Stratum TLS (sieć lokalna)” i dotyczy wyłącznie certyfikatu samopodpisanego, a interfejs TLS jest zawsze widoczny, więc można podłączyć do niego domenę bez wcześniejszego włączania lokalnego TLS. Kłódka w panelu pokazuje po najechaniu kursorem, którego z dwóch certyfikatów używa dany górnik.',
    fr_FR:
      'Le stratum TLS fonctionne désormais sur internet sans aucune configuration de certificat : rattachez un domaine clearnet à l’interface Stratum (TLS) et StartOS émet un certificat Let’s Encrypt que Kamado présente automatiquement. Le certificat auto-signé reste présenté sur le même port pour les mineurs de votre réseau local, choisi connexion par connexion, si bien que les deux fonctionnent simultanément sans second port. Le commutateur TLS dans Configurer s’appelle maintenant « Stratum TLS (réseau local) » et ne concerne que le certificat auto-signé, et l’interface TLS est toujours affichée, ce qui permet d’y rattacher un domaine sans activer d’abord le TLS local. Le cadenas du tableau de bord indique désormais au survol lequel des deux certificats chaque mineur utilise.',
  },
  // No data migration in either direction. store.json is unchanged, the TLS
  // toggle deliberately kept its `tlsEnabled` key when its scope narrowed to
  // the local network, so existing settings carry over untouched. The new
  // unconditional stratum-tls binding is registered by setInterfaces on init,
  // and the certificates for public domains are fetched fresh on every start
  // rather than persisted, so there is nothing to convert or undo.
  migrations: {},
})
