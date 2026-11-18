# Desktop installer design

Windows setup now uses a complete WPF interface, with custom window chrome,
typography, controls, directory choice, progress, completion, recovery and removal
screens. It uses the website's dark canvas, mint accent and record artwork.

The original NSIS executable embeds the small offline interface. Interactive
launches hand off to it before any wizard appears. After the launcher exits and
releases its mutex, the UI invokes that same NSIS engine with /S. Existing scope,
app identity, file associations, updater compatibility and data retention stay
owned by electron-builder. Silent CLI and in-app update invocations skip the UI.
The UI reports indeterminate activity while the engine is actually running;
success requires exit code zero and the installed executable to exist.
A running app is reported in the custom recovery screen before installation.
Windows UAC and the system folder picker remain OS dialogs.

The UI targets the .NET Framework WPF runtime bundled with supported Windows
versions; no WebView, online font or downloaded runtime is used. Native Windows
packaging compiles Setup.cs and embeds Setup.xaml with the system compiler.
Vector graphics, live text, keyboard focus and a DPI-awareness manifest keep
text readable. Completion has an Open button and a Close button, with no launch
checkbox. Temporary launcher files live in a unique per-user temporary directory.

macOS retains the branded drag-to-Applications DMG. Linux and MSIX retain their
system install formats.

The installer workflow compiles the real NSIS include with an isolated app ID,
tests silent install/update/removal, renders all WPF screens, and exercises the
WPF controller against the real NSIS fixture for install/update/removal. Screens
are uploaded as CI artifacts. Local rendering uses the same compiled WPF code:
Setup.exe --preview --name Lokal --snapshots <directory>.
