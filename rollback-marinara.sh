#!/usr/bin/env bash
# 직전 패치 이미지(marinara-patched:previous)로 되돌린다. 데이터는 건드리지 않는다.
set -euo pipefail
cd "$(dirname "$0")"
docker image inspect marinara-patched:previous >/dev/null 2>&1 || { echo "previous 이미지가 없습니다."; exit 1; }
docker tag marinara-patched:previous marinara-patched:lite
docker compose up -d --no-build
echo "롤백 완료. 확인: docker logs --tail 30 marinara"
