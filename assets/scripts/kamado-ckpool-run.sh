#!/bin/bash
# Kamado Pool, ckpool daemon wrapper for StartOS 0.4.0.
#
# main.ts renders /etc/ckpool/ckpool.conf.template into the subcontainer
# rootfs with everything resolved except the coinbase-builder self-test
# address, which depends on the active network. This script:
#
#   1. Blocks until bitcoind answers getblockchaininfo, so ckpool is never
#      launched into a wall. When kamado-api kills ckpool on bitcoind
#      failure (letting miners fail over to a backup pool), StartOS
#      restarts this daemon and the wait re-arms until bitcoind recovers,
#      the 0.3.x supervised-restart loop, expressed as a daemon.
#   2. Detects the chain and substitutes a network-valid self-test address.
#      CKPool-solo uses the worker's stratum username as the payout address;
#      the conf `btcaddress` is only consulted once at startup to build and
#      validate a sample coinbase transaction against bitcoind. Since no
#      worker has connected yet at that point, we hand it the genesis block
#      coinbase address for the active network, always valid, and solo
#      mode never credits it a satoshi.
#   3. Renders the final conf and execs ckpool.
#
# Env (set by main.ts): BITCOIN_RPC_URL, BITCOIN_RPC_USER,
# BITCOIN_RPC_PASSWORD, CKPOOL_SOCKDIR.
set -euo pipefail

TEMPLATE=/etc/ckpool/ckpool.conf.template
CONF=/etc/ckpool/ckpool.conf
SOCKDIR="${CKPOOL_SOCKDIR:-/run/ckpool}"

# CKPool loglevel: 6 = LOG_INFO, required for share-level logging
# (Accepted/Rejected client lines) used by the stats feature.
CKPOOL_LOGLEVEL="${CKPOOL_LOGLEVEL:-6}"

rpc() {
    curl -sf --max-time 5 \
        -u "${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASSWORD}" \
        -d "{\"jsonrpc\":\"1.0\",\"method\":\"$1\",\"params\":[]}" \
        -H 'Content-Type: application/json' \
        "${BITCOIN_RPC_URL}"
}

echo "kamado-ckpool: waiting for bitcoind at ${BITCOIN_RPC_URL}..."
backoff=2
until CHAIN_INFO=$(rpc getblockchaininfo); do
    echo "kamado-ckpool: bitcoind not reachable (retry in ${backoff}s)"
    sleep "${backoff}"
    backoff=$(( backoff < 30 ? backoff * 2 : 30 ))
done

CHAIN=$(printf '%s' "${CHAIN_INFO}" | jq -r '.result.chain // "main"')
case "${CHAIN}" in
    main)
        # Satoshi's genesis block coinbase address.
        SELFTEST_ADDRESS="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        ;;
    test|testnet4|signet|regtest)
        # Testnet genesis coinbase address, valid P2PKH on testnet-family
        # networks (testnet3/testnet4/signet/regtest share address prefixes).
        SELFTEST_ADDRESS="mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn"
        ;;
    *)
        echo "kamado-ckpool: unknown chain '${CHAIN}', assuming mainnet" >&2
        SELFTEST_ADDRESS="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        ;;
esac

sed "s|@SELFTEST_ADDRESS@|${SELFTEST_ADDRESS}|g" "${TEMPLATE}" > "${CONF}"

mkdir -p "${SOCKDIR}"

echo "kamado-ckpool: starting ckpool (solo, chain=${CHAIN}), loglevel ${CKPOOL_LOGLEVEL}"
exec /usr/local/bin/ckpool --btcsolo --config "${CONF}" \
    --sockdir "${SOCKDIR}" --log-shares -l "${CKPOOL_LOGLEVEL}"
