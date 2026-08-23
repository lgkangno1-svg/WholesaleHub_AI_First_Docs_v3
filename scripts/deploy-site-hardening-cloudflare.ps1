param(
    [string]$TunnelHost = "ssh.avocadoss.co.kr",
    [string]$SshUser = "tnfwod",
    [string]$RepoRoot = "C:\Users\tnfwo\Desktop\WholesaleHub_RECOVERED",
    [string]$Commit = "origin/main",
    [switch]$RunCatalogCatchup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "필수 명령을 찾을 수 없습니다: $Name"
    }
}

function Invoke-Checked([scriptblock]$Command, [string]$Description) {
    Write-Host "`n==> $Description" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description 실패 (exit=$LASTEXITCODE)"
    }
}

Require-Command git
Require-Command cloudflared
Require-Command ssh
Require-Command scp

if (-not (Test-Path -LiteralPath $RepoRoot)) {
    throw "RepoRoot가 없습니다: $RepoRoot"
}

$repoStatus = git -C $RepoRoot status --porcelain
if ($LASTEXITCODE -ne 0) { throw "git status 실패" }
if ($repoStatus) {
    Write-Warning "현재 Windows worktree에 변경이 있습니다. 이 스크립트는 변경하지 않으며 별도 임시 worktree를 사용합니다."
}

Invoke-Checked { git -C $RepoRoot fetch origin main } "origin/main 갱신"
$resolvedCommit = (git -C $RepoRoot rev-parse $Commit).Trim()
if ($LASTEXITCODE -ne 0 -or -not $resolvedCommit) { throw "Commit 해석 실패: $Commit" }
Write-Host "배포 커밋: $resolvedCommit" -ForegroundColor Green

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("wholesalehub-deploy-" + [Guid]::NewGuid().ToString("N"))
$remoteRoot = "/tmp/wholesalehub-hardening-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$target = "$SshUser@$TunnelHost"
$proxy = "cloudflared access ssh --hostname %h"

$manifest = @(
    @{ Repo = "scripts/n8n-supplier-catalog-sync.sh"; Remote = "/home/tnfwod/projects/wholesalehub/scripts/n8n-supplier-catalog-sync.sh"; Mode = "0755" },
    @{ Repo = "scripts/n8n-mvp-sync.sh"; Remote = "/home/tnfwod/projects/wholesalehub/scripts/n8n-mvp-sync.sh"; Mode = "0755" },
    @{ Repo = "scripts/supplier-catalog/check-dailyfood-freshness.mjs"; Remote = "/home/tnfwod/projects/wholesalehub/scripts/supplier-catalog/check-dailyfood-freshness.mjs"; Mode = "0644" },

    @{ Repo = "wordpress/mu-plugins/avocadoss-deposit-webhook-guard.php"; Remote = "/home/tnfwod/projects/wholesalehub/wordpress/mu-plugins/avocadoss-deposit-webhook-guard.php"; Mode = "0644" },
    @{ Repo = "wordpress/mu-plugins/avocadoss-deposit-webhook-guard.php"; Remote = "/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/mu-plugins/avocadoss-deposit-webhook-guard.php"; Mode = "0644" },

    @{ Repo = "wordpress/mu-plugins/wholesalehub-seo-aeo.php"; Remote = "/home/tnfwod/projects/wholesalehub/wordpress/mu-plugins/wholesalehub-seo-aeo.php"; Mode = "0644" },
    @{ Repo = "wordpress/mu-plugins/wholesalehub-seo-aeo.php"; Remote = "/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/mu-plugins/wholesalehub-seo-aeo.php"; Mode = "0644" },

    @{ Repo = "wordpress/mu-plugins/wholesalehub-telegram-policy.php"; Remote = "/home/tnfwod/projects/wholesalehub/wordpress/mu-plugins/wholesalehub-telegram-policy.php"; Mode = "0644" },
    @{ Repo = "wordpress/mu-plugins/wholesalehub-telegram-policy.php"; Remote = "/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/mu-plugins/wholesalehub-telegram-policy.php"; Mode = "0644" },

    @{ Repo = "wordpress/mu-plugins/assets/wholesalehub-seo-aeo.css"; Remote = "/home/tnfwod/projects/wholesalehub/wordpress/mu-plugins/assets/wholesalehub-seo-aeo.css"; Mode = "0644" },
    @{ Repo = "wordpress/mu-plugins/assets/wholesalehub-seo-aeo.css"; Remote = "/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/mu-plugins/assets/wholesalehub-seo-aeo.css"; Mode = "0644" },

    @{ Repo = "wordpress/plugins/avocadoss-performance/templates/wholesalehub-front-page.php"; Remote = "/home/tnfwod/projects/wholesalehub/wordpress/plugins/avocadoss-performance/templates/wholesalehub-front-page.php"; Mode = "0644" },
    @{ Repo = "wordpress/plugins/avocadoss-performance/templates/wholesalehub-front-page.php"; Remote = "/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/avocadoss-performance/templates/wholesalehub-front-page.php"; Mode = "0644" }
)

