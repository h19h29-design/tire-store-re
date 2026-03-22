param(
  [string]$Workspace = 'C:\gpt\01project\tire-store-re'
)

$ErrorActionPreference = 'Stop'

$waveRoot = 'C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix'
$runner = 'C:\gpt\01project\tire-store-re\parallel-work\run-single.ps1'

$tasks = @(
  @{
    Name = 'cli-1-dashboard-runtime'
    PromptPath = Join-Path $waveRoot 'cli-1-dashboard-runtime\PROMPT.md'
    ResultPath = Join-Path $waveRoot 'cli-1-dashboard-runtime\RESULT.md'
    LogPath = Join-Path $waveRoot 'cli-1-dashboard-runtime\LOG.txt'
  },
  @{
    Name = 'cli-2-sales-structure'
    PromptPath = Join-Path $waveRoot 'cli-2-sales-structure\PROMPT.md'
    ResultPath = Join-Path $waveRoot 'cli-2-sales-structure\RESULT.md'
    LogPath = Join-Path $waveRoot 'cli-2-sales-structure\LOG.txt'
  },
  @{
    Name = 'cli-3-sales-css-density'
    PromptPath = Join-Path $waveRoot 'cli-3-sales-css-density\PROMPT.md'
    ResultPath = Join-Path $waveRoot 'cli-3-sales-css-density\RESULT.md'
    LogPath = Join-Path $waveRoot 'cli-3-sales-css-density\LOG.txt'
  },
  @{
    Name = 'cli-4-repro-validation'
    PromptPath = Join-Path $waveRoot 'cli-4-repro-validation\PROMPT.md'
    ResultPath = Join-Path $waveRoot 'cli-4-repro-validation\RESULT.md'
    LogPath = Join-Path $waveRoot 'cli-4-repro-validation\LOG.txt'
  }
)

foreach ($task in $tasks) {
  Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', $runner,
      '-Workspace', $Workspace,
      '-PromptPath', $task.PromptPath,
      '-ResultPath', $task.ResultPath,
      '-LogPath', $task.LogPath
    ) `
    -WorkingDirectory $Workspace `
    -WindowStyle Normal | Out-Null
}
