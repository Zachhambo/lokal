; No stock wizard pages are shown in interactive setup. The self-contained WPF
; interface invokes this SAME installer with /S after this launch process exits.
; Builder still owns the app identity, signing, extraction, UAC and updater.
!include LogicLib.nsh

!macro launchCustomSetup MODE
  ; Older installed versions may call the updater without /S. Update intent
  ; still bypasses the UI and preserves Builder\'s --force-run handling.
  ${If} ${isUpdated}
    SetSilent silent
  ${EndIf}
  ${IfNot} ${Silent}
  ${AndIfNot} ${UAC_IsInnerInstance}
    GetTempFileName $R0
    Delete "$R0"
    CreateDirectory "$R0"
    SetOutPath "$R0"
    File /oname=Setup.exe "${PROJECT_DIR}\build\installer\generated\Setup.exe"
    WriteINIStr "$R0\setup.ini" Setup Name "${PRODUCT_NAME}"
    WriteINIStr "$R0\setup.ini" Setup Version "${VERSION}"
    WriteINIStr "$R0\setup.ini" Setup Directory "$INSTDIR"
    WriteINIStr "$R0\setup.ini" Setup Executable "${APP_EXECUTABLE_FILENAME}"
    WriteINIStr "$R0\setup.ini" Setup Scope "$installMode"
    WriteINIStr "$R0\setup.ini" Setup Mode "${MODE}"
    WriteINIStr "$R0\setup.ini" Setup Existing "0"
    ${If} $hasPerUserInstallation == "1"
    ${OrIf} $hasPerMachineInstallation == "1"
      WriteINIStr "$R0\setup.ini" Setup Existing "1"
    ${EndIf}
    System::Call 'kernel32::GetCurrentProcessId() i.r1'
    WriteINIStr "$R0\setup.ini" Setup Parent "$1"
    !if "${MODE}" == "uninstall"
      ; NSIS may have copied itself into a temporary path that is deleted on
      ; exit. Keep a private copy for the silent removal after this process ends.
      CopyFiles /SILENT "$EXEPATH" "$R0\engine.exe"
      WriteINIStr "$R0\setup.ini" Setup Source "$R0\engine.exe"
    !else
      WriteINIStr "$R0\setup.ini" Setup Source "$EXEPATH"
    !endif
    ClearErrors
    Exec '"$R0\Setup.exe" --config "$R0\setup.ini"'
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Setup could not open. Please run the installer again."
      SetErrorLevel 1
      Quit
    ${EndIf}
    ; Release the single-installer mutex before WPF runs the /S installation.
    SetErrorLevel 0
    Quit
  ${EndIf}
!macroend

!macro customInit
  !insertmacro launchCustomSetup "install"
!macroend
!macro customUnInit
  !insertmacro launchCustomSetup "uninstall"
!macroend