try {
    Invoke-Checked { git -C $RepoRoot worktree add --detach $tempRoot $resolvedCommit } "배포용 임시 worktree 생성"

    foreach ($entry in $manifest) {
        $local = Join-Path $tempRoot ($entry.Repo -replace '/', [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path -LiteralPath $local)) {
            throw "커밋에 배포 파일이 없습니다: $($entry.Repo)"
        }
    }

    Invoke-Checked { ssh -o "ProxyCommand=$proxy" $target "mkdir -p '$remoteRoot'" } "원격 staging 생성"

    $uniqueRepos = $manifest | Select-Object -ExpandProperty Repo -Unique
    foreach ($repoPath in $uniqueRepos) {
        $local = Join-Path $tempRoot ($repoPath -replace '/', [IO.Path]::DirectorySeparatorChar)
        $stageName = ($repoPath -replace '[^A-Za-z0-9._-]', '__')
        Invoke-Checked { scp -o "ProxyCommand=$proxy" $local "${target}:${remoteRoot}/${stageName}" } "staging 업로드: $repoPath"
    }

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
    foreach ($entry in $manifest) {
        $stageName = ($entry.Repo -replace '[^A-Za-z0-9._-]', '__')
        $remote = $entry.Remote
        $remoteDir = [IO.Path]::GetDirectoryName($remote).Replace('\','/')
        $command = @"
set -euo pipefail
mkdir -p '$remoteDir'
if [ -f '$remote' ]; then cp -a '$remote' '$remote.bak-$timestamp'; fi
install -m $($entry.Mode) '$remoteRoot/$stageName' '$remote'
"@
        Invoke-Checked { ssh -o "ProxyCommand=$proxy" $target $command } "surgical install: $remote"
    }

    $validate = @'
set -euo pipefail
PROJECT=/home/tnfwod/projects/wholesalehub
bash -n "$PROJECT/scripts/n8n-supplier-catalog-sync.sh"
bash -n "$PROJECT/scripts/n8n-mvp-sync.sh"
node --check "$PROJECT/scripts/supplier-catalog/check-dailyfood-freshness.mjs"
docker exec avocadoss-wp php -l /var/www/html/wp-content/mu-plugins/avocadoss-deposit-webhook-guard.php >/dev/null
docker exec avocadoss-wp php -l /var/www/html/wp-content/mu-plugins/wholesalehub-seo-aeo.php >/dev/null
docker exec avocadoss-wp php -l /var/www/html/wp-content/mu-plugins/wholesalehub-telegram-policy.php >/dev/null
docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/templates/wholesalehub-front-page.php >/dev/null
docker exec avocadoss-wp wp --allow-root --path=/var/www/html eval '
$checks = [
  "deposit_guard" => function_exists("avocadoss_guard_deposit_webhook_secret"),
  "seo_aeo" => function_exists("wholesalehub_public_faq_items"),
  "approval_telegram_enabled" => defined("WHOLESALEHUB_TELEGRAM_APPROVAL_AUTO_SEND") && WHOLESALEHUB_TELEGRAM_APPROVAL_AUTO_SEND === true,
];
foreach ($checks as $name => $ok) { echo $name . "=" . ($ok ? "YES" : "NO") . PHP_EOL; }
if (in_array(false, $checks, true)) { exit(1); }
'
docker exec avocadoss-wp wp --allow-root --path=/var/www/html cache flush >/dev/null
curl -fsS --max-time 30 -o /dev/null https://hub.avocadoss.co.kr/
echo PRODUCTION_SMOKE=PASS
'@
    Invoke-Checked { ssh -o "ProxyCommand=$proxy" $target $validate } "Production syntax/bootstrap/live smoke"

    if ($RunCatalogCatchup) {
        $catchup = @'
set -euo pipefail
cd /home/tnfwod/projects/wholesalehub
WHOLESALEHUB_FORCE_FULL_DAILY=1 bash scripts/n8n-supplier-catalog-sync.sh
'@
        Invoke-Checked { ssh -o "ProxyCommand=$proxy" $target $catchup } "Daily/Walldo controlled catalog catch-up + Telegram"
    }

    Write-Host "`n배포 완료: $resolvedCommit" -ForegroundColor Green
    Write-Host "백업 suffix: .bak-$timestamp" -ForegroundColor Green
    if (-not $RunCatalogCatchup) {
        Write-Host "신규 Daily 상품 catch-up까지 실행하려면 같은 명령에 -RunCatalogCatchup 을 추가하세요." -ForegroundColor Yellow
    }
}
finally {
    try {
        $cleanup = "if [ -d '$remoteRoot' ]; then find '$remoteRoot' -mindepth 1 -maxdepth 1 -type f -delete; rmdir '$remoteRoot' 2>/dev/null || true; fi"
        ssh -o "ProxyCommand=$proxy" $target $cleanup | Out-Null
    } catch {}
    if (Test-Path -LiteralPath $tempRoot) {
        git -C $RepoRoot worktree remove --force $tempRoot | Out-Null
    }
}
