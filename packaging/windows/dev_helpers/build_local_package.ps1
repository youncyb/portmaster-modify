#------------------------------------------------------------------------------
# Portmaster 本机精简打包脚本
#------------------------------------------------------------------------------
# 编译 portmaster-core.exe + Angular UI (portmaster.zip)，输出到 dist/local-package。
# 可选：覆盖安装到本机 Portmaster 目录并重启服务（与手动替换流程一致）。
#
# 依赖：Go、Node.js/npm、（安装时需管理员权限）
#
# 用法示例：
#   .\build_local_package.ps1
#   .\build_local_package.ps1 -Development
#   .\build_local_package.ps1 -Proxy http://127.0.0.1:1086
#   .\build_local_package.ps1 -Install -InstallDir "D:\app\Portmaster"
#   .\build_local_package.ps1 -SkipNpmInstall -SkipCore
#------------------------------------------------------------------------------

[CmdletBinding()]
param (
    [Alias("d")]
    [switch]$Development,

    [string]$Proxy = "",

    [string]$GoProxy = "https://goproxy.cn,direct",

    [switch]$SkipNpmInstall,

    [switch]$SkipCore,

    [switch]$SkipUI,

    [Alias("i")]
    [switch]$Install,

    [string]$InstallDir = "D:\app\Portmaster",

    [string]$ServiceName = "PortmasterCore",

    [switch]$NoBackup
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Yellow
}

function Invoke-Native {
    param (
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,
        [string]$ErrorMessage = "Command failed"
    )
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$ErrorMessage (exit code: $LASTEXITCODE)"
    }
}

function Set-ProxyEnv([string]$ProxyUrl) {
    if ([string]::IsNullOrWhiteSpace($ProxyUrl)) {
        return
    }
    $env:HTTP_PROXY = $ProxyUrl
    $env:HTTPS_PROXY = $ProxyUrl
    $env:http_proxy = $ProxyUrl
    $env:https_proxy = $ProxyUrl
    $env:ALL_PROXY = $ProxyUrl
    Write-Ok "Proxy: $ProxyUrl"
}

function New-ZipFromDirectory {
    param (
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$ZipPath
    )
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $SourceDir,
        $ZipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )
}

