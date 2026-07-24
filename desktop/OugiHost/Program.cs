using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OugiHostApp
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.Run(new MainForm());
        }
    }

    public class MainForm : Form
    {
        const string ApiBase = "http://127.0.0.1:5050";
        const string AppUrl = ApiBase + "/host-app.html";
        const int WM_NCLBUTTONDOWN = 0xA1;
        const int WM_NCHITTEST = 0x84;
        const int HTCLIENT = 1;
        const int HTCAPTION = 0x2;
        const int HTLEFT = 10;
        const int HTRIGHT = 11;
        const int HTTOP = 12;
        const int HTTOPLEFT = 13;
        const int HTTOPRIGHT = 14;
        const int HTBOTTOM = 15;
        const int HTBOTTOMLEFT = 16;
        const int HTBOTTOMRIGHT = 17;
        const int ResizeBorder = 6;

        [DllImport("user32.dll")]
        static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

        readonly WebView2 _web = new WebView2();
        readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
        string _root = "";
        string _nodeExe = "node";
        string _dataHome = "";
        Process? _agent;
        Process? _siteProc;

        public MainForm()
        {
            Text = "Ougi Host";
            Width = 900;
            Height = 760;
            MinimumSize = new Size(780, 680);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(7, 7, 7);
            // Frameless — close / minimize / drag live in the HTML chrome
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = true;
            DoubleBuffered = true;

            _web.Dock = DockStyle.Fill;
            Controls.Add(_web);

            _dataHome = ResolveDataHome();
            Directory.CreateDirectory(Path.Combine(_dataHome, "data"));

            // Dev fallback until BootAsync unpacks sealed payload
            _root = FindRuntimeRoot();
            _nodeExe = RuntimeSeal.FindNode(_dataHome, _root);

            Shown += async (_, __) => await BootAsync();
            FormClosing += (_, __) => ShutdownChildren();
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
            {
                base.WndProc(ref m);
                if (m.Result == (IntPtr)HTCLIENT)
                {
                    var screen = PointToScreen(Point.Empty);
                    var x = (int)((long)m.LParam & 0xFFFF) - screen.X;
                    var yRaw = (int)(((long)m.LParam >> 16) & 0xFFFF);
                    if (yRaw > 32767) yRaw -= 65536;
                    var y = yRaw - screen.Y;

                    var left = x < ResizeBorder;
                    var right = x >= ClientSize.Width - ResizeBorder;
                    var top = y < ResizeBorder;
                    var bottom = y >= ClientSize.Height - ResizeBorder;

                    if (top && left) m.Result = (IntPtr)HTTOPLEFT;
                    else if (top && right) m.Result = (IntPtr)HTTOPRIGHT;
                    else if (bottom && left) m.Result = (IntPtr)HTBOTTOMLEFT;
                    else if (bottom && right) m.Result = (IntPtr)HTBOTTOMRIGHT;
                    else if (left) m.Result = (IntPtr)HTLEFT;
                    else if (right) m.Result = (IntPtr)HTRIGHT;
                    else if (top) m.Result = (IntPtr)HTTOP;
                    else if (bottom) m.Result = (IntPtr)HTBOTTOM;
                }
                return;
            }
            base.WndProc(ref m);
        }

        void BeginWindowDrag()
        {
            try
            {
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
            }
            catch { /* ignore */ }
        }

        void ToggleMaximize()
        {
            WindowState = WindowState == FormWindowState.Maximized
                ? FormWindowState.Normal
                : FormWindowState.Maximized;
            PostWindowState();
        }

        void PostWindowState()
        {
            PostToUi(new
            {
                type = "window",
                maximized = WindowState == FormWindowState.Maximized,
            });
        }

        void ShutdownChildren()
        {
            try { _agent?.Kill(entireProcessTree: true); } catch { /* ignore */ }
            try { _siteProc?.Kill(entireProcessTree: true); } catch { /* ignore */ }
            _agent = null;
            _siteProc = null;
        }

        async Task BootAsync()
        {
            try
            {
                // Buyer builds: unpack encrypted blob into AppData (no source in the download)
                if (RuntimeSeal.HasPayload())
                {
                    _root = await Task.Run(() => RuntimeSeal.EnsureExtracted(_dataHome));
                    _nodeExe = RuntimeSeal.FindNode(_dataHome, _root);
                }
                else if (string.IsNullOrEmpty(_root))
                {
                    _root = FindRuntimeRoot();
                    _nodeExe = RuntimeSeal.FindNode(_dataHome, _root);
                }

                if (string.IsNullOrEmpty(_root))
                {
                    throw new Exception(
                        "Runtime not found.\n\n" +
                        "Use a sealed Host build (npm run host-app:pack),\n" +
                        "or keep this exe in the Ougi repo for development.");
                }

                if (!File.Exists(_nodeExe) && _nodeExe == "node")
                {
                    try
                    {
                        var check = Process.Start(new ProcessStartInfo
                        {
                            FileName = "node",
                            Arguments = "-v",
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            RedirectStandardOutput = true,
                        });
                        check?.WaitForExit(4000);
                        if (check == null || check.ExitCode != 0)
                            throw new Exception("node missing");
                    }
                    catch
                    {
                        throw new Exception(
                            "Node.js was not found.\n\n" +
                            "Sealed Host builds include Node automatically.\n" +
                            "For development, install Node 20+ or run host-app:pack.");
                    }
                }

                await EnsureSiteAsync();
                var userData = Path.Combine(_dataHome, "webview");
                Directory.CreateDirectory(userData);
                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                await _web.EnsureCoreWebView2Async(env);
                _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                _web.CoreWebView2.WebMessageReceived += OnWebMessage;
                _web.CoreWebView2.Navigate(AppUrl);
            }
            catch (Exception ex)
            {
                var hint =
                    "1) Keep WebView2Loader.dll next to OugiHost.exe if prompted\n" +
                    "2) Install Evergreen WebView2 Runtime if Windows asks\n" +
                    "3) For buyers: use the sealed build from npm run host-app:pack";
                MessageBox.Show(
                    "Could not start Ougi Host UI.\n\n" + hint + "\n\n" + ex.Message,
                    "Ougi Host",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        void PostToUi(object payload)
        {
            if (_web.CoreWebView2 == null) return;
            _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
        }

        void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw;
            try { raw = e.TryGetWebMessageAsString(); }
            catch { raw = e.WebMessageAsJson; }

            JsonDocument doc;
            try { doc = JsonDocument.Parse(raw); }
            catch { return; }

            using (doc)
            {
                var root = doc.RootElement;
                var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                if (type == "ready")
                {
                    PostToUi(new { type = "site", text = "Website online · " + ApiBase });
                    PostWindowState();
                    return;
                }
                if (type == "window")
                {
                    var action = root.TryGetProperty("action", out var a) ? a.GetString() : null;
                    if (action == "close")
                    {
                        BeginInvoke(new Action(Close));
                        return;
                    }
                    if (action == "minimize")
                    {
                        BeginInvoke(new Action(() => WindowState = FormWindowState.Minimized));
                        return;
                    }
                    if (action == "maximize")
                    {
                        BeginInvoke(new Action(ToggleMaximize));
                        return;
                    }
                    if (action == "drag")
                    {
                        BeginInvoke(new Action(BeginWindowDrag));
                        return;
                    }
                    return;
                }
                if (type == "stop")
                {
                    StopAgent();
                    PostToUi(new { type = "bot", running = false });
                    PostToUi(new { type = "log", text = "PC bot stopped." });
                    return;
                }
                if (type == "start")
                {
                    var discord = root.TryGetProperty("discordToken", out var d) ? d.GetString() : null;
                    var license = root.TryGetProperty("licenseToken", out var l) ? l.GetString() : null;
                    _ = StartAgentAsync(discord, license);
                }
            }
        }

        async Task StartAgentAsync(string? botToken, string? license)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(botToken) || botToken.Length < 50)
                    throw new Exception("Missing Discord bot token.");
                if (string.IsNullOrWhiteSpace(license))
                    throw new Exception("Missing license ticket.");
                if (_root.Length == 0)
                    throw new Exception("Runtime folder missing. Rebuild with npm run host-app:pack.");

                var entry = Path.Combine(_root, "agent", "pc-entry.js");
                if (!File.Exists(entry)) throw new Exception("Missing agent/pc-entry.js in runtime.");

                StopAgent();
                var psi = new ProcessStartInfo
                {
                    FileName = _nodeExe,
                    Arguments = "\"" + entry + "\"",
                    WorkingDirectory = _root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                psi.Environment["DISCORD_TOKEN"] = botToken;
                psi.Environment["OUGI_LICENSE_TOKEN"] = license;
                psi.Environment["OUGI_LICENSE_URL"] = ApiBase;
                psi.Environment["OUGI_PC_AGENT"] = "1";
                psi.Environment["OUGI_DATA_DIR"] = _dataHome;
                psi.Environment["OUGI_SITE_HOST"] = "127.0.0.1";
                psi.Environment["OUGI_SITE_ORIGIN"] = ApiBase;

                _agent = Process.Start(psi) ?? throw new Exception("Could not start agent");
                _agent.OutputDataReceived += (_, ev) =>
                {
                    if (ev.Data != null) PostToUi(new { type = "log", text = ev.Data });
                };
                _agent.ErrorDataReceived += (_, ev) =>
                {
                    if (ev.Data != null) PostToUi(new { type = "log", text = ev.Data });
                };
                _agent.Exited += (_, __) =>
                {
                    PostToUi(new { type = "bot", running = false });
                    PostToUi(new { type = "log", text = "PC bot exited." });
                };
                _agent.EnableRaisingEvents = true;
                _agent.BeginOutputReadLine();
                _agent.BeginErrorReadLine();

                PostToUi(new { type = "bot", running = true });
                PostToUi(new { type = "log", text = "PC bot starting…" });
            }
            catch (Exception ex)
            {
                PostToUi(new { type = "bot", running = false });
                PostToUi(new { type = "log", text = ex.Message });
            }
            await Task.CompletedTask;
        }

        void StopAgent()
        {
            try
            {
                if (_agent != null && !_agent.HasExited)
                    _agent.Kill(entireProcessTree: true);
            }
            catch { /* ignore */ }
            _agent = null;
        }

        /// <summary>
        /// Buyer data home: %LocalAppData%\Ougi (migrates legacy OugiPC once).
        /// </summary>
        static string ResolveDataHome()
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var home = Path.Combine(local, "Ougi");
            var legacy = Path.Combine(local, "OugiPC");
            try
            {
                if (Directory.Exists(legacy) && !Directory.Exists(home))
                    Directory.Move(legacy, home);
            }
            catch
            {
                /* keep going */
            }
            Directory.CreateDirectory(home);
            return home;
        }

        /// <summary>
        /// Prefer sealed AppData runtime; never treat buyer download (exe+.dat) as source.
        /// </summary>
        static string FindRuntimeRoot()
        {
            var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;

            // Buyer pack: only exe + OugiHost.dat — do not walk into a source tree by mistake
            if (File.Exists(Path.Combine(exeDir, "OugiHost.dat")))
                return "";

            var packaged = Path.Combine(exeDir, "runtime");
            if (LooksLikeRuntime(packaged)) return packaged;

            if (LooksLikeRuntime(exeDir)) return exeDir;

            var dir = exeDir;
            for (var i = 0; i < 12; i++)
            {
                if (LooksLikeRuntime(dir)) return dir;
                var parent = Directory.GetParent(dir);
                if (parent == null) break;
                dir = parent.FullName;
            }

            var cwd = Directory.GetCurrentDirectory();
            if (LooksLikeRuntime(Path.Combine(cwd, "runtime"))) return Path.Combine(cwd, "runtime");
            if (LooksLikeRuntime(cwd)) return cwd;
            return "";
        }

        static bool LooksLikeRuntime(string dir)
        {
            return File.Exists(Path.Combine(dir, "index.js"))
                && Directory.Exists(Path.Combine(dir, "agent"))
                && Directory.Exists(Path.Combine(dir, "website"))
                && Directory.Exists(Path.Combine(dir, "src"));
        }

        static string FindNodeExe(string runtimeRoot) => RuntimeSeal.FindNode(
            ResolveDataHome(),
            runtimeRoot);

        async Task EnsureSiteAsync()
        {
            try
            {
                if ((await _http.GetAsync(ApiBase + "/api/health")).IsSuccessStatusCode)
                    return;
            }
            catch { /* start */ }

            if (_root.Length == 0) return;

            var siteJs = Path.Combine(_root, "website", "server.js");
            if (!File.Exists(siteJs))
                throw new Exception("Missing website/server.js in runtime.");

            var psi = new ProcessStartInfo
            {
                FileName = _nodeExe,
                Arguments = "\"" + siteJs + "\"",
                WorkingDirectory = _root,
                CreateNoWindow = true,
                UseShellExecute = false,
            };
            psi.Environment["OUGI_DATA_DIR"] = _dataHome;
            psi.Environment["OUGI_SITE_HOST"] = "127.0.0.1";
            psi.Environment["OUGI_SITE_ORIGIN"] = ApiBase;
            psi.Environment["PORT"] = "5050";

            _siteProc = Process.Start(psi);

            for (var i = 0; i < 50; i++)
            {
                await Task.Delay(250);
                try
                {
                    if ((await _http.GetAsync(ApiBase + "/api/health")).IsSuccessStatusCode)
                        return;
                }
                catch { /* retry */ }
            }

            throw new Exception("Local site did not start on " + ApiBase);
        }
    }
}
