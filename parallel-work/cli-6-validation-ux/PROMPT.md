너는 `C:\gpt\01project\tire-store` 프로젝트의 병렬 작업자다.

먼저 아래 파일을 읽어라.
- `C:\gpt\01project\tire-store\parallel-work\cli-6-validation-ux\TASK.md`

이번 작업 목표:
- 이미 붙어 있는 검증 팝업을 유지하면서
- 잘못된 입력 칸을 화면에서 즉시 보이게 하고
- 첫 번째 오류 칸으로 자동 포커스 이동되게 만들기

중요 제약:
- service / Rust / schema 로직은 건드리지 마라.
- 페이지 컴포넌트와 스타일 레이어에서 해결해라.
- 검증 기준 자체를 바꾸기보다 UX를 강화하는 데 집중해라.

권장 순서:
1. 판매 / 재고 / 대시보드 / 설정 / import 화면의 현재 검증 흐름 확인
2. 공용 field error state 방식 설계
3. 화면별 강조/포커스 적용
4. 스타일 정리
5. `npm run lint`, `npm run build`

응답에는 아래를 꼭 포함해라.
- 수정한 파일
- 오류 강조 방식
- 포커스 이동 방식
- 테스트 결과
- 남은 개선점
