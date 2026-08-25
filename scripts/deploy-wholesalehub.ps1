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
            throw "Not a Git repository root: $repoRoot"
        }

        Get-Command git.exe -ErrorAction Stop | Out-Null
        Get-Command ssh.exe -ErrorAction Stop | Out-Null
        Get-Command scp.exe -ErrorAction Stop | Out-Null

        $head = (git rev-parse HEAD).Trim()
        Assert-NativeSuccess 'Failed to read current Git HEAD'
        $originMain = (git rev-parse origin/main).Trim()
        Assert-NativeSuccess 'Failed to read origin/main. Run git fetch origin main first.'
        if ($head -ne $originMain) {
            throw "HEAD does not match origin/main. HEAD=$head origin/main=$originMain"
        }

        $trackedChanges = git status --porcelain --untracked-files=no
        Assert-NativeSuccess 'Failed to inspect Git worktree'
        if ($trackedChanges) {
            throw 'Tracked files are modified in the deploy clone. Reset the deploy clone to origin/main first.'
        }

        Write-Host "[1/6] Checking SSH connection: $SshHost"
        ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "test -d '$RemoteProject' && test -d '$RemoteWpRoot/wp-content' && printf 'REMOTE_OK\n'"
        Assert-NativeSuccess "MiniPC connection or production path check failed: $SshHost"

        Write-Host "[2/6] Packaging GitHub HEAD: $head"
        git archive --format=tar --output=$archivePath HEAD
        Assert-NativeSuccess 'Failed to create Git release archive'

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

for plugin in "${plugins[@]}"; do
  diff -qr "$RELEASE/wordpress/plugins/$plugin" "$LIVE_PLUGINS/$plugin" >/dev/null
  echo "VERIFY_TREE_OK $plugin"
done
for file in "${mu_files[@]}"; do
  cmp -s "$RELEASE/wordpress/mu-plugins/$file" "$LIVE_MU/$file"
  echo "VERIFY_FILE_OK $file"
done

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

docker exec avocadoss-wp wp --allow-root --path=/var/www/html cache flush >/dev/null 2>&1 || true
docker exec avocadoss-wp wp --allow-root --path=/var/www/html transient delete --all >/dev/null 2>&1 || true
docker exec avocadoss-wp wp --allow-root --path=/var/www/html eval 'if (function_exists("opcache_reset")) { opcache_reset(); }' >/dev/null 2>&1 || true

HTTP_CODE="$(curl -L -sS -o /dev/null -w '%{http_code}' --max-time 30 https://hub.avocadoss.co.kr/)"
case "$HTTP_CODE" in
  2??|3??) ;;
  *) echo "live HTTP health check failed: $HTTP_CODE" >&2; exit 50 ;;
esac

# Overlay only Git-tracked source after live verification. Runtime secrets and data are untouched.
tar -xf "$ARCHIVE" -C "$PROJECT"
mkdir -p "$PROJECT/reports/runtime"
printf '%s\n' "$HEAD_SHA" > "$PROJECT/reports/runtime/deployed-github-head.txt"

DEPLOY_OK=1
echo "WHOLESALEHUB_DEPLOY_OK head=$HEAD_SHA http=$HTTP_CODE backup=$BACKUP"
'@

        # Windows PowerShell here-strings can carry CRLF into the generated .sh file.
        # Normalize to Unix LF before SCP so Bash never sees a trailing carriage return.
        $remoteScript = $remoteScript.Replace("`r`n", "`n").Replace("`r", "`n")
        [System.IO.File]::WriteAllText($remoteScriptPath, $remoteScript, [System.Text.UTF8Encoding]::new($false))

        $remoteScriptBytes = [System.IO.File]::ReadAllBytes($remoteScriptPath)
        if ($remoteScriptBytes -contains 13) {
            throw 'Generated remote Bash script still contains CR bytes.'
        }

        Write-Host '[3/6] Uploading release and safe remote deploy script'
        scp -q $archivePath "${SshHost}:/tmp/$remoteArchiveName"
        Assert-NativeSuccess 'Failed to upload release archive'
        scp -q $remoteScriptPath "${SshHost}:/tmp/$remoteScriptName"
        Assert-NativeSuccess 'Failed to upload remote deploy script'

        Write-Host '[4/6] Deploying Production WordPress with backup, PHP lint and live HTTP verification'
        ssh $SshHost "bash '/tmp/$remoteScriptName' '$head' '/tmp/$remoteArchiveName' '$RemoteProject' '$RemoteWpRoot'"
        Assert-NativeSuccess 'Production deploy or live verification failed. The remote script attempted live rollback.'

        Write-Host '[5/6] Verifying deployed GitHub HEAD'
        $deployedHead = (ssh $SshHost "cat '$RemoteProject/reports/runtime/deployed-github-head.txt'").Trim()
        Assert-NativeSuccess 'Failed to read deployed GitHub HEAD'
        if ($deployedHead -ne $head) {
            throw "Deployed HEAD mismatch. expected=$head actual=$deployedHead"
        }
        Write-Host "DEPLOYED_HEAD_OK $deployedHead"

        if ($RunCatalogCatchup) {
            Write-Host '[6/6] Running supplier catalog catch-up using same-day DailyFood snapshot plus Walldo refresh'
            ssh $SshHost "cd '$RemoteProject' && WHOLESALEHUB_SECONDARY_ONLY=1 bash scripts/n8n-supplier-catalog-sync.sh"
            if ($LASTEXITCODE -eq 75) {
                Write-Warning 'Catalog sync is already running. Production deploy completed; catch-up was skipped.'
            }
            elseif ($LASTEXITCODE -ne 0) {
                Write-Warning "Production deploy completed, but catalog catch-up failed (exit=$LASTEXITCODE). Existing schedules remain unchanged."
            }
            else {
                Write-Host 'CATALOG_CATCHUP_OK'
            }
        }
        else {
            Write-Host '[6/6] Catalog catch-up skipped'
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
