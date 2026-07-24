using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

namespace OugiHostApp
{
    /// <summary>
    /// Decrypts the sealed runtime blob (embedded or OugiHost.dat beside the exe)
    /// into %LocalAppData%\Ougi\app so buyers never receive readable bot source in the download.
    /// </summary>
    internal static class RuntimeSeal
    {
        /// <summary>Must match scripts/seal-runtime.js PASSPHRASE</summary>
        public const string Passphrase = "OugiHost.Runtime.Seal.v1";

        public static bool HasPayload()
        {
            var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? "";
            if (File.Exists(Path.Combine(exeDir, "OugiHost.dat"))) return true;
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Ougi.Runtime.dat");
            return stream != null && stream.Length > 32;
        }

        public static string EnsureExtracted(string dataHome)
        {
            var appDir = Path.Combine(dataHome, "app");
            var runtimeDir = Path.Combine(appDir, "runtime");
            var versionFile = Path.Combine(appDir, "VERSION");
            Directory.CreateDirectory(appDir);

            if (!TryLoadPayload(out var payload, out var sourceLabel))
            {
                return "";
            }

            var sealedVersion = ReadSealedVersion(payload);
            var installed = File.Exists(versionFile) ? File.ReadAllText(versionFile).Trim() : "";
            var ready =
                LooksLikeRuntime(runtimeDir)
                && File.Exists(Path.Combine(appDir, "node", "node.exe"))
                && string.Equals(installed, sealedVersion, StringComparison.Ordinal);

            if (ready)
            {
                HardenAppDir(appDir);
                return runtimeDir;
            }

            Cursor.Current = Cursors.WaitCursor;
            try
            {
                MessageBox.Show(
                    "Unpacking sealed Ougi runtime (one-time)…\n\n" +
                    "Your download folder only has OugiHost.exe + OugiHost.dat — no bot source.\n" +
                    "Private files go under %LocalAppData%\\Ougi (hidden).",
                    "Ougi Host",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);

                var tmpRoot = Path.Combine(dataHome, "app-tmp-" + Guid.NewGuid().ToString("N"));
                try
                {
                    Directory.CreateDirectory(tmpRoot);
                    var zipBytes = Decrypt(payload);
                    var zipPath = Path.Combine(tmpRoot, "runtime.zip");
                    File.WriteAllBytes(zipPath, zipBytes);
                    ZipFile.ExtractToDirectory(zipPath, tmpRoot, overwriteFiles: true);

                    var extractedRuntime = Path.Combine(tmpRoot, "runtime");
                    var extractedNode = Path.Combine(tmpRoot, "node");
                    if (!LooksLikeRuntime(extractedRuntime))
                        throw new Exception("Sealed package is missing runtime files.");
                    if (!File.Exists(Path.Combine(extractedNode, "node.exe")))
                        throw new Exception("Sealed package is missing Node.");

                    var backup = appDir + ".old";
                    if (Directory.Exists(backup))
                    {
                        try { Directory.Delete(backup, true); } catch { /* ignore */ }
                    }
                    if (Directory.Exists(appDir))
                    {
                        try { Directory.Move(appDir, backup); }
                        catch
                        {
                            try { Directory.Delete(appDir, true); } catch { /* ignore */ }
                        }
                    }

                    Directory.CreateDirectory(appDir);
                    CopyDirectory(extractedRuntime, Path.Combine(appDir, "runtime"));
                    CopyDirectory(extractedNode, Path.Combine(appDir, "node"));
                    File.WriteAllText(Path.Combine(appDir, "VERSION"), sealedVersion, Encoding.UTF8);
                    File.WriteAllText(
                        Path.Combine(appDir, "NOTICE.txt"),
                        "Ougi proprietary runtime (" + sourceLabel + "). Not for redistribution. Not open source.\n",
                        Encoding.UTF8);
                    HardenAppDir(appDir);

                    try { if (Directory.Exists(backup)) Directory.Delete(backup, true); } catch { /* ignore */ }
                }
                finally
                {
                    try { if (Directory.Exists(tmpRoot)) Directory.Delete(tmpRoot, true); } catch { /* ignore */ }
                }
            }
            finally
            {
                Cursor.Current = Cursors.Default;
            }

            if (!LooksLikeRuntime(runtimeDir))
                throw new Exception("Failed to unpack sealed runtime.");
            return runtimeDir;
        }

