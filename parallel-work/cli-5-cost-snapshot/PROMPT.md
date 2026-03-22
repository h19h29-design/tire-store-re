너는 `C:\gpt\01project\tire-store` 프로젝트의 병렬 작업자다.

먼저 아래 파일을 읽어라.
- `C:\gpt\01project\tire-store\parallel-work\cli-5-cost-snapshot\TASK.md`

이번 작업 목표:
- 판매 저장 시점 원가 snapshot을 남기고
- 대시보드 순이익이 현재 `items.default_cost_price`가 아니라 판매 당시 원가 기준으로 계산되게 만들기

중요 제약:
- 허용 범위 안의 파일만 수정해라.
- `src-tauri/src/commands.rs`는 건드리지 마라.
- migration이 필요하면 새 migration 파일을 추가하는 쪽을 우선 검토해라.
- 과거 데이터는 snapshot이 없을 수 있으니 fallback 규칙을 명확히 넣어라.

권장 순서:
1. 현재 판매 저장 구조와 대시보드 순이익 계산 위치를 확인
2. snapshot 저장 구조 설계
3. migration 적용
4. 판매 저장 로직 반영
5. 대시보드 집계 반영
6. `npm run lint`, `npm run build`, `cargo test`

응답에는 아래를 꼭 포함해라.
- 수정한 파일
- snapshot 저장 방식
- 순이익 계산식 변경점
- 과거 데이터 처리 방식
- 테스트 결과
- 남은 리스크
