너는 `C:\gpt\01project\tire-store` 프로젝트의 병렬 작업자다.

먼저 아래 파일을 읽어라.
- `C:\gpt\01project\tire-store\parallel-work\cli-7-import-alignment\TASK.md`

이번 작업 목표:
- 과거 엑셀 import 데이터에서 얼라이먼트 금액과 서비스 분류를 더 정확히 복원하기
- 가능하면 기존 프론트 조회 코드를 안 바꾸고, import write 쪽 보강으로 해결하기

중요 제약:
- 프론트 페이지 파일은 건드리지 마라.
- 먼저 현재 `al_amount`가 어디서 누락되는지 확인한 뒤 수정해라.
- migration이 필요하면 새 파일을 추가하고, 기존 migration을 함부로 뒤엎지 마라.

권장 순서:
1. `src-tauri/src/commands.rs`의 import 파이프라인을 읽고 `al_amount` 흐름 추적
2. 판매 행 / 서비스 행 / 합계 행 분류 재검토
3. 필요하면 service line / work log 저장 보강
4. Rust 테스트 추가 또는 기존 테스트 보강
5. `cargo test`

응답에는 아래를 꼭 포함해라.
- 수정한 파일
- 얼라이먼트 복원 방식
- 서비스 분류 보정 방식
- 테스트 결과
- 남은 리스크
