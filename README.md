# marinara-server-patch

Marinara Engine 공식 `lite` Docker 이미지 위에 개인 확장용 서버 모듈을 얹는 패치.

- `/api/qr-panel`  — QR Panel 서버 저장 모듈 (`DATA_DIR/qr-panel`)
- `/api/ext-store` — User Status / GM Journal 등 확장 공용 저장소 (`DATA_DIR/ext-store`)

## 서버에서 사용

```bash
cd ~/marinara          # docker-compose.yml + .env 가 있는 운영 폴더
./update-marinara.sh   # 공식 이미지 pull → 패치 빌드 → 재시작 → health 확인
./rollback-marinara.sh # 문제 시 직전 이미지로 복귀
```

데이터 volume(`marinara-data`)은 어떤 스크립트도 건드리지 않는다.
