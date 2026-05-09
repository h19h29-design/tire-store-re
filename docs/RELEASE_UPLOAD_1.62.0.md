# Tire Store 1.62 테스트 서버 릴리즈 메모

## 생성된 설치 파일

- `Tire Store_1.62.0_x64-setup.exe`
- `Tire Store_1.62.0_x64_en-US.msi`
- `app.exe`

## 자동 업데이트 서버 업로드 조건

stable 자동 업데이트용 ZIP에는 아래 2개가 함께 있어야 합니다.

```text
Tire Store_1.62.0_x64-setup.exe
Tire Store_1.62.0_x64-setup.exe.sig
```

현재 PC에는 Tauri updater private key가 없어 `.sig`를 생성하지 못했습니다.
따라서 이번 산출물은 수동 설치/다운로드 테스트용이며, 자동 설치 검증용 stable 업로드 ZIP은 private key 설정 후 다시 만들어야 합니다.

## 서명 키 설정 후 다시 빌드

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="..."
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
npm run tauri:build
```

## 서버 등록값

```json
{
  "version": "1.62.0",
  "channel": "stable",
  "target": "windows",
  "arch": "x86_64",
  "fileName": "Tire Store_1.62.0_x64-setup.exe",
  "notes": "1.62 테스트 릴리즈"
}
```
