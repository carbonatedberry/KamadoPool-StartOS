# syntax=docker/dockerfile:1.6
#
# Kamado Pool StartOS package image.
#
# Kamado's own source is fetched by this Dockerfile rather than expected
# in the build context, so the package builds from a clone of this repo
# alone. That is what Start9's build box does: it clones the package
# repo and runs `make <package-id>.s9pk`, with no sibling checkout
# present. The commit is pinned the same way ckpool's is, so a given
# package version always builds the same source.
#
# KAMADO_SOURCE selects where that source comes from:
#   git   (default) clone KAMADO_REPO at KAMADO_COMMIT. Reproducible,
#         and the only mode that works without a sibling checkout.
#   local copy ./kamado-src, which the Makefile rsyncs from a sibling
#         checkout. Picks up uncommitted edits, for fast iteration.
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

# ---------------------------------------------------------------------
# REPLACE BOTH before publishing. The manifest passes these as build
# args, so the values there win over these defaults; keep them in step.
#   KAMADO_REPO   git URL of the KamadoPool source, publicly clonable
#   KAMADO_COMMIT full 40 character commit SHA to build, never a branch
# ---------------------------------------------------------------------
ARG KAMADO_REPO=REPLACE_WITH_KAMADO_GIT_URL
ARG KAMADO_COMMIT=REPLACE_WITH_KAMADO_COMMIT_SHA
ARG KAMADO_SOURCE=git

# ---------- stage 0: acquire Kamado source ----------
# Two interchangeable stages producing the same layout at /kamado:
# api/, ui/ and ckpool/patches/. Only the one selected by KAMADO_SOURCE
# is built, so the local variant costs nothing on a build box that has
# no ./kamado-src, and the git variant costs nothing during local work.
FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS kamado-src-git
ARG KAMADO_REPO
ARG KAMADO_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "${KAMADO_REPO}" in REPLACE_WITH_*) \
        echo "KAMADO_REPO is still the placeholder; set it in the manifest build args" >&2; \
        exit 1;; esac; \
    case "${KAMADO_COMMIT}" in REPLACE_WITH_*) \
        echo "KAMADO_COMMIT is still the placeholder; set it in the manifest build args" >&2; \
        exit 1;; esac; \
    git clone "${KAMADO_REPO}" /kamado; \
    cd /kamado; \
    git checkout --detach "${KAMADO_COMMIT}"; \
    rm -rf .git

FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS kamado-src-local
COPY kamado-src/ /kamado/

FROM kamado-src-${KAMADO_SOURCE} AS kamado-src

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
COPY --from=kamado-src /kamado/ckpool/patches/ /tmp/kamado-patches/
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
COPY --from=kamado-src /kamado/ui/package.json ./
RUN npm install --no-audit --no-fund
COPY --from=kamado-src /kamado/ui/ ./
RUN npm run build

# ---------- stage 3: build the Go api with embedded UI ----------
# Runs natively on the build host and cross-compiles to $TARGETARCH.
FROM --platform=$BUILDPLATFORM golang:1.22-bookworm AS api-build
ARG TARGETARCH
WORKDIR /src
COPY --from=kamado-src /kamado/api/go.mod ./
RUN go mod download 2>/dev/null || true
COPY --from=kamado-src /kamado/api/ ./
RUN rm -rf internal/webui/dist && mkdir -p internal/webui/dist
COPY --from=ui-build /ui/dist/ internal/webui/dist/
RUN CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" go build \
        -trimpath -ldflags="-s -w" \
        -o /out/kamado-api ./cmd/kamado-api \
    && file /out/kamado-api 2>/dev/null || true

# ---------- stage 4: runtime ----------
# No supervisor and no entrypoint script: StartOS runs kamado-api,
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
