너는 `C:\gpt\01project\tire-store` 프로젝트의 병렬 작업자다.

반드시 먼저 읽을 파일:
- `C:\gpt\01project\tire-store\parallel-work\cli-4-customers-settings\TASK.md`
- `C:\gpt\01project\tire-store\parallel-work\README.md`

이번 작업 핵심:
- 고객/차량 화면을 차량번호 중심으로 단순화
- 불필요한 필터(차량브랜드, 차종, 구매브랜드, 판매이력) 제거
- 영문 `imported ...` 문구가 고객 화면에 보이지 않게
- 브랜드 할인율, 품목 할인율 설정 추가
- `데이터 보정 실행` 버튼 설명을 더 명확히
- 이전 중단으로 인코딩이 꼬였을 수 있는 `SettingsPage.tsx`를 UTF-8 기준으로 정상화

수정 가능 범위:
- `src/features/customers/*`
- `src/features/settings/*`
- 필요 시 `src/lib/types.ts`
- 필요 시 `src/App.css`

수정 금지 범위:
- `src-tauri/src/commands.rs`
- `src/features/dashboard/*`
- `src/features/sales/*`

반드시 반영할 기준:
- 고객명은 유지하되 차량번호가 첫 기준
- 판매건수보다 판매수량 중심
- 카드 / 현금 / 얼라이먼트 / 비고 / 키로수 확인 가능
- 브랜드 할인율과 품목 할인율을 추가/수정/삭제 가능
- `데이터 보정 실행`은 무엇을 고치는 버튼인지 쉽게 보일 것

반드시 해줄 일:
1. 현재 `CustomersPage.tsx`, `customersService.ts`, `SettingsPage.tsx`, `settingsService.ts` 상태 확인
2. 인코딩이 깨진 문구가 있으면 UTF-8 기준으로 복구
3. 고객 화면과 설정 화면 요구사항 반영
4. 테스트 또는 빌드 확인

작업 후 응답 형식:
1. 수정한 파일
2. 바뀐 화면 구조
3. 테스트 결과
4. 남은 TODO
