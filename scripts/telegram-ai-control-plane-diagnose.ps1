[CmdletBinding()]
param(
    [string]$SshHost = 'minipc'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
    param([Parameter(Mandatory = $true)][string]$Message)
    if ($LASTEXITCODE -ne 0) { throw "$Message (exit=$LASTEXITCODE)" }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$localScript = Join-Path $scriptDir 'telegram-ai-control-plane-diagnose.sh'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remoteScript = "/tmp/wholesalehub-telegram-control-plane-$stamp.sh"
$desktop = [Environment]::GetFolderPath('Desktop')
$report = Join-Path $desktop "WholesaleHub-Telegram-Control-Plane-$stamp.txt"

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

    Write-Host '[2/3] Uploading control-plane diagnostic'
    scp -q $localScript "${SshHost}:$remoteScript"
    Assert-NativeSuccess 'Diagnostic upload failed'

    Write-Host '[3/3] Inspecting Telegram / Codex / OpenCodex / OpenCode / Antigravity runtime'
    $output = ssh $SshHost "sed -i 's/\r$//' '$remoteScript' && chmod 700 '$remoteScript' && '$remoteScript'; code=`$?; rm -f '$remoteScript'; exit `$code"
    $exitCode = $LASTEXITCODE
    $output | Tee-Object -FilePath $report

    if ($exitCode -ne 0) {
        throw "Control-plane diagnostic failed (exit=$exitCode). Partial report: $report"
    }

    Write-Host ''
    Write-Host 'TELEGRAM_CONTROL_PLANE_DIAGNOSTIC_COMPLETE'
    Write-Host "Report: $report"
    Write-Host 'Paste the report back into ChatGPT or give it to Codex with ai/tasks/TELEGRAM_AI_CONTROL_PLANE_REPAIR.md.'
}
finally {
    Pop-Location
}
