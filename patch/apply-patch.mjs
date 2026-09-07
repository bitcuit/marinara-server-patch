// ──────────────────────────────────────────────
// Marinara Engine 서버 패치 적용기 (Docker 이미지 빌드 중 실행)
//
//  - QR Panel 서버 모듈      → /api/qr-panel   (DATA_DIR/qr-panel)
//  - Extension Store 모듈    → /api/ext-store  (DATA_DIR/ext-store)
//
// 공식 lite 이미지의 컴파일된 packages/server/dist 에 JS 파일을 추가하고
// routes/index.js, routes/backup.routes.js 에 연결 줄을 끼워 넣는다.
// 이미 들어간 줄은 다시 넣지 않으므로 여러 번 실행해도 안전하다.
// 실패하면 exit 1 → 이미지 빌드가 실패하도록 해 조용히 망가지는 일을 막는다.
// ──────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

const APP_ROOT = process.env.MARINARA_APP_ROOT || "/app";
const PATCH_ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(APP_ROOT, "packages/server/dist");
const INDEX = path.join(DIST, "routes/index.js");
const BACKUP = path.join(DIST, "routes/backup.routes.js");

const MODULES = [
  {
    name: "qr-panel",
    importLine: 'import { qrPanelRoutes } from "./qr-panel.routes.js";',
    registerLine: '  await app.register(qrPanelRoutes, { prefix: "/api/qr-panel" });',
    backupDir: "qr-panel",
    files: ["routes/qr-panel.routes.js", "services/storage/qr-panel.storage.js"],
  },
  {
    name: "ext-store",
    importLine: 'import { extStoreRoutes } from "./ext-store.routes.js";',
    registerLine: '  await app.register(extStoreRoutes, { prefix: "/api/ext-store" });',
    backupDir: "ext-store",
    files: ["routes/ext-store.routes.js", "services/storage/ext-store.storage.js"],
  },
];

function fail(message) {
  console.error(`[patch] 실패: ${message}`);
  process.exit(1);
}

for (const p of [INDEX, BACKUP]) {
  if (!fs.existsSync(p)) fail(`${p} 가 없습니다. 이미지 구조가 바뀐 것 같습니다.`);
}

let indexText = fs.readFileSync(INDEX, "utf8");
let backupText = fs.readFileSync(BACKUP, "utf8");

const REGISTER_MARKER = "export async function registerRoutes(app) {";
const BACKUP_MARKER = "const BACKUP_DIRS = [";
if (!indexText.includes(REGISTER_MARKER)) fail("routes/index.js 에서 registerRoutes 를 찾지 못했습니다.");
if (!backupText.includes(BACKUP_MARKER)) fail("routes/backup.routes.js 에서 BACKUP_DIRS 를 찾지 못했습니다.");

for (const mod of MODULES) {
  // 1) 컴파일된 JS 파일 복사
  for (const rel of mod.files) {
    const src = path.join(PATCH_ROOT, "files", rel);
    const dst = path.join(DIST, rel);
    if (!fs.existsSync(src)) fail(`패치 파일이 없습니다: ${src}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  // 2) import 줄 (registerRoutes 바로 앞에)
  if (!indexText.includes(mod.importLine)) {
    const at = indexText.indexOf(REGISTER_MARKER);
    indexText = indexText.slice(0, at) + mod.importLine + "\n" + indexText.slice(at);
  }

  // 3) register 줄 (registerRoutes 본문 맨 앞에)
  if (!indexText.includes(mod.registerLine.trim())) {
    const at = indexText.indexOf(REGISTER_MARKER) + REGISTER_MARKER.length;
    indexText = indexText.slice(0, at) + "\n" + mod.registerLine + indexText.slice(at);
  }

  // 4) 백업 대상 폴더 등록
  if (!backupText.includes(`"${mod.backupDir}"`)) {
    const at = backupText.indexOf(BACKUP_MARKER) + BACKUP_MARKER.length;
    backupText = backupText.slice(0, at) + `\n    "${mod.backupDir}",` + backupText.slice(at);
  }

  console.log(`[patch] ${mod.name} 적용 완료`);
}

fs.writeFileSync(INDEX, indexText, "utf8");
fs.writeFileSync(BACKUP, backupText, "utf8");

// 문법 검사: 패치된 파일이 파싱되는지 확인
for (const p of [INDEX, BACKUP, ...MODULES.flatMap((m) => m.files.map((f) => path.join(DIST, f)))]) {
  try {
    new Function(fs.readFileSync(p, "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, ""));
  } catch (e) {
    fail(`${p} 문법 오류: ${e.message}`);
  }
}
console.log("[patch] 모든 패치 적용 및 문법 검사 완료");
