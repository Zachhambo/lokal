$ErrorActionPreference = 'Stop'
$setupExe = (Resolve-Path 'build/installer/generated/Setup.exe').Path
$captures = Join-Path (Resolve-Path 'build/installer/generated').Path 'screens'
New-Item -ItemType Directory -Path $captures -Force | Out-Null
foreach ($brand in @('Lokal', 'LokTube')) {
  $render = Start-Process -FilePath $setupExe -ArgumentList @('--preview', '--name', $brand, '--snapshots', "`"$captures`"") -Wait -PassThru -WindowStyle Hidden
  if ($render.ExitCode -ne 0) { throw "Rendering $brand setup failed" }
}
$installer = Get-ChildItem -LiteralPath installer-test-output -Filter '*.exe' | Where-Object { $_.Name -notmatch '__uninstaller' } | Select-Object -First 1
if (-not $installer) { throw 'Missing isolated NSIS fixture' }
$installDir = Join-Path $env:RUNNER_TEMP 'LokalCustomSetupFixture'
$settings = Join-Path $env:RUNNER_TEMP 'LokalCustomSetupFixture.ini'
function Invoke-SetupFixture([string]$mode, [bool]$existing, [string]$engine) {
  $value = if ($existing) { '1' } else { '0' }
  $ini = "[Setup]`r`nName=LokalInstallerSmoke`r`nVersion=1.0.0`r`nSource=$engine`r`nDirectory=$installDir`r`nExecutable=LokalInstallerSmoke.exe`r`nScope=current`r`nMode=$mode`r`nExisting=$value`r`nTestFixture=1`r`n"
  [System.IO.File]::WriteAllText($settings, $ini, [System.Text.Encoding]::Unicode)
  $run = Start-Process -FilePath $setupExe -ArgumentList @('--config', "`"$settings`"", '--exercise', "`"$captures`"") -Wait -PassThru -WindowStyle Hidden
  if ($run.ExitCode -ne 0) { throw "Custom UI $mode failed; inspect the engine screenshot artifact" }
}
Invoke-SetupFixture 'install' $false $installer.FullName
# An older app may invoke --updated without /S; no setup window should appear.
$update = Start-Process -FilePath $installer.FullName -ArgumentList "--updated /currentuser /D=$installDir" -Wait -PassThru -WindowStyle Hidden
if ($update.ExitCode -ne 0) { throw 'Update intent did not bypass custom setup' }
$unexpected = Get-Process Setup -ErrorAction SilentlyContinue | Where-Object { $_.Path -ne $setupExe }
if ($unexpected) { throw 'A duplicate setup UI appeared during unattended update' }
Invoke-SetupFixture 'install' $true $installer.FullName
$uninstaller = Join-Path $installDir 'Uninstall LokalInstallerSmoke.exe'
Invoke-SetupFixture 'uninstall' $true $uninstaller
