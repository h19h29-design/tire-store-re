# Next Round Guide

## 추천 배치

1. `cli-5-cost-snapshot`와 `cli-6-validation-ux`는 바로 병렬 실행 가능
2. `cli-7-import-alignment`는 그와 별개로 돌려도 되지만, migration 번호 충돌 가능성은 시작 전에 한 번 확인

## 이유

- `cli-5`는 판매 저장/대시보드 집계와 migration 축
- `cli-6`는 페이지 컴포넌트와 CSS 축
- `cli-7`는 Rust import 축

## 주의

- `cli-5`와 `cli-7`이 둘 다 migration을 추가하려 하면 파일 번호만 겹치지 않게 조정
- `cli-6`은 service 로직이나 Rust를 건드리지 않도록 제한
- 모두 완료 후 최종 통합 브랜치에서는 `npm run lint`, `npm run build`, `cargo test`를 다시 한 번 전체 실행
