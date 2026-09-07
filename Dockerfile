# ──────────────────────────────────────────────
# Marinara Engine (공식 lite 이미지) + 개인 확장 서버 패치
#   - /api/qr-panel   : QR Panel 서버 저장 모듈
#   - /api/ext-store  : User Status / GM Journal 등 확장 공용 저장소
#
# 공식 이미지를 그대로 쓰고 그 위에 컴파일된 JS 몇 개만 얹는다.
# 컴파일 없음 → 빌드 몇 초, 메모리 거의 사용 안 함.
# ──────────────────────────────────────────────
FROM ghcr.io/pasta-devs/marinara-engine:lite

COPY patch /opt/marinara-patch
RUN node /opt/marinara-patch/apply-patch.mjs
