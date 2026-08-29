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
$localScript = Join-Path $scriptDir 'current-orders-readonly.sh'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remoteScript = "/tmp/wholesalehub-current-orders-$stamp.sh"
$desktop = [Environment]::GetFolderPath('Desktop')
$report = Join-Path $desktop "WholesaleHub-Current-Orders-$stamp.txt"

if (-not (Test-Path -LiteralPath $localScript)) {
    throw "Order checker not found: $localScript"
}

Get-Command ssh.exe -ErrorAction Stop | Out-Null
Get-Command scp.exe -ErrorAction Stop | Out-Null

Push-Location $repoRoot
try {
    Write-Host "[1/3] Checking MiniPC SSH: $SshHost"
    ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "printf 'REMOTE_OK\n'"
    Assert-NativeSuccess 'MiniPC SSH check failed'

    Write-Host '[2/3] Uploading read-only WooCommerce order checker'
    scp -q $localScript "${SshHost}:$remoteScript"
    Assert-NativeSuccess 'Order checker upload failed'

    Write-Host '[3/3] Reading current WooCommerce orders without customer PII'
    $output = ssh $SshHost "sed -i 's/\r$//' '$remoteScript' && chmod 700 '$remoteScript' && '$remoteScript'; code=`$?; rm -f '$remoteScript'; exit `$code"
    $exitCode = $LASTEXITCODE
    $output | Tee-Object -FilePath $report

    if ($exitCode -ne 0) {
        throw "Current-order check failed (exit=$exitCode). Partial report: $report"
    }

    Write-Host ''
    Write-Host 'WHOLESALEHUB_CURRENT_ORDER_CHECK_COMPLETE'
    Write-Host "Report: $report"
    Write-Host 'This check is read-only and excludes customer names, phone numbers, email and addresses.'
}
finally {
    Pop-Location
}
