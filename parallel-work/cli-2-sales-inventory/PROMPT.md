너는 `C:\gpt\01project\tire-store` 프로젝트의 병렬 작업자다.

반드시 먼저 읽을 파일:
- `C:\gpt\01project\tire-store\parallel-work\cli-2-sales-inventory\TASK.md`
- `C:\gpt\01project\tire-store\parallel-work\README.md`

이번 작업 핵심:
- 빠른판매에서 단가 입력 없이 판매 저장 가능
- 타이어 없이 `작업명 + 추가 작업비`만으로도 저장 가능
- 카드수수료 기본 3%, `네이버` 체크 시 5%
- 빠른판매를 1080p 기준으로 한 화면에 최대한 들어오게 압축
- 재고조회에서 총 재고 수량 확인 가능
- 신규 품목 / 신규 규격 등록 가능
- 브랜드 또는 품목별 할인율이 판매표에 반영될 수 있게 연결

수정 가능 범위:
- `src/features/sales/*`
- `src/features/inventory/*`
- `src/App.css`
- 필요 시 `src/lib/types.ts`

수정 금지 범위:
- `src-tauri/src/commands.rs`
- `src/features/dashboard/*`
- `src/features/customers/*`
- `src/features/settings/*`

반드시 반영할 기준:
- 단가가 비어 있어도 결제금액 기준으로 저장 가능해야 함
- 결제금액도 비어 있으면 현금으로 자동 저장 가능
- 타이어 없이 작업명과 추가 작업비만 있으면 저장 가능해야 함
- 재고조회 표에는 판매가를 넣지 않음
- 검색은 `145`, `145 13`, `145 r 13`, `2554519`를 계속 지원
- 빠른판매 페이지는 페이지 스크롤이 아니라 내부 리스트 스크롤 위주로 정리

반드시 해줄 일:
1. `SalesPage.tsx`, `salesService.ts`, `InventoryPage.tsx`, `inventoryService.ts` 현재 상태 확인
2. 단가 필수 제거 / 서비스-only 저장 경로 점검
3. 카드수수료 UI와 계산 보정
4. 빠른판매 1080p 압축 레이아웃 적용
5. 총 재고 수량 및 신규 품목 등록 경로 검증

작업 후 응답 형식:
1. 수정한 파일
2. 사용자 체감 변경점
3. 테스트 결과
4. 남은 TODO