function Install-LocalPackageElevated {
    param (
        [Parameter(Mandatory = $true)][string]$CoreSrc,
        [Parameter(Mandatory = $true)][string]$UiZipSrc,
        [Parameter(Mandatory = $true)][string]$TargetDir,
        [Parameter(Mandatory = $true)][string]$SvcName,
        [switch]$SkipBackup
    )

    $backupFlag = if ($SkipBackup) { '$true' } else { '$false' }
    $installScript = @"
`$ErrorActionPreference = 'Stop'
`$log = Join-Path `$env:TEMP 'pm-local-install.log'
function Log(`$m) { `$m | Tee-Object -FilePath `$log -Append }
try {
  if (Test-Path `$log) { Remove-Item `$log -Force }
  `$target = '$TargetDir'
  `$coreSrc = '$CoreSrc'
  `$uiSrc = '$UiZipSrc'
  `$svc = '$SvcName'
  `$noBackup = $backupFlag

  if (-not (Test-Path -LiteralPath `$target)) {
    throw "Install directory not found: `$target"
  }

  Log "=== Backup ==="
  if (-not `$noBackup) {
    `$backup = Join-Path `$env:TEMP ("pm-backup_" + (Get-Date -Format 'yyyyMMdd_HHmmss'))
    New-Item -ItemType Directory -Path `$backup -Force | Out-Null
    if (Test-Path (Join-Path `$target 'portmaster-core.exe')) {
      Copy-Item (Join-Path `$target 'portmaster-core.exe') `$backup -Force
    }
    if (Test-Path (Join-Path `$target 'portmaster.zip')) {
      Copy-Item (Join-Path `$target 'portmaster.zip') `$backup -Force
    }
    Log "Backup: `$backup"
  } else {
    Log "Backup skipped"
  }

  Log "=== Stop service ==="
  Stop-Service -Name `$svc -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Get-Process -Name 'portmaster-core','portmaster' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Log "Service: `$((Get-Service -Name `$svc).Status)"

  Log "=== Replace files ==="
  Copy-Item -LiteralPath `$coreSrc -Destination (Join-Path `$target 'portmaster-core.exe') -Force
  Copy-Item -LiteralPath `$uiSrc -Destination (Join-Path `$target 'portmaster.zip') -Force
  Log "Core=`$((Get-Item (Join-Path `$target 'portmaster-core.exe')).Length)"
  Log "UI=`$((Get-Item (Join-Path `$target 'portmaster.zip')).Length)"

  Log "=== Start service ==="
  Start-Service -Name `$svc
  Start-Sleep -Seconds 3
  Log "Service: `$((Get-Service -Name `$svc).Status)"
  Log "DONE"
} catch {
  Log "ERROR: `$(`$_.Exception.Message)"
  try { Start-Service -Name '$SvcName' -ErrorAction SilentlyContinue } catch {}
  exit 1
}
"@

    $scriptPath = Join-Path $env:TEMP "pm-local-install.ps1"
    Set-Content -LiteralPath $scriptPath -Value $installScript -Encoding UTF8

    $proc = Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) `
        -Verb RunAs -PassThru -Wait

    $logPath = Join-Path $env:TEMP "pm-local-install.log"
    if (Test-Path -LiteralPath $logPath) {
        Get-Content -LiteralPath $logPath | ForEach-Object { Write-Host "    $_" }
    }

    if ($proc.ExitCode -ne 0) {
        throw "Install failed (exit code: $($proc.ExitCode)). See $logPath"
    }
}

# ---- main ----

$originalDir = Get-Location
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Get-Item $scriptDir).Parent.Parent.Parent.FullName
$outputDir = Join-Path $scriptDir "dist\local-package"
$angularDir = Join-Path $projectRoot "desktop\angular"
$coreOut = Join-Path $outputDir "portmaster-core.exe"
$uiZipOut = Join-Path $outputDir "portmaster.zip"
$uiBuildDir = Join-Path $angularDir "dist"

try {
    Write-Host "Portmaster local package builder" -ForegroundColor Green
    Write-Host "Project: $projectRoot"
    Write-Host "Output : $outputDir"
    if ($Development) {
        Write-Warn "UI configuration: development"
    } else {
        Write-Ok "UI configuration: production"
    }

    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

    # -------- Core --------
    if (-not $SkipCore) {
        Write-Step "Build portmaster-core.exe"
        if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
            throw "Go not found in PATH"
        }

        # Prefer direct/China GOPROXY for module download; optional HTTP proxy for npm mainly.
        $env:CGO_ENABLED = "0"
        $env:GOPROXY = $GoProxy
        # Avoid broken local HTTP proxies breaking go module download.
        $savedHttpProxy = $env:HTTP_PROXY
        $savedHttpsProxy = $env:HTTPS_PROXY
        $env:HTTP_PROXY = $null
        $env:HTTPS_PROXY = $null
        $env:http_proxy = $null
        $env:https_proxy = $null
        $env:ALL_PROXY = $null

        Push-Location $projectRoot
        try {
            Write-Ok "GOPROXY=$GoProxy  CGO_ENABLED=0"
            Invoke-Native -ErrorMessage "go build failed" -Command {
                go build -o $coreOut ./cmds/portmaster-core
            }
        } finally {
            Pop-Location
            $env:HTTP_PROXY = $savedHttpProxy
            $env:HTTPS_PROXY = $savedHttpsProxy
        }

        $coreItem = Get-Item -LiteralPath $coreOut
        Write-Ok ("Built {0} ({1:N0} bytes)" -f $coreItem.Name, $coreItem.Length)
    } else {
        Write-Step "Skip core build"
        if (-not (Test-Path -LiteralPath $coreOut)) {
            throw "SkipCore set but missing: $coreOut"
        }
    }

    # -------- UI --------
    if (-not $SkipUI) {
        Write-Step "Build Angular UI -> portmaster.zip"
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            throw "npm not found in PATH"
        }
        if (-not (Test-Path -LiteralPath $angularDir)) {
            throw "Angular project not found: $angularDir"
        }

        Set-ProxyEnv -ProxyUrl $Proxy

        Push-Location $angularDir
        try {
            if (-not $SkipNpmInstall) {
                Write-Ok "npm install"
                if (-not [string]::IsNullOrWhiteSpace($Proxy)) {
                    npm config set proxy $Proxy | Out-Null
                    npm config set https-proxy $Proxy | Out-Null
                }
                Invoke-Native -ErrorMessage "npm install failed" -Command { npm install }
            } else {
                Write-Warn "Skip npm install"
            }

            if ($Development) {
                Write-Ok "npm run build-libs:dev"
                Invoke-Native -ErrorMessage "build-libs:dev failed" -Command { npm run build-libs:dev }
                Write-Ok "ng build (development)"
                Invoke-Native -ErrorMessage "ng build failed" -Command {
                    npx ng build --configuration development --base-href /ui/modules/portmaster/ portmaster
                }
            } else {
                Write-Ok "npm run build-libs"
                Invoke-Native -ErrorMessage "build-libs failed" -Command { npm run build-libs }
                Write-Ok "ng build (production)"
                Invoke-Native -ErrorMessage "ng build failed" -Command {
                    npx ng build --configuration production --base-href /ui/modules/portmaster/ portmaster
                }
            }
        } finally {
            Pop-Location
        }

        if (-not (Test-Path -LiteralPath (Join-Path $uiBuildDir "index.html"))) {
            throw "UI build output missing index.html under $uiBuildDir"
        }

        Write-Ok "Create portmaster.zip"
        New-ZipFromDirectory -SourceDir $uiBuildDir -ZipPath $uiZipOut
        $zipItem = Get-Item -LiteralPath $uiZipOut
        Write-Ok ("Built {0} ({1:N0} bytes)" -f $zipItem.Name, $zipItem.Length)
    } else {
        Write-Step "Skip UI build"
        if (-not (Test-Path -LiteralPath $uiZipOut)) {
            throw "SkipUI set but missing: $uiZipOut"
        }
    }

    # -------- summary package folder --------
    Write-Step "Package summary"
    $readmePath = Join-Path $outputDir "REPLACE.txt"
    @"
Portmaster local package
========================
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

Files:
  - portmaster-core.exe
  - portmaster.zip

Manual install:
  1. Stop service PortmasterCore (and exit portmaster.exe)
  2. Backup existing files in the install directory
  3. Copy portmaster-core.exe and portmaster.zip into the install dir
     (default example: D:\app\Portmaster\)
  4. Start service PortmasterCore
  5. Relaunch the desktop UI

Or re-run:
  .\build_local_package.ps1 -SkipCore -SkipUI -Install -InstallDir "D:\app\Portmaster"
"@ | Set-Content -LiteralPath $readmePath -Encoding UTF8

    Get-ChildItem -LiteralPath $outputDir | Format-Table Name, Length, LastWriteTime -AutoSize
    Write-Ok "Output directory: $outputDir"

    # -------- optional install --------
    if ($Install) {
        Write-Step "Install to $InstallDir (elevated)"
        if (-not (Test-Path -LiteralPath $InstallDir)) {
            throw "InstallDir not found: $InstallDir"
        }
        Install-LocalPackageElevated `
            -CoreSrc $coreOut `
            -UiZipSrc $uiZipOut `
            -TargetDir $InstallDir `
            -SvcName $ServiceName `
            -SkipBackup:$NoBackup
        Write-Ok "Install finished. Please fully restart the Portmaster desktop UI."
    } else {
        Write-Warn "Not installed. Use -Install to replace the running instance."
    }

    Write-Host ""
    Write-Host "Done." -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Set-Location $originalDir
}
