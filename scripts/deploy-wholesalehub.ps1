param(
    [string]$TunnelHost = "ssh.avocadoss.co.kr",
    [string]$SshUser = "tnfwod",
    [switch]$RunCatalogCatchup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InnerScript = Join-Path $PSScriptRoot "deploy-site-hardening-cloudflare.ps1"

if (-not (Test-Path -LiteralPath $InnerScript)) {
    throw "배포 스크립트를 찾을 수 없습니다: $InnerScript"
}

$insideWorkTree = (& git -C $RepoRoot rev-parse --is-inside-work-tree 2>$null)
if ($LASTEXITCODE -ne 0 -or $insideWorkTree.Trim() -ne "true") {
    throw "현재 폴더가 Git 배포 clone이 아닙니다: $RepoRoot"
}

$currentCommit = (& git -C $RepoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $currentCommit) {
    throw "현재 배포 commit을 확인할 수 없습니다."
}

Write-Host "WholesaleHub 배포 시작" -ForegroundColor Cyan
Write-Host "RepoRoot : $RepoRoot"
Write-Host "Commit   : $currentCommit" -ForegroundColor Green
Write-Host "Target   : $SshUser@$TunnelHost"

$invokeArgs = @{
    TunnelHost = $TunnelHost
    SshUser = $SshUser
    RepoRoot = $RepoRoot
    Commit = "HEAD"
}
if ($RunCatalogCatchup) {
    $invokeArgs.RunCatalogCatchup = $true
}

& $InnerScript @invokeArgs
if ($LASTEXITCODE -ne 0) {
    throw "WholesaleHub Production 배포가 실패했습니다. exit=$LASTEXITCODE"
}

Write-Host "WholesaleHub Production 배포 및 smoke check 완료: $currentCommit" -ForegroundColor Green
