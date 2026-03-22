param(
  [string]$Workspace = 'C:\gpt\01project\tire-store',
  [string]$Root = 'C:\gpt\01project\tire-store\parallel-work'
)

$ErrorActionPreference = 'Stop'

function Start-CliTask {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$PromptPath,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  $scriptPath = Join-Path $Root 'run-single.ps1'

  Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', $scriptPath,
      '-Workspace', $Workspace,
      '-PromptPath', $PromptPath,
      '-ResultPath', $ResultPath,
      '-LogPath', $LogPath
    ) `
    -PassThru
}

function Wait-AndCheck {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $null = $Process | Wait-Process -PassThru
  if ($Process.ExitCode -ne 0) {
    throw "$Name failed with exit code $($Process.ExitCode)"
  }
}

$statusPath = Join-Path $Root 'RUN_STATUS.txt'
"[$(Get-Date -Format s)] workflow started" | Out-File -FilePath $statusPath -Encoding utf8

$cli1Prompt = Join-Path $Root 'cli-1-import-data\PROMPT.md'
$cli2Prompt = Join-Path $Root 'cli-2-sales-inventory\PROMPT.md'
$cli3Prompt = Join-Path $Root 'cli-3-dashboard-analytics\PROMPT.md'
$cli4Prompt = Join-Path $Root 'cli-4-customers-settings\PROMPT.md'

$cli1Result = Join-Path $Root 'cli-1-import-data\RESULT.md'
$cli2Result = Join-Path $Root 'cli-2-sales-inventory\RESULT.md'
$cli3Result = Join-Path $Root 'cli-3-dashboard-analytics\RESULT.md'
$cli4Result = Join-Path $Root 'cli-4-customers-settings\RESULT.md'

$cli1Log = Join-Path $Root 'cli-1-import-data\LOG.txt'
$cli2Log = Join-Path $Root 'cli-2-sales-inventory\LOG.txt'
$cli3Log = Join-Path $Root 'cli-3-dashboard-analytics\LOG.txt'
$cli4Log = Join-Path $Root 'cli-4-customers-settings\LOG.txt'

"[$(Get-Date -Format s)] wave1 cli-1 start" | Add-Content -Path $statusPath -Encoding utf8
$cli1 = Start-CliTask -Name 'cli-1' -PromptPath $cli1Prompt -ResultPath $cli1Result -LogPath $cli1Log
Wait-AndCheck -Process $cli1 -Name 'cli-1'

"[$(Get-Date -Format s)] wave2 cli-2 and cli-4 start" | Add-Content -Path $statusPath -Encoding utf8
$cli2 = Start-CliTask -Name 'cli-2' -PromptPath $cli2Prompt -ResultPath $cli2Result -LogPath $cli2Log
$cli4 = Start-CliTask -Name 'cli-4' -PromptPath $cli4Prompt -ResultPath $cli4Result -LogPath $cli4Log
Wait-AndCheck -Process $cli2 -Name 'cli-2'
Wait-AndCheck -Process $cli4 -Name 'cli-4'

"[$(Get-Date -Format s)] wave3 cli-3 start" | Add-Content -Path $statusPath -Encoding utf8
$cli3 = Start-CliTask -Name 'cli-3' -PromptPath $cli3Prompt -ResultPath $cli3Result -LogPath $cli3Log
Wait-AndCheck -Process $cli3 -Name 'cli-3'

"[$(Get-Date -Format s)] workflow completed" | Add-Content -Path $statusPath -Encoding utf8
