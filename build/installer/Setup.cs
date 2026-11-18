using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;

// A UI for the existing signed NSIS executable, not a replacement install engine.
// Interactive NSIS exits before this process starts /S, releasing Builder's mutex.
// CLI /S, electron-updater and UAC inner instances never enter this interface.
public sealed class SetupUI {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetPrivateProfileString(string section, string key, string fallback, StringBuilder value, uint size, string file);
  readonly Window window;
  readonly string config, name, version, source, directory, scope, executable;
  readonly bool preview, uninstall, existing, tube;
  string destination, stage = "welcome";
  bool busy;
  string Read(string key, string fallback) {
    if (config == null) return fallback;
    var value = new StringBuilder(32768);
    GetPrivateProfileString("Setup", key, fallback, value, (uint)value.Capacity, config);
    return value.ToString();
  }
  T Find<T>(string key) where T : class { return window.FindName(key) as T; }
  void Text(string key, string value) { Find<TextBlock>(key).Text = value; }
  void Visible(string key, bool value) { Find<FrameworkElement>(key).Visibility = value ? Visibility.Visible : Visibility.Collapsed; }
  public SetupUI(string[] args) {
    preview = Array.IndexOf(args, "--preview") >= 0;
    for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--config") config = Path.GetFullPath(args[i + 1]);
    if (!preview && (config == null || !File.Exists(config))) throw new InvalidOperationException("Setup configuration is missing. Run the downloaded installer again.");
    string previewName = "Lokal";
    for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--name") previewName = args[i + 1];
    name = Read("Name", previewName); version = Read("Version", "Preview");
    tube = name == "LokTube";
    source = Read("Source", "");
    directory = Read("Directory", preview ? "C:\\Users\\You\\AppData\\Local\\Programs\\" + name : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", name));
    destination = directory; scope = Read("Scope", "current");
    executable = Read("Executable", name + ".exe");
    uninstall = Read("Mode", "install") == "uninstall";
    existing = Read("Existing", "0") == "1";
    using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Setup.xaml")) window = (Window)XamlReader.Load(stream);
    window.Title = name + " Setup";
    window.Width = Math.Min(840, SystemParameters.WorkArea.Width - 24);
    window.Height = Math.Min(570, SystemParameters.WorkArea.Height - 24);
    Text("WindowCaption", name + " / " + version);
    Text("Wordmark", tube ? "LokTube" : "lokal.");
    if (tube) {
      window.Resources["Accent"] = new SolidColorBrush(Color.FromRgb(156, 221, 255));
      window.Resources["Base"] = new SolidColorBrush(Color.FromRgb(3, 5, 9));
      window.Resources["Panel"] = new SolidColorBrush(Color.FromRgb(7, 20, 38));
      window.Resources["Card"] = new SolidColorBrush(Color.FromRgb(12, 24, 40));
      window.Resources["Edge"] = new SolidColorBrush(Color.FromRgb(40, 60, 82));
      window.Resources["Soft"] = new SolidColorBrush(Color.FromRgb(22, 44, 68));
      Visible("DiscSurface", false); Visible("DiscHole", false); Visible("VideoTile", true);
      Text("BrandLine", "YOUR VIDEOS. YOUR SPACE.");
      Text("BrandFooter", "Watch on your terms.\nMake yourself at home.");
      Visible("PlayMark", true);
    }
    Text("FolderPath", destination);
    Find<Button>("ChangeFolder").Click += delegate {
      using (var picker = new System.Windows.Forms.FolderBrowserDialog()) {
        picker.Description = "Choose a parent folder for " + name;
        picker.SelectedPath = Path.GetDirectoryName(destination);
        if (picker.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
        var selected = Path.GetFullPath(picker.SelectedPath);
        destination = String.Equals(Path.GetFileName(selected.TrimEnd('\\')), name, StringComparison.OrdinalIgnoreCase) ? selected : Path.Combine(selected, name);
        Text("FolderPath", destination);
      }
    };
    Find<Button>("Primary").Click += async delegate { await Primary(); };
    Find<Button>("Secondary").Click += delegate { if (!busy) window.Close(); };
    Find<Button>("CloseWindow").Click += delegate { if (!busy) window.Close(); };
    Find<Grid>("DragRegion").MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) { if (e.LeftButton == MouseButtonState.Pressed) window.DragMove(); };
    window.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { e.Cancel = busy; };
    window.PreviewKeyDown += delegate(object sender, KeyEventArgs e) { if (e.Key == Key.Escape && !busy) window.Close(); };
    Show("welcome", null);
    window.Loaded += delegate { Find<Button>("Primary").Focus(); };
  }
  void Show(string next, string error) {
    stage = next;
    Visible("FolderCard", next == "welcome" && !uninstall);
    Visible("ChangeFolder", !existing);
    Visible("ProgressArea", next == "installing");
    Visible("AccentHeading", next == "welcome");
    Find<Button>("Primary").Visibility = next == "installing" ? Visibility.Collapsed : Visibility.Visible;
    Find<Button>("Secondary").IsEnabled = !busy;
    Find<Button>("CloseWindow").IsEnabled = !busy;
    Find<Button>("Secondary").Content = next == "complete" || next == "error" ? "Close" : "Cancel";
    string verb = uninstall ? "Remove " : existing ? "Update " : "Install ";
    if (next == "welcome") {
      Text("Step", uninstall ? "01 / BEFORE YOU GO" : "01 / MAKE YOURSELF AT HOME");
      Text("Heading", uninstall ? "Until next time." : existing ? "A fresh start for" : "A new home for");
      Text("AccentHeading", tube ? "your videos." : "your music.");
      Text("Description", uninstall ? "This removes the application. Your media files, accounts and saved library data are kept." : existing ? "We'll replace the app and keep your library, accounts and settings in place." : "Install " + name + (tube ? " and settle into your own space for YouTube." : ", bring your collection, and make it yours."));
      Text("Footnote", uninstall ? "Your files and library stay yours." : scope == "all" ? "For everyone on this PC. Windows may request administrator approval." : "For this Windows account. No restart required.");
      Find<Button>("Primary").Content = verb + name;
    } else if (next == "installing") {
      Text("Step", "02 / " + (uninstall ? "REMOVING APPLICATION" : "GETTING THINGS READY"));
      Text("Heading", uninstall ? "Making room." : "Making it yours.");
      Text("Description", uninstall ? "Removing " + name + " from this PC. Your personal library is staying right where it is." : "We're setting up " + name + ". This usually takes a moment.");
      Text("ProgressLabel", uninstall ? "Removing application files and shortcuts…" : "Copying application files and setting up shortcuts…");
      Text("Footnote", "Please keep setup open until this step finishes.");
      var transform = Find<System.Windows.Shapes.Rectangle>("ProgressLight").RenderTransform as TranslateTransform;
      if (SystemParameters.ClientAreaAnimation) transform.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(-130, 430, TimeSpan.FromSeconds(1.6)) { RepeatBehavior = RepeatBehavior.Forever });
      else transform.X = 120;
    } else if (next == "complete") {
      Text("Step", "03 / ALL SET");
      Text("Heading", uninstall ? "See you around." : tube ? "Ready when you are." : "You're ready to listen.");
      Text("Description", uninstall ? name + " has been removed. Your media and saved library data have been kept." : name + " is installed. " + (tube ? "Open the app and find something worth watching." : "Open the player, add your music folders, and make yourself at home."));
      Text("Footnote", uninstall ? "Thanks for spending time with " + name + "." : "Installed successfully. No Windows restart needed.");
      Find<Button>("Primary").Content = uninstall ? "Done" : "Open " + name;
    } else {
      Text("Step", "SETUP NEEDS YOUR ATTENTION");
      Text("Heading", "Let's try that again.");
      Text("Description", error ?? "Setup couldn't finish. Close the app if it is running, then retry.");
      Text("Footnote", "Your personal files have not been removed.");
      Find<Button>("Primary").Content = "Retry";
    }
  }
  async Task Primary() {
    if (busy) return;
    if (stage == "complete") {
      if (!uninstall && !preview) {
        try { Process.Start(new ProcessStartInfo(Path.Combine(destination, executable)) { UseShellExecute = true, WorkingDirectory = destination }); }
        catch (Exception e) { Show("error", "The app is installed but couldn't open: " + e.Message); return; }
      }
      window.Close(); return;
    }
    busy = true; Show("installing", null);
    try {
      if (preview) { await Task.Delay(2200); }
      else {
        // Only the launcher's parent must exit; wait off the UI thread to release
        // NSIS's single-installer mutex before starting the silent engine.
        int parent;
        if (Int32.TryParse(Read("Parent", "0"), out parent) && parent > 0) {
          await Task.Run(delegate { try { using (var p = Process.GetProcessById(parent)) { if (!p.WaitForExit(30000)) throw new InvalidOperationException("The previous setup process is still running."); } } catch (ArgumentException) { } });
        }
        if (destination.IndexOfAny(new char[] { '"', '\r', '\n' }) >= 0 || !Path.IsPathRooted(destination) || Path.GetPathRoot(destination) == destination) throw new InvalidOperationException("Choose a dedicated application folder.");
        if (!File.Exists(source)) throw new FileNotFoundException("The installer file was moved. Download and run setup again.");
        foreach (var running in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable))) {
          using (running) { if (!running.HasExited) throw new InvalidOperationException("Please close " + name + " before continuing, then choose Retry."); }
        }
        string flags = "/S " + (scope == "all" ? "/allusers " : "/currentuser ");
        if (existing && !uninstall) flags += "--updated ";
        // NSIS's /D and _? arguments must be last and unquoted, including spaces.
        string arguments = flags + (uninstall ? "_?=" : "/D=") + destination;
        int result = await Task.Run(delegate {
          using (var p = Process.Start(new ProcessStartInfo(source, arguments) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(source) })) {
            p.WaitForExit(); return p.ExitCode;
          }
        });
        if (result != 0) throw new InvalidOperationException("Setup stopped (code " + result + "). Close " + name + " if it is running, then retry. If Windows requested administrator access, allow it to continue.");
        if (!uninstall && !File.Exists(Path.Combine(destination, executable))) throw new InvalidOperationException("Setup ended before the application was installed. Please retry.");
        if (uninstall && File.Exists(Path.Combine(destination, executable))) throw new InvalidOperationException("The app is still present. Close it and retry removal.");
      }
      busy = false; Show("complete", null); Find<Button>("Primary").Focus();
    } catch (Exception e) { busy = false; Show("error", e.Message); }
  }
  void Snapshots(string output) {
    Directory.CreateDirectory(output);
    window.ShowInTaskbar = false; window.WindowStartupLocation = WindowStartupLocation.Manual; window.Left = -20000;
    window.Loaded += delegate {
      window.Dispatcher.BeginInvoke(new Action(delegate {
        foreach (var screen in new string[] { "welcome", "installing", "complete", "error" }) {
          busy = screen == "installing";
          Show(screen, "Setup couldn't finish. Close the app if it is running, then retry.");
          if (screen == "installing") {
            var transform = Find<System.Windows.Shapes.Rectangle>("ProgressLight").RenderTransform as TranslateTransform;
            transform.BeginAnimation(TranslateTransform.XProperty, null); transform.X = 100;
          }
          Capture(Path.Combine(output, name + "-" + screen + ".png"));
        }
        busy = false; window.Close();
      }), System.Windows.Threading.DispatcherPriority.ApplicationIdle);
    };
  }
  void Capture(string fileName) {
    window.UpdateLayout();
    var bitmap = new RenderTargetBitmap(1680, 1140, 192, 192, PixelFormats.Pbgra32);
    bitmap.Render(window.Content as Visual);
    var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
    using (var file = File.Create(fileName)) encoder.Save(file);
  }
  void Exercise(string output) {
    if (preview || name != "LokalInstallerSmoke" || Read("TestFixture", "") != "1") throw new InvalidOperationException("Exercise mode requires an isolated packaging fixture.");
    Directory.CreateDirectory(output);
    window.ShowInTaskbar = false; window.WindowStartupLocation = WindowStartupLocation.Manual; window.Left = -20000;
    window.Loaded += async delegate {
      await Primary();
      Capture(Path.Combine(output, "engine-" + (uninstall ? "uninstall" : existing ? "update" : "install") + ".png"));
      Application.Current.Shutdown(stage == "complete" ? 0 : 1);
    };
  }
  [STAThread] public static int Main(string[] args) {
    try {
      var app = new Application(); var ui = new SetupUI(args);
      if (ui.preview) for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--snapshots") ui.Snapshots(args[i + 1]);
      for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--exercise") ui.Exercise(args[i + 1]);
      return app.Run(ui.window);
    } catch (Exception e) { MessageBox.Show(e.Message, "Setup couldn't start", MessageBoxButton.OK, MessageBoxImage.Error); return 1; }
  }
}
