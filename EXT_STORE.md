# ext-store 사용 가이드 — 확장 공용 서버 저장소

> 대상: Marinara 개인 확장을 만들거나 고치는 사람(그리고 그 작업을 맡은 LLM 세션).
> ext-store는 **Marinara 기본 기능이 아니라 이 저장소(marinara-server-patch)가 얹는 개인 패치**다.

## 1. 무엇인가

브라우저 `localStorage`/`IndexedDB`에만 남던 확장의 전역 설정을 Marinara 서버에 저장해,
같은 서버에 접속한 모든 기기(PC·폰·태블릿)가 같은 설정을 쓰게 하는 작은 JSON 저장소다.

- 위치: 서버의 `DATA_DIR/ext-store/<namespace>.json` (Docker에서는 `/app/data/ext-store/`)
- 단위: **확장 하나 = 네임스페이스 하나 = JSON 파일 하나.** 부분 수정 없이 통째로 읽고 통째로 쓴다
- 한도: 파일 하나 **32MB**(`EXT_STORE_MAX_BYTES`)
- 네임스페이스 규칙: `^[a-z0-9][a-z0-9_-]{0,63}$` (소문자·숫자·`-`·`_`, 64자 이내)
- 백업: `ext-store` 폴더가 Marinara 프로필 백업(`backup.routes.js`의 `BACKUP_DIRS`)에 포함된다. 따로 백업할 필요 없음
- 인증: Marinara와 같은 출처의 `/api` 아래에 있으므로 Basic Auth·쿠키가 그대로 적용된다. 확장에서는 `marinara.apiFetch`(또는 same-origin `fetch`)로 부르면 된다

공식 Marinara에도 `marinara.storage`(Personal Extensions, v2.4.0+)라는 확장별 저장소가 있지만
JSON **1,000,000바이트** 한도이고 full page 런타임에서만 제공된다. 코드·CSS·이미지 URL 목록처럼
커지는 데이터, 또는 구버전 호스트도 지원해야 하는 확장은 ext-store를 쓴다.

### 현재 쓰는 네임스페이스

| namespace | 확장 | 저장 내용 |
|---|---|---|
| `user-status` | User Status 서버판 | 상태창 디자인 라이브러리·설정·채팅별 제목 |
| `gm-journal` | GM Journal 서버판 | 월드 엔진 지시문·전역 기본값 |
| `phonara` | Phonara | 전역 설정, 프로필, 채팅별 프로필, 지시문, 스킨, 외부 앱 |

QR Panel은 결과물이 커서 ext-store가 아니라 전용 모듈 `/api/qr-panel`(state + 채팅별 results 파일)을 쓴다.
새 확장은 특별한 이유가 없으면 ext-store에 네임스페이스 하나 잡는 것으로 충분하다.

## 2. HTTP API

모든 경로는 `/api/ext-store` 아래다. 요청·응답은 JSON.

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/health` | `{ ok: true, schemaVersion: 1, storage: "data-dir" }`. 모듈 존재 확인용 |
| `GET` | `/` | `{ namespaces: [{ namespace, updatedAt, bytes }] }` |
| `GET` | `/:namespace` | 있으면 `{ exists: true, schemaVersion, updatedAt, namespace, data }`, 없으면 `{ exists: false, schemaVersion: 1, namespace, data: null }` (둘 다 200) |
| `PUT` | `/:namespace` | 본문 `{ data: { ... } }`. **전체 교체.** 응답은 저장된 봉투 `{ schemaVersion, updatedAt, namespace, data }` |
| `DELETE` | `/:namespace` | 204. 파일 삭제 |

규칙:

- `data`는 **JSON 객체**여야 한다. 배열·문자열·null은 거부된다(zod 검증)
- `PUT`은 병합이 아니라 교체다. 키를 지우고 싶으면 그 키를 뺀 전체를 다시 보낸다
- `updatedAt`은 서버가 찍는 ISO 시각. 클라이언트는 이 값이 바뀌었는지로 "다른 기기가 저장했는지"를 판단한다
- 쓰기는 파일별 큐 + 임시 파일 후 rename(원자적)이라 동시 저장으로 파일이 깨지지 않는다. 다만 **마지막 쓰기가 이긴다**(충돌 병합 없음)

### 터미널에서 확인

```bash
# Basic Auth를 쓰면 -u 아이디:비밀번호 추가
curl -s http://127.0.0.1:7860/api/ext-store/health
curl -s http://127.0.0.1:7860/api/ext-store
curl -s http://127.0.0.1:7860/api/ext-store/phonara | head -c 300
curl -s -X PUT http://127.0.0.1:7860/api/ext-store/test-ns \
  -H 'Content-Type: application/json' -d '{"data":{"hello":1}}'
