# Litire 라이선스 / 업데이트 서버

요아정(`yaj`) 프로젝트의 라이선스/업데이트 구조를 참고해서 Tire Store에 맞게 반영했습니다.

## 기본 주소

- 운영 서버: `https://litire.h19h19.synology.me`
- 앱 기본 라이선스 서버 주소는 위 주소로 설정되어 있습니다.
- 로컬 테스트는 `npm run license:api` 또는 `npm run billing:api`로 실행합니다.

## 서버 실행

```powershell
cd C:\gpt\01project\tire-store-re
$env:API_PORT='3100'
$env:PUBLIC_BASE_URL='https://litire.h19h19.synology.me'
$env:ADMIN_TOKEN='관리자토큰'
npm run license:api
```

## 관리자 화면

```text
https://litire.h19h19.synology.me/admin
```

관리자 화면에서 가능한 작업입니다.

- 아이디 또는 이메일 기준 라이선스 발급
- 라이선스 기간, 기기 수, 상태 설정
- 업데이트 버전 등록
- Tauri updater용 서명값과 파일명 등록

## 앱 로그인 방식

앱 설정 화면에서 다음 값을 입력합니다.

- 서버 주소: `https://litire.h19h19.synology.me`
- 매장 코드: 발급받은 아이디 또는 이메일
- 활성화 코드: 발급받은 라이선스 키

앱은 기기 ID를 자동 발급하고 서버에 등록합니다.
기간 만료 또는 기기 수 초과 시 설정 화면 외 기능은 차단됩니다.

## 업데이트 방식

Tauri updater endpoint:

```text
https://litire.h19h19.synology.me/tauri-updates/stable/windows/x86_64/{{current_version}}
```

일반 업데이트 확인 endpoint 예시:

```text
https://litire.h19h19.synology.me/updates/stable/windows/x86_64/1.6.0
```

Tauri 자동 설치가 되려면 서버 release에 `signature`가 있어야 합니다.
서명 private key는 GitHub나 NAS 공개 폴더에 올리지 않습니다.

## 검증 완료

- `/health` 정상
- `/admin/licenses` 라이선스 발급 정상
- `/licenses/activate` 기기 활성화 정상
- `/licenses/check` 상태 확인 정상
- `/admin/releases` 업데이트 등록 정상
- `/updates/stable/windows/x86_64/1.6.0` 업데이트 확인 정상
- `/tauri-updates/stable/windows/x86_64/1.6.0` Tauri manifest 정상
- `npm run build` 정상
- `npm run lint` 정상
- `cargo test` 정상
- `npm run tauri:build` 정상
