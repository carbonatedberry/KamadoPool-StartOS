#!/bin/bash
# Kamado Pool, stratum TLS certificate init (oneshot, idempotent).
#
# Generates the persisted self-signed stratum certificate the stunnel
# daemon serves. Regenerates only when files are missing or the cert-format
# version marker is outdated, so miners' pinned fingerprints survive
# restarts and updates. Run the "Regenerate TLS Certificate" action to
# force a fresh one.
#
# Env (set by main.ts): TLS_DIR (defaults to /root/.kamado/tls).
set -euo pipefail

TLS_DIR="${TLS_DIR:-/root/.kamado/tls}"
CRT="${TLS_DIR}/stratum.crt"
KEY="${TLS_DIR}/stratum.key"
CERT="${TLS_DIR}/stratum.pem"
MARKER="${TLS_DIR}/cert_version"

mkdir -p "${TLS_DIR}"

# Bump TLS_CERT_VERSION any time the cert format/extensions change.
# The startup check regenerates whenever the marker file is missing
# or doesn't match this version. This is more reliable than poking
# at the existing cert's extensions, we know *exactly* when a new
# shape is required and the upgrade self-heals on next boot.
# v4: broaden subjectAltName to cover mDNS / LAN / Tor hostnames
#     so miner firmwares that verify the SAN against the hostname
#     they were pointed at (e.g. AxeOS connecting to host.local)
#     stop failing with MBEDTLS_ERR_X509_CERT_VERIFY_FAILED.
TLS_CERT_VERSION=4

NEEDS_REGEN=false
if [[ ! -f "${CERT}" || ! -f "${CRT}" || ! -f "${KEY}" ]]; then
    NEEDS_REGEN=true
elif [[ ! -f "${MARKER}" ]] \
     || [[ "$(cat "${MARKER}" 2>/dev/null)" != "${TLS_CERT_VERSION}" ]]; then
    echo "kamado-tls: TLS cert is older format (want v${TLS_CERT_VERSION}); regenerating"
    NEEDS_REGEN=true
fi

if [[ "${NEEDS_REGEN}" == "true" ]]; then
    echo "kamado-tls: generating self-signed stratum TLS cert v${TLS_CERT_VERSION}"
    # Write the extensions to a config file rather than rely on
    # `-addext`: some openssl builds emit them into unpredictable
    # locations (e.g. CSR instead of the cert), and this is the
    # documented, cross-version way to pin the full extension set.
    CONF=$(mktemp)
    cat > "${CONF}" <<'OPENSSL_CONF'
[ req ]
default_bits       = 2048
default_md         = sha256
prompt             = no
distinguished_name = req_dn
x509_extensions    = v3_cert

[ req_dn ]
CN = kamado-pool

[ v3_cert ]
basicConstraints     = critical, CA:FALSE
keyUsage             = critical, digitalSignature, keyEncipherment
extendedKeyUsage     = serverAuth
subjectKeyIdentifier = hash
subjectAltName       = @alt_names

[ alt_names ]
# Specific StartOS / local names the pool might be reached through.
DNS.1  = kamado-pool.embassy
DNS.2  = kamado-pool
DNS.3  = localhost
# Wildcard SANs covering the TLDs miners typically use:
#   *.local     -> mDNS / Bonjour (e.g. obese-admirer.local on AxeOS)
#   *.embassy   -> StartOS inter-service hostnames
#   *.onion     -> Tor hidden services
#   *.home.arpa -> RFC 8375 home network namespace
#   *.lan       -> common consumer router default TLD
#   *.internal  -> some LAN setups
# Strictly leftmost-label wildcards per RFC 6125; libraries that
# enforce this (mbedtls, OpenSSL, BoringSSL, Go crypto/tls) all
# accept them.
DNS.4  = *.local
DNS.5  = *.embassy
DNS.6  = *.onion
DNS.7  = *.home.arpa
DNS.8  = *.lan
DNS.9  = *.internal
IP.1   = 127.0.0.1
OPENSSL_CONF

    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "${KEY}" \
        -out   "${CRT}" \
        -days 3650 \
        -config "${CONF}" \
        >/dev/null 2>&1
    rm -f "${CONF}"

    # stunnel reads cert+key in either order, but cert-first is the
    # convention openssl and most tooling expect.
    cat "${CRT}" "${KEY}" > "${CERT}"
    chmod 600 "${KEY}" "${CERT}"
    printf '%s\n' "${TLS_CERT_VERSION}" > "${MARKER}"

    # Log the extensions so operators can verify the cert is sane
    # from the service logs without needing to exec into the
    # container.
    echo "kamado-tls: cert extensions:"
    openssl x509 -in "${CRT}" -noout -ext subjectAltName,extendedKeyUsage,keyUsage 2>&1 \
        | sed 's/^/  /'
fi

FINGERPRINT=$(openssl x509 -in "${CRT}" -noout -fingerprint -sha256 | cut -d= -f2)
printf '%s\n' "${FINGERPRINT}" > "${TLS_DIR}/fingerprint.txt"
echo "kamado-tls: stratum TLS SHA256 fingerprint: ${FINGERPRINT}"