curl -s -X DELETE http://127.0.0.1:7860/api/ext-store/test-ns -o /dev/null -w '%{http_code}\n'
```

## 3. 확장에서 쓰는 방법 (공통 규칙)

세 확장(User Status·GM Journal·Phonara)이 같은 규칙을 쓴다. 새 확장도 이 규칙을 따른다.

1. **시작할 때 연결** — `GET /health`로 모듈이 있는지 본다. 없으면(404·네트워크 오류) 조용히 로컬 모드로 간다. 오류 토스트를 띄우지 않는다
2. **첫 연결은 병합** — `GET /:ns`로 서버 자료를 받아 이 브라우저 자료와 합친다.
   - 같은 id의 항목은 **서버 우선**
   - 이 브라우저에만 있는 항목(프로필·스킨·앱 등 id가 있는 것)은 서버에 **추가**하고, 추가한 게 있으면 즉시 PUT
   - 단일 값(기본 설정 등)은 서버 것을 그대로 쓴다
   - 서버가 비어 있으면 이 브라우저 자료를 처음 PUT
3. **저장은 디바운스 PUT** — 로컬(IndexedDB/localStorage)에 먼저 저장하고, 0.7초 안에 추가 변경이 없으면 PUT. 연결 전이거나 서버 자료를 적용하는 중이면 PUT하지 않는다
4. **20초 폴링** — `GET /:ns`의 `updatedAt`이 마지막으로 본 값과 다르면 서버 자료를 적용하고 다시 그린다. 사용자가 입력 중이면 이번 폴링은 건너뛴다. 연결이 끊겨 있으면 폴링 시점에 재연결을 시도한다
5. **실패해도 로컬은 계속** — 서버 오류는 로그와 상태 변수(`lastError`)에만 남긴다. 다음 폴링에서 재시도
6. **정리** — `marinara.onCleanup`에서 폴링을 멈추고, 대기 중인 PUT이 있으면 마지막으로 보낸다
7. **상태 노출** — `window.__<확장>ServerSync()` 같은 콘솔 함수로 `{ ready, updatedAt, lastError }`를 돌려주고, 설정 화면 어딘가에 "연결됨 / 미연결(이 브라우저만)"을 보여준다

### 동기화 대상을 고르는 기준

| 넣는다 | 넣지 않는다 |
|---|---|
| 모든 채팅에서 쓰는 전역 설정, 프로필, 지시문 | 채팅별 데이터 → 원래 **채팅 메타데이터**(`PATCH /api/chats/:id/metadata`)에 두면 이미 서버 동기화됨 |
| 사용자가 만든 스킨·템플릿·외부 앱 코드 | 창 위치, 접힘 상태, 열려 있던 탭 같은 **기기별 UI 상태** |
| 이미지의 URL·assetId·묘사 | 이미지 원본·base64, 무한히 쌓이는 로그 |

### 최소 구현 예 (붙여 넣어 이름만 바꾸면 되는 골격)

```js
// 전제: 확장에 marinara.apiFetch(path, opts) 가 있고, "/api" 접두를 붙여 JSON을 돌려준다.
//       G = 전역 설정 객체(메모리), saveLocal(G) = IndexedDB/localStorage 저장, applyGlobal(data) = data → G 적용 + 재렌더
const SRV_NS = "my-extension";                  // 네임스페이스 (소문자·숫자·-·_)
const SRV_MAPS = ["profiles", "templates"];     // id 단위로 합칠 맵 필드 이름들
let ready = false, busy = false, applying = false, timer = null, updatedAt = null, lastError = "";

