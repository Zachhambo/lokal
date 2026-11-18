// Build the offline WPF interface using Windows' .NET Framework compiler.
// No WebView, browser download or application runtime is required during setup.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
function buildSetupUI() {
  if (process.platform !== 'win32') return
  const root = path.resolve(__dirname, '..')
  const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
  const source = path.join(root, 'build', 'installer')
  const output = path.join(source, 'generated')
  fs.mkdirSync(output, { recursive: true })
  const refs = ['PresentationFramework', 'PresentationCore', 'WindowsBase'].map(name => '/reference:' + path.join(framework, 'WPF', name + '.dll'))
  const result = spawnSync(path.join(framework, 'csc.exe'), [
    '/nologo', '/target:winexe', '/optimize+', '/out:' + path.join(output, 'Setup.exe'),
    '/win32manifest:' + path.join(source, 'Setup.manifest'), ...refs,
    '/reference:' + path.join(framework, 'System.Xaml.dll'), '/reference:System.Windows.Forms.dll',
    '/resource:' + path.join(source, 'Setup.xaml') + ',Setup.xaml', path.join(source, 'Setup.cs'),
  ], { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Custom setup UI compilation failed: ' + result.status)
}
if (require.main === module) buildSetupUI()
module.exports = buildSetupUI
