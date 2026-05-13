using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Windows.Forms;

const string BaseUrl = "http://127.0.0.1:3001";
const int StartTimeoutMs = 30000;
const int RetryDelayMs = 1000;

Application.SetHighDpiMode(HighDpiMode.SystemAware);
Application.EnableVisualStyles();
Application.SetCompatibleTextRenderingDefault(false);

try
{
    var projectRoot = FindProjectRoot(AppContext.BaseDirectory);
    if (projectRoot is null)
    {
        ShowError("Could not find the Toxy project folder next to this launcher.");
        return;
    }

    if (await IsServerReadyAsync())
    {
        OpenBrowser();
        return;
    }

    var logsPath = Path.Combine(projectRoot, ".launcher-server.log");
    var buildExists = File.Exists(Path.Combine(projectRoot, ".next", "BUILD_ID"));
    var scripts = buildExists ? new[] { "start", "dev" } : new[] { "dev" };

    foreach (var script in scripts)
    {
        using var process = StartServerProcess(projectRoot, logsPath, script);
        var started = await WaitForServerAsync(StartTimeoutMs);
        if (started)
        {
            OpenBrowser();
            return;
        }

        TryStop(process);
    }

    ShowError("Toxy could not be started automatically. Check .launcher-server.log in the project folder.");
}
catch (Exception ex)
{
    ShowError($"Toxy launcher failed: {ex.Message}");
}

static string? FindProjectRoot(string startDirectory)
{
    var current = new DirectoryInfo(startDirectory);
    while (current is not null)
    {
        var packageJson = Path.Combine(current.FullName, "package.json");
        var appDirectory = Path.Combine(current.FullName, "app");
        if (File.Exists(packageJson) && Directory.Exists(appDirectory))
        {
            return current.FullName;
        }

        current = current.Parent;
    }

    return null;
}

static Process StartServerProcess(string projectRoot, string logsPath, string script)
{
    var powershellPath = ResolveExecutable(
        "powershell.exe",
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe")
    );
    var npmPath = ResolveExecutable(
        "npm.cmd",
        @"C:\Program Files\nodejs\npm.cmd",
        @"E:\PYTHON\npm.cmd"
    );
    File.AppendAllText(
        logsPath,
        $"[{DateTime.Now:O}] Starting script '{script}' with npm at '{npmPath}'.{Environment.NewLine}",
        Encoding.UTF8
    );
    var escapedProjectRoot = EscapePowerShellLiteral(projectRoot);
    var escapedNpmPath = EscapePowerShellLiteral(npmPath);
    var escapedLogsPath = EscapePowerShellLiteral(logsPath);
    var command =
        $"Set-Location -LiteralPath '{escapedProjectRoot}'; & '{escapedNpmPath}' run {script} >> '{escapedLogsPath}' 2>&1";
    var startInfo = new ProcessStartInfo
    {
        FileName = powershellPath,
        Arguments = $"-NoLogo -NoProfile -ExecutionPolicy Bypass -Command \"{command}\"",
        WorkingDirectory = projectRoot,
        UseShellExecute = false,
        CreateNoWindow = true,
        WindowStyle = ProcessWindowStyle.Hidden
    };

    return Process.Start(startInfo) ?? throw new InvalidOperationException("Could not start the local Toxy server process.");
}

static string EscapePowerShellLiteral(string value)
{
    return value.Replace("'", "''");
}

static string ResolveExecutable(string fileName, params string[] fallbacks)
{
    var paths = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
        .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    foreach (var directory in paths)
    {
        try
        {
            var candidate = Path.Combine(directory, fileName);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }
        catch
        {
        }
    }

    foreach (var fallback in fallbacks)
    {
        if (File.Exists(fallback))
        {
            return fallback;
        }
    }

    throw new FileNotFoundException($"Could not resolve required executable: {fileName}");
}

static async Task<bool> WaitForServerAsync(int timeoutMs)
{
    var attempts = Math.Max(1, timeoutMs / RetryDelayMs);
    for (var attempt = 0; attempt < attempts; attempt += 1)
    {
        if (await IsServerReadyAsync())
        {
            return true;
        }

        await Task.Delay(RetryDelayMs);
    }

    return false;
}

static async Task<bool> IsServerReadyAsync()
{
    try
    {
        using var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(2)
        };
        using var response = await client.GetAsync(BaseUrl);
        return response.IsSuccessStatusCode;
    }
    catch
    {
        return false;
    }
}

static void OpenBrowser()
{
    Process.Start(new ProcessStartInfo
    {
        FileName = BaseUrl,
        UseShellExecute = true
    });
}

static void TryStop(Process process)
{
    try
    {
        if (!process.HasExited)
        {
            process.Kill(true);
        }
    }
    catch
    {
    }
}

static void ShowError(string message)
{
    MessageBox.Show(message, "Toxy Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
}