        static void HardenAppDir(string appDir)
        {
            try
            {
                var di = new DirectoryInfo(appDir);
                di.Attributes |= FileAttributes.Hidden;
            }
            catch
            {
                /* best-effort */
            }
        }

        public static string FindNode(string dataHome, string runtimeRoot)
        {
            var sealedNode = Path.Combine(dataHome, "app", "node", "node.exe");
            if (File.Exists(sealedNode)) return sealedNode;

            var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
            string[] candidates =
            {
                Path.Combine(exeDir, "node", "node.exe"),
                Path.Combine(runtimeRoot, "node", "node.exe"),
                Path.Combine(runtimeRoot, "node.exe"),
            };
            foreach (var c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            return "node";
        }

        static bool LooksLikeRuntime(string dir) =>
            File.Exists(Path.Combine(dir, "index.js"))
            && Directory.Exists(Path.Combine(dir, "agent"))
            && Directory.Exists(Path.Combine(dir, "website"))
            && Directory.Exists(Path.Combine(dir, "src"));

        static bool TryLoadPayload(out byte[] payload, out string sourceLabel)
        {
            payload = Array.Empty<byte>();
            sourceLabel = "";

            var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? "";
            var sidecar = Path.Combine(exeDir, "OugiHost.dat");
            if (File.Exists(sidecar))
            {
                payload = File.ReadAllBytes(sidecar);
                sourceLabel = "OugiHost.dat";
                return payload.Length > 32;
            }

            var asm = Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("Ougi.Runtime.dat");
            if (stream == null) return false;
            using var ms = new MemoryStream();
            stream.CopyTo(ms);
            payload = ms.ToArray();
            sourceLabel = "embedded";
            return payload.Length > 32;
        }

        static string ReadSealedVersion(byte[] payload)
        {
            if (payload.Length < 6) return "unknown";
            if (Encoding.ASCII.GetString(payload, 0, 4) != "OGI1")
                throw new Exception("Invalid sealed runtime (bad magic).");
            var verLen = (payload[4] << 8) | payload[5];
            if (verLen < 1 || 6 + verLen > payload.Length) return "unknown";
            return Encoding.UTF8.GetString(payload, 6, verLen);
        }

        static byte[] Decrypt(byte[] payload)
        {
            if (payload.Length < 6 + 12 + 16)
                throw new Exception("Sealed runtime is truncated.");
            if (Encoding.ASCII.GetString(payload, 0, 4) != "OGI1")
                throw new Exception("Invalid sealed runtime (bad magic).");

            var verLen = (payload[4] << 8) | payload[5];
            var offset = 6 + verLen;
            if (offset + 12 + 16 > payload.Length)
                throw new Exception("Sealed runtime header is corrupt.");

            var iv = new byte[12];
            Buffer.BlockCopy(payload, offset, iv, 0, 12);
            offset += 12;
            var tag = new byte[16];
            Buffer.BlockCopy(payload, offset, tag, 0, 16);
            offset += 16;
            var cipherLen = payload.Length - offset;
            var cipher = new byte[cipherLen];
            Buffer.BlockCopy(payload, offset, cipher, 0, cipherLen);

            var key = SHA256.HashData(Encoding.UTF8.GetBytes(Passphrase));
            var plain = new byte[cipherLen];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(iv, cipher, tag, plain);
            return plain;
        }

        static void CopyDirectory(string src, string dest)
        {
            Directory.CreateDirectory(dest);
            foreach (var file in Directory.GetFiles(src))
            {
                File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), true);
            }
            foreach (var dir in Directory.GetDirectories(src))
            {
                CopyDirectory(dir, Path.Combine(dest, Path.GetFileName(dir)));
            }
        }
    }
}
