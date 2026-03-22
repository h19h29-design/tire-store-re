# Launch Guide

## Wave Root

- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix`

## CLI Folders

- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-1-dashboard-runtime`
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-2-sales-structure`
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-3-sales-css-density`
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-4-repro-validation`

## Fastest Option

Run this once to open all four CLI tasks in parallel:

```powershell
powershell -ExecutionPolicy Bypass -File C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\start-wave.ps1
```

## Manual Launch Per CLI

### CLI 1

```powershell
powershell -ExecutionPolicy Bypass -File C:\gpt\01project\tire-store-re\parallel-work\run-single.ps1 `
  -Workspace C:\gpt\01project\tire-store-re `
  -PromptPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-1-dashboard-runtime\PROMPT.md `
  -ResultPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-1-dashboard-runtime\RESULT.md `
  -LogPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-1-dashboard-runtime\LOG.txt
```

### CLI 2

```powershell
powershell -ExecutionPolicy Bypass -File C:\gpt\01project\tire-store-re\parallel-work\run-single.ps1 `
  -Workspace C:\gpt\01project\tire-store-re `
  -PromptPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-2-sales-structure\PROMPT.md `
  -ResultPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-2-sales-structure\RESULT.md `
  -LogPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-2-sales-structure\LOG.txt
```

### CLI 3

```powershell
powershell -ExecutionPolicy Bypass -File C:\gpt\01project\tire-store-re\parallel-work\run-single.ps1 `
  -Workspace C:\gpt\01project\tire-store-re `
  -PromptPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-3-sales-css-density\PROMPT.md `
  -ResultPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-3-sales-css-density\RESULT.md `
  -LogPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-3-sales-css-density\LOG.txt
```

### CLI 4

```powershell
powershell -ExecutionPolicy Bypass -File C:\gpt\01project\tire-store-re\parallel-work\run-single.ps1 `
  -Workspace C:\gpt\01project\tire-store-re `
  -PromptPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-4-repro-validation\PROMPT.md `
  -ResultPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-4-repro-validation\RESULT.md `
  -LogPath C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-4-repro-validation\LOG.txt
```

## Notes

- Each CLI should read `README.md` first, then its own `TASK.md`, then follow `PROMPT.md`.
- The integrator stays on the main thread and will merge after the worker result files are complete.
