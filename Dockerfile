# syntax=docker/dockerfile:1.6
#
# Kamado Pool StartOS 0.4.0 package image.
#
# KamadoPool source is expected at ./kamado-src (synced from a sibling
# checkout by `make kamado-src`; see the Makefile, override with
# KAMADO_SRC=/path/to/KamadoPool). `start-cli s9pk pack` builds this
# Dockerfile per architecture via buildx.
#
# The ckpool/ui/api build steps mirror the stages in KamadoPool's own
# ckpool/Dockerfile and api/Dockerfile.
#
# Cross-arch strategy: only the ckpool stage and the runtime stage are
# built for the target platform (emulated when building aarch64 on x86).
# The UI and API stages pin --platform=$BUILDPLATFORM and cross-compile,
# which is both correct and far faster than emulating them:
#   * the Svelte UI emits static assets, no target-arch code at all;
#   * kamado-api is CGO_ENABLED=0 with a pure-Go SQLite driver
#     (modernc.org/sqlite), so GOARCH cross-compilation is exact.

ARG CKPOOL_REPO=https://bitbucket.org/ckolivas/ckpool.git
ARG CKPOOL_COMMIT=cfb0f83b70d7b382b85d2bd0710cf4cb2dda4007

# ---------- stage 1: build patched ckpool ----------
# Clones upstream ckpool at the pinned commit, applies Kamado patches,
# builds with portable CFLAGS.
FROM debian:bookworm-slim AS ckpool-build
ARG CKPOOL_REPO
ARG CKPOOL_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential autoconf automake libtool pkg-config \
        libzmq3-dev ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone "${CKPOOL_REPO}" ckpool \
    && cd ckpool && git checkout "${CKPOOL_COMMIT}"
COPY kamado-src/ckpool/patches/ /tmp/kamado-patches/
RUN set -eux; cd /build/ckpool; \
    for p in /tmp/kamado-patches/*.patch; do \
        [ -f "$p" ] || continue; \
        echo "Applying $(basename "$p")"; \
        git apply --verbose "$p"; \
    done
RUN cd /build/ckpool \
    && ./autogen.sh \
    && CFLAGS="-O2 -Wall -pipe" ./configure --prefix=/usr/local \
    && make -j"$(nproc)"
RUN install -Dm755 /build/ckpool/src/ckpool /out/usr/local/bin/ckpool \
    && install -Dm755 /build/ckpool/src/ckpmsg /out/usr/local/bin/ckpmsg

# ---------- stage 2: build the Svelte UI ----------
# Runs natively on the build host; `npm run build` output is static
# JS/CSS/HTML, identical for every target architecture.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS ui-build
WORKDIR /ui
COPY kamado-src/ui/package.json ./
RUN npm install --no-audit --no-fund
COPY kamado-src/ui/ ./
RUN npm run build

# ---------- stage 3: build the Go api with embedded UI ----------
# Runs natively on the build host and cross-compiles to $TARGETARCH.
FROM --platform=$BUILDPLATFORM golang:1.22-bookworm AS api-build
ARG TARGETARCH
WORKDIR /src
COPY kamado-src/api/go.mod ./
RUN go mod download 2>/dev/null || true
COPY kamado-src/api/ ./
RUN rm -rf internal/webui/dist && mkdir -p internal/webui/dist
COPY --from=ui-build /ui/dist/ internal/webui/dist/
RUN CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" go build \
        -trimpath -ldflags="-s -w" \
        -o /out/kamado-api ./cmd/kamado-api \
    && file /out/kamado-api 2>/dev/null || true

# ---------- stage 4: runtime ----------
# No supervisor and no entrypoint script: StartOS 0.4.0 runs kamado-api,
# ckpool (via kamado-ckpool-run.sh), and stunnel as separate daemons in a
# shared subcontainer. curl + jq serve the bitcoind wait/chain-detection
# script and the in-container health checks.
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl jq libzmq5 stunnel4 openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ckpool-build /out/usr/local/bin/ckpool /usr/local/bin/ckpool
COPY --from=ckpool-build /out/usr/local/bin/ckpmsg /usr/local/bin/ckpmsg
COPY --from=api-build /out/kamado-api /usr/local/bin/kamado-api
COPY assets/scripts/kamado-ckpool-run.sh /usr/local/bin/kamado-ckpool-run.sh
COPY assets/scripts/kamado-tls-init.sh /usr/local/bin/kamado-tls-init.sh
# /etc/stunnel/stratum.conf is NOT baked in: its accept port is user config,
# so main.ts renders it into the subcontainer rootfs at startup.
RUN chmod +x /usr/local/bin/kamado-ckpool-run.sh /usr/local/bin/kamado-tls-init.sh \
    && mkdir -p /etc/ckpool /run/ckpool

# Documents the defaults only, the stratum ports are user-configurable and
# StartOS publishes ports from the interface bindings, not from EXPOSE.
EXPOSE 3333 3334 8080
WORKDIR /root
CMD ["kamado-api"]
