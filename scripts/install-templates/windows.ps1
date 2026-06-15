$ErrorActionPreference = "Stop"

$DefaultVersion = "<<DEFAULT_VERSION>>"
$Platform = "windows-x64"
$Repo = "docstube/docstube"
$InstallDir = if ($env:DOCSTUBE_INSTALL_DIR) { $env:DOCSTUBE_INSTALL_DIR } else { Join-Path $HOME ".docstube\bin" }
$Version = if ($env:DOCSTUBE_VERSION) { $env:DOCSTUBE_VERSION } else { $DefaultVersion }
$EventsUrl = if ($env:DOCSTUBE_INSTALL_EVENTS_URL) { $env:DOCSTUBE_INSTALL_EVENTS_URL } else { "https://events.docstube.dev/v1/install" }
$InstallId = if ($env:DOCSTUBE_INSTALL_ID) { $env:DOCSTUBE_INSTALL_ID } else { [Guid]::NewGuid().ToString() }

if (-not $Version) {
  throw "DOCSTUBE_VERSION is required."
}

$SafeVersion = if ($Version -match "^[A-Za-z0-9._-]+$") { $Version } else { "custom" }
$StartedAt = Get-Date
$InstallResult = "failed"
$InstallError = "unexpected"

function Send-InstallEvent {
  param(
    [string] $Status,
    [string] $ErrorKind = ""
  )

  if ($env:DO_NOT_TRACK -eq "1" -or $env:DOCSTUBE_TELEMETRY -eq "0") {
    return
  }

  $DurationMs = [int]((Get-Date) - $StartedAt).TotalMilliseconds
  $Body = @{
    installId = $InstallId
    status = $Status
    version = $SafeVersion
    platform = $Platform
    installer = "windows.ps1"
    source = "github-release"
    durationMs = $DurationMs
    errorKind = $ErrorKind
  } | ConvertTo-Json -Compress

  try {
    Invoke-WebRequest -Uri $EventsUrl -Method Post -ContentType "application/json" -Body $Body -TimeoutSec 2 | Out-Null
  } catch {
  }
}

$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("docstube-install-" + [Guid]::NewGuid().ToString("N"))
$Asset = "docstube-v$Version-$Platform.zip"
$Url = "https://github.com/$Repo/releases/download/v$Version/$Asset"

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

try {
  Send-InstallEvent -Status "started"
  $ArchivePath = Join-Path $TempDir $Asset
  $InstallError = "download_failed"
  Invoke-WebRequest -Uri $Url -OutFile $ArchivePath
  $InstallError = "extract_failed"
  Expand-Archive -Path $ArchivePath -DestinationPath $TempDir -Force
  $InstallError = "copy_failed"
  Copy-Item -Path (Join-Path $TempDir "docstube.exe") -Destination (Join-Path $InstallDir "docstube.exe") -Force
  $InstallError = "verify_failed"
  & (Join-Path $InstallDir "docstube.exe") --version | Out-Null
  $InstallResult = "succeeded"
  Send-InstallEvent -Status "succeeded"
  Write-Host "docstube $Version installed to $(Join-Path $InstallDir 'docstube.exe')"
  Write-Host "Add $InstallDir to PATH if docstube is not already available."
} finally {
  if ($InstallResult -eq "failed") {
    Send-InstallEvent -Status "failed" -ErrorKind $InstallError
  }
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
