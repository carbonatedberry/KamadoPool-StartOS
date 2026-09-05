# Kamado Pool, StartOS 0.4.0 package.
#
# Prerequisites: node/npm, docker (with buildx), start-cli, rsync.
# First run `npm ci`, then:
#   make            -> kamado-pool.s9pk, the universal package (x86_64 +
#                      aarch64 in one file), this is what to ship.
#   make x86 / arm  -> single-arch packages, for faster dev iteration.
#
# Building the aarch64 image on an x86 host needs qemu binfmt handlers and
# a builder that advertises linux/arm64, `make setup` registers both.
#
# KamadoPool source is expected in a sibling checkout at ../KamadoPool
# (override with `make KAMADO_SRC=/path/to/KamadoPool`). It is synced into
# ./kamado-src before packing, because `start-cli s9pk pack` builds the
# Dockerfile with this directory as the only build context.

ARCHES := x86 arm
# Ship one universal s9pk by default rather than a per-arch pair.
TARGETS := universal

# Buildx builder used by `make setup`. Must advertise linux/amd64 and
# linux/arm64; network=host works around container-DNS breakage on hosts
# running systemd-resolved.
BUILDER ?= kamado-hostnet
KAMADO_SRC ?= ../KamadoPool

# Source files whose changes should trigger a re-sync + repack (excludes
# node_modules/dist build artifacts).
KAMADO_DEPS := $(shell find "$(KAMADO_SRC)/api" "$(KAMADO_SRC)/ui" "$(KAMADO_SRC)/ckpool" \
	\( -name node_modules -o -name dist \) -prune -o -type f -print 2>/dev/null)

ifeq (,$(wildcard node_modules/@start9labs/start-sdk/s9pk.mk))
$(error node_modules missing, run 'npm ci' first)
endif

# overrides to s9pk.mk must precede the include statement
include node_modules/@start9labs/start-sdk/s9pk.mk

kamado-src: $(KAMADO_DEPS)
	@test -d "$(KAMADO_SRC)/api" || { echo "Error: KamadoPool source not found at '$(KAMADO_SRC)'. Set KAMADO_SRC=/path/to/KamadoPool"; exit 1; }
	@echo "   Syncing KamadoPool source from '$(KAMADO_SRC)'..."
	@rsync -a --delete --exclude node_modules --exclude dist \
		"$(KAMADO_SRC)/api" "$(KAMADO_SRC)/ui" "$(KAMADO_SRC)/ckpool" kamado-src/
	@touch kamado-src

# Extra prerequisites for the pack targets defined in s9pk.mk: the Docker
# image build consumes ./kamado-src, so keep it fresh.
$(BASE_NAME).s9pk: kamado-src
$(BASE_NAME)_x86_64.s9pk: kamado-src
$(BASE_NAME)_aarch64.s9pk: kamado-src

# One-time (per boot) cross-arch build setup: register qemu binfmt
# handlers so the emulated aarch64 ckpool stage can run, and create a
# buildx builder that advertises both platforms.
#
# tonistiigi/binfmt, NOT multiarch/qemu-user-static: the latter ships
# qemu 7.2, whose emulated gcc segfaults intermittently on real builds
# (seen killing both the jansson compile and the test/sha256 link in the
# ckpool stage). The uninstall clears any older same-named handler first.
setup:
	-docker run --rm --privileged tonistiigi/binfmt --uninstall qemu-aarch64 2>/dev/null
	docker run --rm --privileged tonistiigi/binfmt --install arm64
	-docker buildx rm $(BUILDER) 2>/dev/null
	docker buildx create --name $(BUILDER) --driver docker-container \
		--driver-opt network=host \
		--platform linux/amd64,linux/arm64 --use
	docker buildx inspect --bootstrap $(BUILDER)
	@echo "Ready. 'make' will now build the universal package."

clean-src:
	rm -rf kamado-src

.PHONY: clean-src setup
