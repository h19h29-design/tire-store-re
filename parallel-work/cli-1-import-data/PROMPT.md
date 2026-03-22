너는 `C:\gpt\01project\tire-store` 프로젝트의 병렬 작업자다.

반드시 먼저 읽을 파일:
- `C:\gpt\01project\tire-store\parallel-work\cli-1-import-data\TASK.md`
- `C:\gpt\01project\tire-store\parallel-work\README.md`

이번 작업 핵심:
- `재고관리_연동.xlsx`의 `고객등록` 시트에서 고객 정보뿐 아니라 과거 판매자료를 import에 반영
- 과거 판매는 `2024년`, `2025년` 데이터도 들어와야 함
- `판매일보`와 `고객등록` 판매자료를 dedupe 고려해서 합치기
- 판매량 검증 로직 유지
- 카드수수료 / 할인율 관련 컬럼이 누락되지 않도록 런타임 스키마 보정

수정 가능 범위:
- `src-tauri/src/commands.rs`
- `src-tauri/migrations/*`
- `src/features/imports/*`
- `src/lib/types.ts`

수정 금지 범위:
- `src/features/sales/*`
- `src/features/dashboard/*`
- `src/features/customers/*`
- `src/features/settings/*`

반드시 반영할 기준:
- 금액 입력 `300`은 DB 저장 시 `300000원`
- import 결과 화면에 `고객등록 시트 과거 판매 건수`, `customer seed 건수`, `검증 필요 건수`가 보일 것
- 영문 `imported from customer sheet row ...` 메모는 사용자 화면에 직접 보이지 않게 할 것
- 기존 `판매일보`와 중복되는 판매가 있으면 dedupe 기준을 문서화할 것

반드시 해줄 일:
1. 현재 `commands.rs`의 고객등록 시트 파서와 import 흐름을 확인
2. `2024/2025` 과거 판매가 실제 sold_at으로 들어오도록 날짜 파싱 보강
3. `sales` 관련 수수료/결제 컬럼 보정 로직 점검
4. import 결과 타입/화면 문구 정리
5. 테스트 추가 또는 갱신

작업 후 응답 형식:
1. 수정한 파일
2. 과거 판매 import 로직 설명
3. 검증 결과
4. 남은 리스크
