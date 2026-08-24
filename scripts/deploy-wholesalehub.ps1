[CmdletBinding()]
param(
    [switch]$RunCatalogCatchup,
    [string]$SshHost = 'minipc',
    [string]$RemoteProject = '/home/tnfwod/projects/wholesalehub',
    [string]$RemoteWpRoot = '/home/tnfwod/avocadoss-wordpress/wp_data'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
    param([Parameter(Mandatory = $true)][string]$Message)
    if ($LASTEXITCODE -ne 0) {
        throw "$Message (exit=$LASTEXITCODE)"
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("wholesalehub-deploy-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $workDir 'release.tar'
$remoteScriptPath = Join-Path $workDir 'remote-deploy.sh'
$remoteArchiveName = "wholesalehub-release-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).tar"
$remoteScriptName = "wholesalehub-deploy-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).sh"

New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    Push-Location $repoRoot
    try {
        if (-not (Test-Path '.git')) {
            throw "Git 저장소 루트가 아닙니다: $repoRoot"
        }

        Get-Command git.exe -ErrorAction Stop | Out-Null
        Get-Command ssh.exe -ErrorAction Stop | Out-Null
        Get-Command scp.exe -ErrorAction Stop | Out-Null

        $head = (git rev-parse HEAD).Trim()
        Assert-NativeSuccess '현재 Git HEAD 확인 실패'
        $originMain = (git rev-parse origin/main).Trim()
        Assert-NativeSuccess 'origin/main 확인 실패. 먼저 git fetch origin main 을 실행하세요.'
        if ($head -ne $originMain) {
            throw "현재 HEAD가 origin/main과 다릅니다. HEAD=$head origin/main=$originMain"
        }

        $trackedChanges = git status --porcelain --untracked-files=no
        Assert-NativeSuccess 'Git 작업트리 상태 확인 실패'
        if ($trackedChanges) {
            throw "배포 전용 복제본에 추적 파일 변경이 있습니다. origin/main으로 다시 동기화한 뒤 실행하세요."
        }

        Write-Host "[1/6] SSH 연결 확인: $SshHost"
        ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "test -d '$RemoteProject' && test -d '$RemoteWpRoot/wp-content' && printf 'REMOTE_OK\n'"
        Assert-NativeSuccess "MiniPC 연결 또는 운영 경로 확인 실패: $SshHost"

        Write-Host "[2/6] GitHub HEAD 패키징: $head"
        git archive --format=tar --output=$archivePath HEAD
        Assert-NativeSuccess 'Git release archive 생성 실패'

        $remoteScript = @'
#!/usr/bin/env bash
set -Eeuo pipefail

HEAD_SHA="$1"
ARCHIVE="$2"
PROJECT="$3"
WP_ROOT="$4"
LIVE_PLUGINS="$WP_ROOT/wp-content/plugins"
LIVE_MU="$WP_ROOT/wp-content/mu-plugins"
STAMP="$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S)"
BACKUP="$PROJECT/reports/deploy-backups/$STAMP-$HEAD_SHA"
STAGE="$PROJECT/reports/deploy-stage/$STAMP-$HEAD_SHA"
FAILED="$PROJECT/reports/deploy-failed/$STAMP-$HEAD_SHA"
RELEASE="$STAGE/release"
DEPLOYED_LIST="$STAGE/deployed-plugins.txt"
MU_EXISTING="$STAGE/mu-existing.txt"
MU_NEW="$STAGE/mu-new.txt"
DEPLOY_OK=0

mkdir -p "$PROJECT" "$LIVE_PLUGINS" "$LIVE_MU" "$BACKUP/plugins" "$BACKUP/mu" "$STAGE/plugins" "$STAGE/mu" "$FAILED/plugins" "$RELEASE"
: > "$DEPLOYED_LIST"
: > "$MU_EXISTING"
: > "$MU_NEW"

rollback_live() {
  echo "ROLLBACK: restoring previous live WordPress files" >&2
  if [ -f "$DEPLOYED_LIST" ]; then
    while IFS= read -r plugin; do
      [ -n "$plugin" ] || continue
      if [ -e "$LIVE_PLUGINS/$plugin" ]; then
        mv "$LIVE_PLUGINS/$plugin" "$FAILED/plugins/$plugin" 2>/dev/null || true
      fi
      if [ -e "$BACKUP/plugins/$plugin" ]; then
        mv "$BACKUP/plugins/$plugin" "$LIVE_PLUGINS/$plugin" 2>/dev/null || true
      fi
    done < "$DEPLOYED_LIST"
  fi
  if [ -f "$MU_EXISTING" ]; then
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      [ -f "$BACKUP/mu/$file" ] && cp -a "$BACKUP/mu/$file" "$LIVE_MU/$file" || true
    done < "$MU_EXISTING"
  fi
  if [ -f "$MU_NEW" ]; then
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      rm -f "$LIVE_MU/$file" 2>/dev/null || true
    done < "$MU_NEW"
  fi
}

on_exit() {
  code=$?
  if [ "$DEPLOY_OK" -ne 1 ]; then
    rollback_live || true
  fi
  rm -f "$ARCHIVE" 2>/dev/null || true
  return "$code"
}
trap on_exit EXIT

[ -f "$ARCHIVE" ] || { echo "release archive missing: $ARCHIVE" >&2; exit 20; }
[ -d "$PROJECT" ] || { echo "project path missing: $PROJECT" >&2; exit 21; }
[ -d "$WP_ROOT/wp-content" ] || { echo "WordPress path missing: $WP_ROOT" >&2; exit 22; }
command -v docker >/dev/null 2>&1 || { echo "docker not found" >&2; exit 23; }
command -v tar >/dev/null 2>&1 || { echo "tar not found" >&2; exit 24; }
command -v node >/dev/null 2>&1 || { echo "node not found" >&2; exit 25; }

# Validate the GitHub release in an isolated stage before touching live WordPress.
tar -xf "$ARCHIVE" -C "$RELEASE"
bash -n "$RELEASE/scripts/n8n-supplier-catalog-sync.sh"
node --check "$RELEASE/scripts/supplier-catalog/collect-dailyfood-catalog.mjs"
node --check "$RELEASE/scripts/supplier-catalog/collect-walldob2b-catalog.mjs"
node --check "$RELEASE/scripts/supplier-catalog/build-catalog-plan.mjs"

plugins=(avocadoss-performance avocadoss-supplier-order-export wholesalehub-supplier-lanes)
for plugin in "${plugins[@]}"; do
  src="$RELEASE/wordpress/plugins/$plugin"
  [ -d "$src" ] || { echo "source plugin missing: $src" >&2; exit 30; }
  mkdir -p "$STAGE/plugins/$plugin"
  cp -a "$src/." "$STAGE/plugins/$plugin/"
  if [ -e "$LIVE_PLUGINS/$plugin" ]; then
    mv "$LIVE_PLUGINS/$plugin" "$BACKUP/plugins/$plugin"
  fi
  # Record the swap before installing the staged tree so rollback also covers an install-move failure.
  printf '%s\n' "$plugin" >> "$DEPLOYED_LIST"
  mv "$STAGE/plugins/$plugin" "$LIVE_PLUGINS/$plugin"
done

mu_files=(avocadoss-login-recovery.php avocadoss-product-source-column.php avocadoss-security-headers.php)
for file in "${mu_files[@]}"; do
  src="$RELEASE/wordpress/mu-plugins/$file"
  [ -f "$src" ] || { echo "source mu-plugin missing: $src" >&2; exit 31; }
  cp -a "$src" "$STAGE/mu/$file"
  if [ -f "$LIVE_MU/$file" ]; then
    cp -a "$LIVE_MU/$file" "$BACKUP/mu/$file"
    printf '%s\n' "$file" >> "$MU_EXISTING"
  else
    printf '%s\n' "$file" >> "$MU_NEW"
  fi
  cp -a "$STAGE/mu/$file" "$LIVE_MU/$file"
done

# Exact staged-release/live verification before cache flush.
for plugin in "${plugins[@]}"; do
  diff -qr "$RELEASE/wordpress/plugins/$plugin" "$LIVE_PLUGINS/$plugin" >/dev/null
  echo "VERIFY_TREE_OK $plugin"
done
for file in "${mu_files[@]}"; do
  cmp -s "$RELEASE/wordpress/mu-plugins/$file" "$LIVE_MU/$file"
  echo "VERIFY_FILE_OK $file"
done

# PHP syntax verification inside the actual WordPress container.
docker exec avocadoss-wp sh -lc '
set -eu
for d in \
  /var/www/html/wp-content/plugins/avocadoss-performance \
  /var/www/html/wp-content/plugins/avocadoss-supplier-order-export \
  /var/www/html/wp-content/plugins/wholesalehub-supplier-lanes; do
  [ -d "$d" ] || exit 41
  find "$d" -type f -name "*.php" -exec php -l {} \; >/dev/null
done
for f in \
  /var/www/html/wp-content/mu-plugins/avocadoss-login-recovery.php \
  /var/www/html/wp-content/mu-plugins/avocadoss-product-source-column.php \
  /var/www/html/wp-content/mu-plugins/avocadoss-security-headers.php; do
  [ -f "$f" ] || exit 42
  php -l "$f" >/dev/null
done
'

docker exec avocadoss-wp wp --allow-root --path=/var/www/html plugin is-active avocadoss-performance >/dev/null
docker exec avocadoss-wp wp --allow-root --path=/var/www/html plugin is-active wholesalehub-supplier-lanes >/dev/null

# Best-effort runtime cache refresh. These are not allowed to turn a valid deploy into a failure.
docker exec avocadoss-wp wp --allow-root --path=/var/www/html cache flush >/dev/null 2>&1 || true
docker exec avocadoss-wp wp --allow-root --path=/var/www/html transient delete --all >/dev/null 2>&1 || true
docker exec avocadoss-wp wp --allow-root --path=/var/www/html eval 'if (function_exists("opcache_reset")) { opcache_reset(); }' >/dev/null 2>&1 || true

HTTP_CODE="$(curl -L -sS -o /dev/null -w '%{http_code}' --max-time 30 https://hub.avocadoss.co.kr/)"
case "$HTTP_CODE" in
  2??|3??) ;;
  *) echo "live HTTP health check failed: $HTTP_CODE" >&2; exit 50 ;;
esac

# Only after live verification, overlay Git-tracked source into the MiniPC project.
# .env, data, DB and generated reports are not part of git archive and remain untouched.
tar -xf "$ARCHIVE" -C "$PROJECT"
mkdir -p "$PROJECT/reports/runtime"
printf '%s\n' "$HEAD_SHA" > "$PROJECT/reports/runtime/deployed-github-head.txt"

DEPLOY_OK=1
echo "WHOLESALEHUB_DEPLOY_OK head=$HEAD_SHA http=$HTTP_CODE backup=$BACKUP"
'@

        [System.IO.File]::WriteAllText($remoteScriptPath, $remoteScript, [System.Text.UTF8Encoding]::new($false))

        Write-Host '[3/6] Release와 안전 배포 스크립트 업로드'
        scp -q $archivePath "${SshHost}:/tmp/$remoteArchiveName"
        Assert-NativeSuccess 'Release archive 업로드 실패'
        scp -q $remoteScriptPath "${SshHost}:/tmp/$remoteScriptName"
        Assert-NativeSuccess 'Remote deploy script 업로드 실패'

        Write-Host '[4/6] Production WordPress 원자적 배포 + 백업 + PHP lint + live HTTP 검증'
        ssh $SshHost "bash '/tmp/$remoteScriptName' '$head' '/tmp/$remoteArchiveName' '$RemoteProject' '$RemoteWpRoot'"
        Assert-NativeSuccess 'Production 배포 또는 live 검증 실패. 원격 스크립트가 live WordPress 파일 롤백을 시도했습니다.'

        Write-Host '[5/6] Production 배포 HEAD 재확인'
        $deployedHead = (ssh $SshHost "cat '$RemoteProject/reports/runtime/deployed-github-head.txt'").Trim()
        Assert-NativeSuccess 'Production deployed HEAD 읽기 실패'
        if ($deployedHead -ne $head) {
            throw "Production deployed HEAD 불일치. expected=$head actual=$deployedHead"
        }
        Write-Host "DEPLOYED_HEAD_OK $deployedHead"

        if ($RunCatalogCatchup) {
            Write-Host '[6/6] 공급사 카탈로그 즉시 catch-up (DailyFood 당일 11시 정상 스냅샷 재사용 + Walldo 재수집)'
            ssh $SshHost "cd '$RemoteProject' && WHOLESALEHUB_SECONDARY_ONLY=1 bash scripts/n8n-supplier-catalog-sync.sh"
            if ($LASTEXITCODE -eq 75) {
                Write-Warning '카탈로그 동기화가 이미 실행 중이라 catch-up을 건너뛰었습니다. Production 배포 자체는 정상 완료되었습니다.'
            }
            elseif ($LASTEXITCODE -ne 0) {
                Write-Warning "Production 배포는 완료되었지만 catalog catch-up이 실패했습니다 (exit=$LASTEXITCODE). 기존 정기 스케줄은 유지됩니다."
            }
            else {
                Write-Host 'CATALOG_CATCHUP_OK'
            }
        }
        else {
            Write-Host '[6/6] Catalog catch-up 생략'
        }

        Write-Host ''
        Write-Host "WHOLESALEHUB_PATCH_COMPLETE $head"
        Write-Host 'Live: https://hub.avocadoss.co.kr/'
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
