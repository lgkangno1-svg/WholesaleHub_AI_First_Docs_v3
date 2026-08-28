[CmdletBinding()]
param(
    [string]$SshHost = 'minipc',
    [switch]$SkipSmoke
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
    param([Parameter(Mandatory = $true)][string]$Message)
    if ($LASTEXITCODE -ne 0) { throw "$Message (exit=$LASTEXITCODE)" }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$localScript = Join-Path $scriptDir 'telegram-ai-diagnose.sh'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remoteScript = "/tmp/wholesalehub-telegram-ai-diagnose-$stamp.sh"
$desktop = [Environment]::GetFolderPath('Desktop')
$report = Join-Path $desktop "WholesaleHub-Telegram-AI-Diagnostic-$stamp.txt"

if (-not (Test-Path -LiteralPath $localScript)) {
    throw "Diagnostic script not found: $localScript"
}
Get-Command ssh.exe -ErrorAction Stop | Out-Null
Get-Command scp.exe -ErrorAction Stop | Out-Null

Push-Location $repoRoot
try {
    Write-Host "[1/3] Checking MiniPC SSH: $SshHost"
    ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "printf 'REMOTE_OK\n'"
    Assert-NativeSuccess 'MiniPC SSH check failed'

    Write-Host '[2/3] Uploading read-only diagnostic collector'
    scp -q $localScript "${SshHost}:$remoteScript"
    Assert-NativeSuccess 'Diagnostic collector upload failed'

    $mode = if ($SkipSmoke) { '' } else { '--smoke' }
    Write-Host "[3/3] Collecting Telegram/Codex/OpenCode runtime evidence"
    $output = ssh $SshHost "sed -i 's/\r$//' '$remoteScript' && chmod 700 '$remoteScript' && '$remoteScript' $mode; code=`$?; rm -f '$remoteScript'; exit `$code"
    $exitCode = $LASTEXITCODE
    $output | Tee-Object -FilePath $report

    if ($exitCode -ne 0) {
        throw "Diagnostic collector failed (exit=$exitCode). Partial report: $report"
    }

    Write-Host ''
    Write-Host "TELEGRAM_AI_DIAGNOSTIC_COMPLETE"
    Write-Host "Report: $report"
    Write-Host 'Attach or paste this report back into ChatGPT. It is designed to omit credential values.'
}
finally {
    Pop-Location
}
