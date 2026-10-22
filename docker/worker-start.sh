#!/bin/sh
# Démarrage du worker (image Docker, cible `worker`).
#
# Tas V8 : environ 75 % de la limite mémoire du conteneur (`WORKER_MEM_LIMIT`),
# le reste couvrant ce qui vit hors du tas (code, Prisma, cache HTTP du radar).
# Sans cela, Node choisit seul sa limite et le worker peut mourir en
# `FatalProcessOutOfMemory` (issue #64). Un `--max-old-space-size` déjà présent
# dans `NODE_OPTIONS` (`WORKER_NODE_OPTIONS`) l'emporte.
set -eu

case "${NODE_OPTIONS:-}" in
  *--max-old-space-size*) ;;
  *)
    limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null ||
      cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo max)
    case "$limit" in
      '' | max | *[!0-9]*) heap= ;;
      *) heap=$((limit / 1048576 * 3 / 4)) ;;
    esac
    # Pas de limite (ou limite absurde, cgroup v1 « illimité ») : défaut de Node.
    if [ -n "$heap" ] && [ "$heap" -ge 64 ] && [ "$heap" -le 65536 ]; then
      export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$heap"
    fi
    ;;
esac

echo "worker: NODE_OPTIONS=${NODE_OPTIONS:-}" >&2
exec node --import tsx worker/index.ts
