# Tire Store 1.6.1 서버 업데이트 업로드 메모

## 서버 업로드 파일

서버 업데이트에 사용할 기본 파일은 NSIS 설치파일입니다.

- 파일명: `Tire Store_1.6.1_x64-setup.exe`
- 서명파일: `Tire Store_1.6.1_x64-setup.exe.sig`
- 채널: `stable`
- 대상: `windows`
- 아키텍처: `x86_64`

## 관리자 화면 등록값

`https://litire.h19h19.synology.me/admin`에서 업데이트 등록 시 아래 값을 사용합니다.

```json
{
  "version": "1.6.1",
  "channel": "stable",
  "target": "windows",
  "arch": "x86_64",
  "fileName": "Tire Store_1.6.1_x64-setup.exe",
  "notes": "대시보드 추가작업명 used 표시, 지출 추가, 작업비 순이익 계산 수정"
}
```

`signature` 값은 `.sig` 파일 내용을 그대로 넣습니다.

## 검증

- `npm run build`
- `npm run lint`
- `cargo test`
- `npm run tauri:build`
- 릴리즈 `app.exe` 10초 이상 실행 확인
- 로컬 라이선스/업데이트 서버에서 1.6.0 -> 1.6.1 업데이트 manifest 확인
