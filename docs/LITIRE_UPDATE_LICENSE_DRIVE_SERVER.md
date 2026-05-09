# Tire Store 업데이트/라이선스/Google Drive 운영 메모

## 서버 환경 변수

- `ADMIN_TOKEN`: 관리자 로그인 토큰입니다.
- `PUBLIC_BASE_URL`: 앱 업데이트 manifest와 다운로드 URL에 들어가는 공개 주소입니다.
- `GOOGLE_DEVICE_CLIENT_ID`: 데스크톱 앱 Google Drive Device OAuth Client ID입니다.
- `GOOGLE_DEVICE_CLIENT_SECRET`: 데스크톱 앱 Google Drive Device OAuth Client Secret입니다.
- `GOOGLE_DRIVE_CONFIG_SOURCE_URL`: 위 두 값이 비어 있을 때 가져올 공유 설정 주소입니다. 기본값은 요아정 서버의 `/config/public`입니다.
- `LITIRE_DATA_DIR`: 라이선스와 릴리즈 JSON 저장 폴더입니다.
- `UPDATE_STORAGE_DIR`: 업데이트 설치 파일 저장 폴더입니다.

## 관리자 API

- `POST /admin/login`: JSON 요청이면 `{ "adminToken": "..." }`을 받고 `{ sessionToken }`을 반환합니다.
- `Authorization: Bearer <sessionToken>` 또는 `X-Admin-Token`으로 관리자 API를 호출할 수 있습니다.
- `POST /admin/releases`: Tauri 빌드 ZIP을 업로드하면 `.exe`/`.msi`와 같은 이름의 `.sig`를 추출해 릴리즈를 등록합니다.
- `GET /config/public`: 앱이 Google Drive Device OAuth 설정을 읽는 공개 설정 API입니다.

## Google Drive 백업

앱의 `백업 / 복원` 탭에서 서버 공개 설정을 가져온 뒤 Google Drive를 연결합니다. 서버에 `GOOGLE_DEVICE_CLIENT_ID`와 `GOOGLE_DEVICE_CLIENT_SECRET`이 직접 없으면 요아정 서버 설정을 같은 값으로 재사용합니다.

Drive 파일은 `.tirebackup` 확장자와 `tireStoreBackup` app property로 구분하므로 요아정 백업과 목록이 섞이지 않습니다. 백업 내용은 PBKDF2-SHA256과 AES-GCM으로 암호화됩니다.
