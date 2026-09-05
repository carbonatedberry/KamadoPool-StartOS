export const short = {
  en_US: 'Modern solo Bitcoin mining pool with real-time dashboard',
  es_ES: 'Pool moderno de minería solo de Bitcoin con panel en tiempo real',
  de_DE: 'Moderner Solo-Bitcoin-Mining-Pool mit Echtzeit-Dashboard',
  pl_PL: 'Nowoczesna solowa kopalnia Bitcoina z panelem czasu rzeczywistego',
  fr_FR:
    'Pool de minage solo Bitcoin moderne avec tableau de bord en temps réel',
}

export const long = {
  en_US:
    'Kamado Pool is a solo Bitcoin mining pool built on a patched fork of CKPool-solo. Unlike wrappers that read periodic stats files, Kamado talks directly to CKPool’s Unix socket API to expose real-time per-client hashrate, difficulty, hardware detection, full block history, and best-share leaderboards (current round and all-time) via a Svelte dashboard with WebSocket push. Miners connect to the stratum port with their payout address as username, block rewards go straight to them.',
  es_ES:
    'Kamado Pool es un pool de minería solo de Bitcoin basado en un fork parcheado de CKPool-solo. Kamado se comunica directamente con la API de socket Unix de CKPool para exponer en tiempo real el hashrate por cliente, la dificultad, la detección de hardware, el historial completo de bloques y las mejores participaciones (ronda actual e histórica) mediante un panel Svelte con WebSocket. Los mineros se conectan al puerto stratum usando su dirección de pago como usuario.',
  de_DE:
    'Kamado Pool ist ein Solo-Bitcoin-Mining-Pool auf Basis eines gepatchten CKPool-solo-Forks. Kamado kommuniziert direkt mit der Unix-Socket-API von CKPool und zeigt in Echtzeit Hashrate pro Client, Schwierigkeit, Hardware-Erkennung, vollständige Blockhistorie und Bestwert-Ranglisten (aktuelle Runde und Allzeit) über ein Svelte-Dashboard mit WebSocket-Push. Miner verbinden sich mit dem Stratum-Port und ihrer Auszahlungsadresse als Benutzername.',
  pl_PL:
    'Kamado Pool to solowa kopalnia Bitcoina oparta na załatanym forku CKPool-solo. Kamado komunikuje się bezpośrednio z API gniazda Unix CKPool, udostępniając w czasie rzeczywistym hashrate poszczególnych klientów, trudność, wykrywanie sprzętu, pełną historię bloków oraz rankingi najlepszych udziałów (bieżąca runda i wszech czasów) w panelu Svelte z WebSocket. Górnicy łączą się z portem stratum, podając adres wypłaty jako nazwę użytkownika.',
  fr_FR:
    'Kamado Pool est un pool de minage solo Bitcoin basé sur un fork corrigé de CKPool-solo. Kamado communique directement avec l’API socket Unix de CKPool pour exposer en temps réel le hashrate par client, la difficulté, la détection du matériel, l’historique complet des blocs et les classements des meilleures parts (manche en cours et record absolu) via un tableau de bord Svelte avec WebSocket. Les mineurs se connectent au port stratum avec leur adresse de paiement comme nom d’utilisateur.',
}

export const bitcoindDescription = {
  en_US:
    'Used to build block templates, submit found blocks, and receive new block notifications via RPC + ZMQ.',
  es_ES:
    'Se usa para construir plantillas de bloques, enviar bloques encontrados y recibir notificaciones de nuevos bloques mediante RPC + ZMQ.',
  de_DE:
    'Wird verwendet, um Blockvorlagen zu erstellen, gefundene Blöcke einzureichen und neue Blockbenachrichtigungen über RPC + ZMQ zu erhalten.',
  pl_PL:
    'Służy do budowania szablonów bloków, przesyłania znalezionych bloków i odbierania powiadomień o nowych blokach przez RPC + ZMQ.',
  fr_FR:
    'Utilisé pour construire les modèles de blocs, soumettre les blocs trouvés et recevoir les notifications de nouveaux blocs via RPC + ZMQ.',
}
