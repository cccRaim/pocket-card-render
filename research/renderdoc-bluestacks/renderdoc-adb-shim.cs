using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

internal static class Program
{
    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && value.All(c => !char.IsWhiteSpace(c) && c != '"'))
            return value;

        var output = new StringBuilder("\"");
        var backslashes = 0;

        foreach (var c in value)
        {
            if (c == '\\')
            {
                backslashes++;
                continue;
            }

            if (c == '"')
            {
                output.Append('\\', backslashes * 2 + 1);
                output.Append(c);
                backslashes = 0;
                continue;
            }

            output.Append('\\', backslashes);
            output.Append(c);
            backslashes = 0;
        }

        output.Append('\\', backslashes * 2);
        output.Append('"');
        return output.ToString();
    }

    public static int Main(string[] args)
    {
        // BlueStacks exposes root through su, while its `adb root` request never returns.
        // RenderDoc probes `adb root` before independently checking su, so only bypass that probe.
        if (args.Length > 0 && args[args.Length - 1] == "root")
        {
            Console.WriteLine("adbd cannot run as root; continuing with su root");
            return 0;
        }

        // Optional experiment for ARM translation layers: make RenderDoc select the target's
        // arm64 loader instead of the emulator host's x86_64 loader. All other getprop calls pass
        // through unchanged, and the mode is opt-in per qrenderdoc process.
        if (Environment.GetEnvironmentVariable("PCR_RENDERDOC_FORCE_GUEST_ABI") == "1" &&
            args.Length >= 3 &&
            args[args.Length - 3] == "shell" &&
            args[args.Length - 2] == "getprop" &&
            args[args.Length - 1] == "ro.dalvik.vm.native.bridge")
        {
            Console.WriteLine();
            return 0;
        }

        var realAdb = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "adb-real.exe");
        if (!File.Exists(realAdb))
        {
            Console.Error.WriteLine("Missing RenderDoc ADB delegate: " + realAdb);
            return 127;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = realAdb,
            Arguments = string.Join(" ", args.Select(QuoteArgument)),
            UseShellExecute = false,
        };

        using (var process = Process.Start(startInfo))
        {
            process.WaitForExit();
            return process.ExitCode;
        }
    }
}
