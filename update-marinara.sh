#!/usr/bin/env bash
# ──────────────────────────────────────────────
# Marinara 업데이트 + 개인 확장 서버 패치 재적용 + 재시작 + 확인
#   사용법:  ./update-marinara.sh
#   데이터(volume marinara-data)는 절대 건드리지 않는다.
# ──────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

BASE_IMAGE="ghcr.io/pasta-devs/marinara-engine:lite"
PATCHED_IMAGE="marinara-patched:lite"
URL="http://127.0.0.1:7860"

# .env 에서 Basic Auth 정보만 읽어 health 확인에 사용
AUTH=()
if [ -f .env ]; then
  U=$(grep -E '^BASIC_AUTH_USER=' .env | cut -d= -f2- | tr -d '"' || true)
  P=$(grep -E '^BASIC_AUTH_PASS=' .env | cut -d= -f2- | tr -d '"' || true)
  [ -n "$U" ] && AUTH=(-u "$U:$P")
fi

echo "== [1/6] 현재 Marinara 버전"
docker exec marinara grep -m1 '"version"' package.json 2>/dev/null || echo "(컨테이너가 꺼져 있음)"

echo "== [2/6] 공식 이미지 최신 버전 받기"
docker pull "$BASE_IMAGE"

echo "== [3/6] 현재 패치 이미지를 previous 로 보관 (문제 시 롤백용)"
if docker image inspect "$PATCHED_IMAGE" >/dev/null 2>&1; then
  docker tag "$PATCHED_IMAGE" marinara-patched:previous
fi

echo "== [4/6] 패치 이미지 빌드 (공식 이미지 + QR Panel / ext-store 모듈)"
docker compose build

echo "== [5/6] 컨테이너 재시작 (데이터 volume 유지)"
docker compose up -d

echo "== [6/6] 서버 준비 대기 및 확인"
ok=0
for i in $(seq 1 60); do
  if curl -fs "${AUTH[@]}" -o /dev/null "$URL/api/qr-panel/health" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "!! /api/qr-panel/health 응답 없음. 로그 확인: docker logs --tail 50 marinara"
  echo "!! 롤백:  ./rollback-marinara.sh"
  exit 1
fi
echo "새 버전:        $(docker exec marinara grep -m1 '"version"' package.json)"
echo "qr-panel:       $(curl -s "${AUTH[@]}" "$URL/api/qr-panel/health")"
echo "ext-store:      $(curl -s "${AUTH[@]}" "$URL/api/ext-store/health")"
echo "이름 없는 옛 이미지 정리 (volume/데이터와 무관):"
docker image prune -f >/dev/null && echo "정리 완료"
echo "== 업데이트 완료"
