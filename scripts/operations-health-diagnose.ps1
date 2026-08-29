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
$localScript = Join-Path $scriptDir 'operations-health-diagnose.sh'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remoteScript = "/tmp/wholesalehub-operations-health-$stamp.sh"
$desktop = [Environment]::GetFolderPath('Desktop')
$report = Join-Path $desktop "WholesaleHub-Operations-Health-$stamp.txt"

if (-not (Test-Path -LiteralPath $localScript)) {
    throw "Diagnostic script not found: $localScript"
}
Get-Command ssh.exe -ErrorAction Stop | Out-Null
Get-Command scp.exe -ErrorAction Stop | Out-Null

Write-Host "[1/3] Checking MiniPC SSH: $SshHost"
ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "printf 'REMOTE_OK\n'"
Assert-NativeSuccess 'MiniPC SSH check failed'

Write-Host '[2/3] Uploading read-only operations health collector'
scp -q $localScript "${SshHost}:$remoteScript"
Assert-NativeSuccess 'Operations health collector upload failed'

Write-Host '[3/3] Collecting catalog, scheduler and order-export screening evidence'
$output = ssh $SshHost "sed -i 's/\r$//' '$remoteScript' && chmod 700 '$remoteScript' && '$remoteScript'; code=`$?; rm -f '$remoteScript'; exit `$code"
$exitCode = $LASTEXITCODE
$output | Tee-Object -FilePath $report

if ($exitCode -ne 0) {
    throw "Operations health diagnostic failed (exit=$exitCode). Partial report: $report"
}

Write-Host ''
Write-Host 'WHOLESALEHUB_OPERATIONS_DIAGNOSTIC_COMPLETE'
Write-Host "Report: $report"
Write-Host 'This collector is read-only and does not export orders, modify products, trigger supplier orders, payments or refunds.'
