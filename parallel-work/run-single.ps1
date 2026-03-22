param(
  [Parameter(Mandatory = $true)][string]$Workspace,
  [Parameter(Mandatory = $true)][string]$PromptPath,
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = 'Stop'

$prompt = Get-Content -Path $PromptPath -Raw -Encoding utf8

$output = $prompt | codex exec `
  --dangerously-bypass-approvals-and-sandbox `
  -C $Workspace `
  -o $ResultPath `
  -

$output | Out-File -FilePath $LogPath -Encoding utf8

exit $LASTEXITCODE
