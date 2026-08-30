[CmdletBinding()]
param([string]$SshHost = 'minipc')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
    param([Parameter(Mandatory = $true)][string]$Message)
    if ($LASTEXITCODE -ne 0) { throw "$Message (exit=$LASTEXITCODE)" }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$localScript = Join-Path $scriptDir 'purchase-funnel-diagnose.sh'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remoteScript = "/tmp/wholesalehub-purchase-funnel-$stamp.sh"
$desktop = [Environment]::GetFolderPath('Desktop')
$report = Join-Path $desktop "WholesaleHub-Purchase-Funnel-$stamp.txt"

Get-Command ssh.exe -ErrorAction Stop | Out-Null
Get-Command scp.exe -ErrorAction Stop | Out-Null
if (-not (Test-Path -LiteralPath $localScript)) { throw "Missing diagnostic: $localScript" }

Push-Location $repoRoot
try {
    Write-Host "[1/3] Checking MiniPC SSH: $SshHost"
    ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "printf 'REMOTE_OK\n'"
    Assert-NativeSuccess 'MiniPC SSH check failed'

    Write-Host '[2/3] Uploading read-only purchase funnel diagnostic'
    scp -q $localScript "${SshHost}:$remoteScript"
    Assert-NativeSuccess 'Diagnostic upload failed'

    Write-Host '[3/3] Checking membership, orders, checkout, payment and catalog state'
    $output = ssh $SshHost "sed -i 's/\r$//' '$remoteScript' && chmod 700 '$remoteScript' && '$remoteScript'; code=`$?; rm -f '$remoteScript'; exit `$code"
    $exitCode = $LASTEXITCODE
    $output | Tee-Object -FilePath $report
    if ($exitCode -ne 0) { throw "Purchase funnel diagnostic failed (exit=$exitCode). Report: $report" }

    Write-Host ''
    Write-Host 'WHOLESALEHUB_PURCHASE_FUNNEL_DIAGNOSTIC_COMPLETE'
    Write-Host "Report: $report"
    Write-Host 'Read-only; no customer names, phone numbers, emails or addresses are included.'
}
finally { Pop-Location }
