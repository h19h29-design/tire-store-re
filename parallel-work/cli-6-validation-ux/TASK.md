# CLI 6: Validation UX / Field Highlight

## 목표

현재 추가된 팝업 검증에 더해서, 잘못된 입력 칸을 화면에서 바로 알아볼 수 있게 강조하고 첫 오류 칸으로 이동되게 만든다.

## 범위

- 판매 / 재고 / 대시보드 / 설정 / import 화면의 입력 오류 UX 개선
- 잘못된 필드 시각 강조
- 첫 오류 필드 포커스 이동
- 필요하면 공용 validation helper 추가

## 수정 가능 파일

- `src/features/sales/*`
- `src/features/inventory/*`
- `src/features/dashboard/*`
- `src/features/settings/*`
- `src/features/imports/*`
- `src/lib/dialogs.ts`
- `src/App.css`

## 수정 금지

- `src/features/*/*Service.ts`
- `src-tauri/*`
- `src/lib/types.ts`

## 구현 요구사항

- 기존 팝업 검증은 유지한다.
- 잘못된 필드는 붉은 테두리나 배경 등으로 명확히 보여야 한다.
- 저장 시 첫 번째 오류 필드로 포커스를 이동시켜야 한다.
- 오류가 해결되면 강조 상태도 바로 풀려야 한다.
- 디자인은 기존 앱 스타일을 크게 깨지 않게 맞춘다.

## 테스트

- `npm run lint`
- `npm run build`

## 응답 형식

- 수정한 파일
- 어떤 화면에 어떤 검증 UX를 넣었는지
- 포커스 이동 방식
- 테스트 결과
- 남은 개선점
