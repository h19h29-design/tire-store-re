# CLI 7: Import Alignment Recovery

## 목표

과거 엑셀 import 데이터에서 얼라이먼트 금액과 서비스 분류가 더 정확히 살아나도록 import 파이프라인을 보강한다.

## 범위

- `판매일보` import 시 `al_amount`와 서비스 분류 처리 강화
- 필요하면 import 시 service line / work log 생성 보강
- 고객/차량 화면과 대시보드가 기존 조회 로직만으로 더 정확한 값을 보게 만들기
- Rust 테스트 보강

## 수정 가능 파일

- `src-tauri/src/commands.rs`
- 필요하면 `src-tauri/migrations/*`
- 필요하면 `src/lib/types.ts`

## 수정 금지

- `src/features/sales/*`
- `src/features/inventory/*`
- `src/features/settings/*`
- `src/features/imports/*`
- `src/features/dashboard/*`
- `src/features/customers/*`

## 구현 요구사항

- 현재 import에 들어오는 `al_amount`가 실제로 손실되는지 먼저 확인한다.
- 가능하면 기존 조회 화면을 안 바꾸고도 값이 살아나도록 DB write 쪽에서 해결한다.
- summary row / 카드수수료 row / 메모 row 같은 비판매 행과 섞이지 않게 주의한다.
- 테스트는 샘플 파일이 있을 때 실제 검증하고, 없을 때는 안전하게 건너뛰는 기존 규칙을 유지한다.

## 테스트

- `cargo test`
- 필요하면 `npm run build`

## 응답 형식

- 수정한 파일
- import 시 얼라이먼트/서비스 처리 방식
- 기존 조회 화면에 어떤 효과가 생기는지
- 테스트 결과
- 남은 리스크
