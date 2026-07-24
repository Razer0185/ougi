using System;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace OugiUnlock
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new UnlockForm());
        }
    }

    public class UnlockForm : Form
    {
        readonly TextBox _email = new TextBox();
        readonly TextBox _password = new TextBox { UseSystemPasswordChar = true };
        readonly TextBox _apiBase = new TextBox { Text = "https://ougi-production.up.railway.app" };
        readonly Button _btn = new Button { Text = "Unlock & Extract", Height = 36 };
        readonly Label _status = new Label { AutoSize = false, Height = 48, Text = "Sign in with your Ougi account (active PC Host plan required)." };

        public UnlockForm()
        {
            Text = "Ougi Unlock";
            Width = 480;
            Height = 360;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(14, 16, 20);
            ForeColor = Color.WhiteSmoke;
            Font = new Font("Segoe UI", 10f);

            var tip = new Label
            {
                Text = "This folder only has encrypted files. Unlock downloads nothing — it decrypts Ougi.sealed beside this app.",
                Left = 20,
                Top = 16,
                Width = 420,
                Height = 40,
            };

            AddField("Website", _apiBase, 60);
            AddField("Email", _email, 110);
            AddField("Password", _password, 160);

            _btn.Left = 20;
            _btn.Top = 220;
            _btn.Width = 420;
            _btn.FlatStyle = FlatStyle.Flat;
            _btn.BackColor = Color.FromArgb(60, 140, 220);
            _btn.ForeColor = Color.White;
            _btn.Click += async (_, __) => await UnlockAsync();

            _status.Left = 20;
            _status.Top = 270;
            _status.Width = 420;
            _status.ForeColor = Color.Silver;

            Controls.Add(tip);
            Controls.Add(_btn);
            Controls.Add(_status);
        }

        void AddField(string label, TextBox box, int top)
        {
            var l = new Label { Text = label, Left = 20, Top = top, Width = 420, ForeColor = Color.Gray };
            box.Left = 20;
            box.Top = top + 22;
            box.Width = 420;
            box.BackColor = Color.FromArgb(28, 32, 40);
            box.ForeColor = Color.White;
            box.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(l);
            Controls.Add(box);
        }

        async Task UnlockAsync()
        {
            _btn.Enabled = false;
            _status.ForeColor = Color.Silver;
            _status.Text = "Checking license + package key…";
            try
            {
                var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
                var sealedPath = Path.Combine(exeDir, "Ougi.sealed");
                if (!File.Exists(sealedPath))
                    throw new Exception("Ougi.sealed not found next to OugiUnlock.exe");

                var version = ReadSealedVersion(File.ReadAllBytes(sealedPath));
                var baseUrl = _apiBase.Text.Trim().TrimEnd('/');
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };

                var payload = JsonSerializer.Serialize(new
                {
                    email = _email.Text.Trim(),
                    password = _password.Text,
                    version,
                });
                using var content = new StringContent(payload, Encoding.UTF8, "application/json");
                var res = await http.PostAsync(baseUrl + "/api/license/pc-unlock-package", content);
                var raw = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "{}" : raw);
                var root = doc.RootElement;
                if (!res.IsSuccessStatusCode || !root.TryGetProperty("ok", out var okEl) || !okEl.GetBoolean())
                {
                    string? msg = null;
                    if (root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String)
                        msg = m.GetString();
                    if (string.IsNullOrWhiteSpace(msg))
                        msg = "Unlock failed (" + (int)res.StatusCode + ")";
                    throw new Exception(msg);
                }

                var keyB64 = root.GetProperty("key").GetString()
                    ?? throw new Exception("Server returned no key");
                var key = Convert.FromBase64String(keyB64);
                if (key.Length != 32) throw new Exception("Invalid package key length");

                _status.Text = "Decrypting sealed package…";
                var zipBytes = DecryptSealed(File.ReadAllBytes(sealedPath), key);
                var tmp = Path.Combine(Path.GetTempPath(), "ougi-unlock-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(tmp);
                var zipPath = Path.Combine(tmp, "payload.zip");
                File.WriteAllBytes(zipPath, zipBytes);
                ZipFile.ExtractToDirectory(zipPath, exeDir, overwriteFiles: true);
                try { Directory.Delete(tmp, true); } catch { /* ignore */ }

                var host = Path.Combine(exeDir, "OugiHost.exe");
                if (!File.Exists(host))
                    throw new Exception("Decrypt OK but OugiHost.exe missing — corrupt package.");

                _status.ForeColor = Color.LightGreen;
                _status.Text = "Unlocked. Starting Ougi Host…";
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = host,
                    WorkingDirectory = exeDir,
                    UseShellExecute = true,
                });
                await Task.Delay(800);
                Close();
            }
            catch (Exception ex)
            {
                _status.ForeColor = Color.Salmon;
                _status.Text = ex.Message;
            }
            finally
            {
                _btn.Enabled = true;
            }
        }

        static string ReadSealedVersion(byte[] payload)
        {
            if (payload.Length < 6 || Encoding.ASCII.GetString(payload, 0, 4) != "OGB1")
                throw new Exception("Invalid Ougi.sealed file");
            var verLen = (payload[4] << 8) | payload[5];
            if (verLen < 1 || 6 + verLen > payload.Length) return "unknown";
            return Encoding.UTF8.GetString(payload, 6, verLen);
        }

        static byte[] DecryptSealed(byte[] payload, byte[] key)
        {
            if (payload.Length < 6 + 12 + 16)
                throw new Exception("Ougi.sealed is truncated");
            if (Encoding.ASCII.GetString(payload, 0, 4) != "OGB1")
                throw new Exception("Invalid Ougi.sealed magic");

            var verLen = (payload[4] << 8) | payload[5];
            var offset = 6 + verLen;
            if (offset + 12 + 16 > payload.Length)
                throw new Exception("Corrupt sealed header");

            var iv = new byte[12];
            Buffer.BlockCopy(payload, offset, iv, 0, 12);
            offset += 12;
            var tag = new byte[16];
            Buffer.BlockCopy(payload, offset, tag, 0, 16);
            offset += 16;
            var cipherLen = payload.Length - offset;
            var cipher = new byte[cipherLen];
            Buffer.BlockCopy(payload, offset, cipher, 0, cipherLen);

            var plain = new byte[cipherLen];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(iv, cipher, tag, plain);
            return plain;
        }
    }
}
