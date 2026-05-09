# Tire Store 1.61 서버/앱 배포 메모

## 앱 배포 파일

- 설치파일: `Tire Store_1.61.0_x64-setup.exe`
- MSI: `Tire Store_1.61.0_x64_en-US.msi`
- 실행파일: `app.exe`

## 서버 배포 파일

- `tire-store-litire-server-1.61.0.zip`
- 포함 내용:
  - `server/license-billing-server.mjs`
  - `server/updateZip.mjs`
  - `server/quote-api-server.mjs`
  - `package.json`
  - `package-lock.json`

## 업데이트 서버 등록

현재 환경에는 Tauri updater private key가 없어 `.sig` 파일을 생성하지 못했습니다.
stable 자동 업데이트 등록에는 설치파일과 같은 이름의 `.sig` 파일이 필요합니다.

필요 환경 변수:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="..."
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
npm run tauri:build
```

자동 업데이트 ZIP에는 아래 파일 2개가 함께 있어야 합니다.

```text
Tire Store_1.61.0_x64-setup.exe
Tire Store_1.61.0_x64-setup.exe.sig
```

## 검증

- `npm run release:check-version`
- `npm run build`
- `npm run lint`
- `cargo test`
- 설치파일 생성 확인
