# CLI 5: Cost Snapshot / Profit Accuracy

## 목표

대시보드 순이익이 현재 `items.default_cost_price`가 아니라 판매 시점 원가 기준으로 계산되도록 바꾼다.

## 범위

- 판매 저장 시점에 타이어 라인별 원가 snapshot 저장
- 기존 대시보드 순이익 계산을 snapshot 기준으로 변경
- 필요한 경우 DB 스키마/마이그레이션 추가
- 기존 import/판매 흐름을 깨지 않도록 회귀 확인

## 수정 가능 파일

- `src/features/sales/*`
- `src/features/dashboard/*`
- `src/lib/types.ts`
- `src-tauri/migrations/*`

## 수정 금지

- `src/features/customers/*`
- `src/features/inventory/*`
- `src/features/imports/*`
- `src/features/settings/*`
- `src-tauri/src/commands.rs`

## 구현 요구사항

- 타이어 판매 라인에 판매 시점 원가를 보존할 수 있어야 한다.
- 대시보드 순이익은 `현재 원가`가 아니라 `판매 당시 원가 snapshot`을 우선 사용해야 한다.
- snapshot 값이 없는 과거 데이터는 안전한 fallback 규칙을 둬야 한다.
- 스키마 변경이 있으면 idempotent 하게 적용돼야 한다.
- 기존 화면 타입과 빌드를 깨지 말아야 한다.

## 테스트

- `npm run lint`
- `npm run build`
- `cargo test`

## 응답 형식

- 수정한 파일
- 저장/집계 로직이 어떻게 바뀌었는지
- 과거 데이터 fallback 규칙
- 테스트 결과
- 남은 리스크
