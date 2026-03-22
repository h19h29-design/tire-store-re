# CLI 실행 가이드

이 문서는 `codex exec`를 병렬로 띄울 때 쓰는 실제 실행 가이드입니다.

## 현재 확인 결과

- `codex-cli` 실행 가능
- `parallel-work` 폴더 존재
- 각 폴더에 `TASK.md`, `PROMPT.md` 존재

## 실행 순서

1. `cli-1-import-data`
2. `cli-2-sales-inventory`
3. `cli-4-customers-settings`
4. `cli-3-dashboard-analytics`

`cli-2`와 `cli-4`는 서로 병렬로 돌려도 됩니다.

## 공통 실행 옵션

- 작업 폴더: `C:\gpt\01project\tire-store`
- 승인 없이 끝까지 진행:
  - `--dangerously-bypass-approvals-and-sandbox`
- 작업 결과 파일 저장:
  - `-o <결과파일>`

## 바로 실행 가능한 예시

### CLI 1

```powershell
Get-Content C:\gpt\01project\tire-store\parallel-work\cli-1-import-data\PROMPT.md -Raw |
codex exec `
  --dangerously-bypass-approvals-and-sandbox `
  -C C:\gpt\01project\tire-store `
  -o C:\gpt\01project\tire-store\parallel-work\cli-1-import-data\RESULT.md `
  -
```

### CLI 2

```powershell
Get-Content C:\gpt\01project\tire-store\parallel-work\cli-2-sales-inventory\PROMPT.md -Raw |
codex exec `
  --dangerously-bypass-approvals-and-sandbox `
  -C C:\gpt\01project\tire-store `
  -o C:\gpt\01project\tire-store\parallel-work\cli-2-sales-inventory\RESULT.md `
  -
```

### CLI 3

```powershell
Get-Content C:\gpt\01project\tire-store\parallel-work\cli-3-dashboard-analytics\PROMPT.md -Raw |
codex exec `
  --dangerously-bypass-approvals-and-sandbox `
  -C C:\gpt\01project\tire-store `
  -o C:\gpt\01project\tire-store\parallel-work\cli-3-dashboard-analytics\RESULT.md `
  -
```

### CLI 4

```powershell
Get-Content C:\gpt\01project\tire-store\parallel-work\cli-4-customers-settings\PROMPT.md -Raw |
codex exec `
  --dangerously-bypass-approvals-and-sandbox `
  -C C:\gpt\01project\tire-store `
  -o C:\gpt\01project\tire-store\parallel-work\cli-4-customers-settings\RESULT.md `
  -
```

## 병렬로 띄울 때 주의

- 같은 파일을 두 CLI가 동시에 건드리지 않게 `PROMPT.md`의 수정 가능 범위를 지킵니다.
- `cli-4`는 현재 `SettingsPage.tsx` 인코딩 확인까지 포함합니다.
- 마지막에는 메인 작업자가 통합 빌드와 배포를 다시 해야 합니다.

## 결과 확인 위치

- `C:\gpt\01project\tire-store\parallel-work\cli-1-import-data\RESULT.md`
- `C:\gpt\01project\tire-store\parallel-work\cli-2-sales-inventory\RESULT.md`
- `C:\gpt\01project\tire-store\parallel-work\cli-3-dashboard-analytics\RESULT.md`
- `C:\gpt\01project\tire-store\parallel-work\cli-4-customers-settings\RESULT.md`