function apply(data) { applying = true; try { applyGlobal(data); saveLocal(G); } finally { applying = false; } }
function merge(remote, local) {
  const out = Object.assign({}, remote); let pushBack = false;
  for (const k of SRV_MAPS) {
    const r = remote[k] || {}, l = local[k] || {}, m = Object.assign({}, r);
    for (const id of Object.keys(l)) if (!(id in m)) { m[id] = l[id]; pushBack = true; }
    out[k] = m;
  }
  return { merged: out, pushBack };
}
function putNow() {
  if (!ready || applying) return Promise.resolve(false);
  if (timer) { clearTimeout(timer); timer = null; }
  return marinara.apiFetch("/ext-store/" + SRV_NS, { method: "PUT", body: JSON.stringify({ data: G }) })
    .then(saved => { updatedAt = saved?.updatedAt || updatedAt; lastError = ""; return true; });
}
function schedule() {                            // saveLocal 을 부르는 곳마다 같이 호출
  if (!ready || applying) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; putNow().catch(e => { lastError = String(e?.message || e); }); }, 700);
}
async function connect() {
  if (busy || ready) return; busy = true;
  try {
    const h = await marinara.apiFetch("/ext-store/health");
    if (!h?.ok || h.schemaVersion !== 1) throw new Error("서버에 ext-store 모듈이 없습니다");
    const remote = await marinara.apiFetch("/ext-store/" + SRV_NS);
    if (remote?.exists && remote.data) {
      const r = merge(remote.data, G); apply(r.merged); updatedAt = remote.updatedAt; ready = true;
      if (r.pushBack) await putNow();
    } else { ready = true; await putNow(); }
    lastError = "";
  } catch (e) { ready = false; lastError = String(e?.message || e); }
  finally { busy = false; }
}
async function pull() {
  if (!ready || busy || applying) return; busy = true;
  try {
    if (timer) await putNow();
    const remote = await marinara.apiFetch("/ext-store/" + SRV_NS);
    if (remote?.exists && remote.updatedAt && remote.updatedAt !== updatedAt) {
      if (document.querySelector("textarea:focus, input:focus")) return;   // 입력 중이면 다음에
      apply(remote.data); updatedAt = remote.updatedAt;
    }
    lastError = "";
  } catch (e) { ready = false; lastError = String(e?.message || e); }
  finally { busy = false; }
}
function start() {
  connect();
  const id = setInterval(() => (ready ? pull() : connect()), 20000);
  marinara.onCleanup(() => { clearInterval(id); if (timer) { clearTimeout(timer); timer = null; putNow().catch(() => {}); } });
  window.__myExtServerSync = () => ({ ready, updatedAt, lastError });
}
```

실제 구현 참고: Phonara `Phonara_v0.33.js`의 `srv*` 함수들, GM Journal `GM_journal_server.js`의 `gmjServer*`,
User Status `User_Status_Marinara_v2.0.1_server.js`의 `usServer*`. 셋 다 위 골격과 같은 흐름이다.

## 4. 서버 운영

### 새 확장을 붙일 때 서버에서 할 일

**없다.** 네임스페이스는 첫 `PUT` 때 파일이 생기면서 자동으로 만들어진다. 등록·재시작·재배포 모두 필요 없다.

### Marinara 업데이트

패치는 공식 이미지 위에 얹는 방식이라 이미지를 새로 받으면 사라진다. 그래서 업데이트는 항상 스크립트로 한다.

```bash
cd ~/marinara            # docker-compose.yml + .env 가 있는 운영 폴더
./update-marinara.sh     # 공식 이미지 pull → 패치 빌드 → 재시작 → health 확인
./rollback-marinara.sh   # 문제 시 직전 이미지로 복귀
```

- 데이터 volume(`marinara-data`)은 두 스크립트 모두 건드리지 않는다. `ext-store/*.json`도 그 안에 있다
- `apply-patch.mjs`는 `routes/index.js`에서 `registerRoutes`를, `routes/backup.routes.js`에서 `BACKUP_DIRS`를 찾아 끼워 넣는다. 공식 이미지 구조가 바뀌어 못 찾으면 **빌드가 실패**하므로 조용히 사라지는 일은 없다. 그때는 `apply-patch.mjs`의 마커 문자열을 새 구조에 맞게 고친다

### 문제 해결

| 증상 | 확인 |
|---|---|
| 확장이 "미연결(이 브라우저만)" | `curl .../api/ext-store/health`. 404면 패치가 안 올라간 것 → `./update-marinara.sh` |
| health는 되는데 저장이 안 됨 | `docker logs --tail 50 marinara`. 32MB 초과(`payload exceeds`)나 네임스페이스 규칙 위반(`Invalid extension store namespace`) |
| 기기마다 값이 다름 | 브라우저 콘솔에서 `__kpServerSync()` 등으로 `ready`·`lastError` 확인. 폴링 20초를 기다렸는지 확인 |
| 서버 파일 직접 보기 | `docker exec marinara ls -la /app/data/ext-store` / `docker exec marinara cat /app/data/ext-store/phonara.json \| head -c 500` |
| 한 확장 초기화 | `curl -X DELETE .../api/ext-store/<ns>` 후 브라우저에서 확장 새로고침(로컬 자료가 다시 올라간다) |

## 5. 설계 메모 (왜 이렇게 했나)

- **파일 하나 통째 교체**: 확장 설정은 수십 KB~수 MB 수준이고 저장 빈도가 낮다. 부분 병합 API를 만들면 채팅 메타데이터처럼 "키를 못 지우는" 문제가 생긴다
- **서버 우선 병합**: 새 기기가 기본값을 서버에 덮어쓰는 사고를 막는다. 로컬 전용 항목만 추가한다
- **폴링 20초**: SSE/WebSocket을 패치로 얹기엔 과하다. 설정은 실시간일 필요가 없다
- **마지막 쓰기 승리**: 두 기기에서 동시에 편집하는 경우는 드물고, 그 비용(충돌 UI)이 이득보다 크다. 대신 로컬 캐시와 `내보내기`가 항상 있어 복구 가능하다
