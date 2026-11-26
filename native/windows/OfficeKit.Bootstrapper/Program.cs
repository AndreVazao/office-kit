using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private const uint ErrorInsufficientBuffer = 122;
    private const uint AppModelErrorNoPackage = 15700;
    private const int InitialSystemDirectoryCapacity = 260;
    private const int MaximumSystemDirectoryCapacity = 32768;

    private static int Main(string[] args)
    {
        if (args.Length > 1 || (args.Length == 1 && !string.Equals(args[0], "--probe", StringComparison.Ordinal)))
        {
            Console.Error.WriteLine("usage: OfficeKit.Bootstrapper [--probe]");
            return 64;
        }

        try
        {
            var systemDirectory = GetSystemDirectoryFromWindows();
            var package = GetCurrentPackageIdentity();
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                ok = true,
                probeOnly = true,
                systemDirectory,
                packageIdentityStatus = package.Status,
                packageFullName = package.FullName,
                environmentAuthorityUsed = false
            }));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new
            {
                ok = false,
                error = error.GetType().Name,
                code = error.Message
            }));
            return 1;
        }
    }

    private static string GetSystemDirectoryFromWindows()
    {
        var capacity = InitialSystemDirectoryCapacity;
        while (capacity <= MaximumSystemDirectoryCapacity)
        {
            var buffer = new StringBuilder(capacity);
            var length = GetSystemDirectoryW(buffer, (uint)buffer.Capacity);
            if (length == 0)
                throw new InvalidOperationException($"get_system_directory_failed:{Marshal.GetLastWin32Error()}");

            if (length < buffer.Capacity)
            {
                var value = buffer.ToString();
                if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
                    throw new InvalidOperationException("system_directory_not_absolute");
                return Path.TrimEndingDirectorySeparator(value);
            }

            capacity = checked((int)length + 1);
        }

        throw new InvalidOperationException("system_directory_path_too_long");
    }

    private static (string Status, string? FullName) GetCurrentPackageIdentity()
    {
        uint length = 0;
        var first = GetCurrentPackageFullName(ref length, null);
        if (first == AppModelErrorNoPackage)
            return ("not_packaged", null);
        if (first != ErrorInsufficientBuffer || length == 0)
            throw new InvalidOperationException($"package_identity_query_failed:{first}");

        var buffer = new StringBuilder(checked((int)length));
        var result = GetCurrentPackageFullName(ref length, buffer);
        if (result != 0)
            throw new InvalidOperationException($"package_identity_read_failed:{result}");

        return ("packaged", buffer.ToString());
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetSystemDirectoryW(StringBuilder lpBuffer, uint uSize);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetCurrentPackageFullName(ref uint packageFullNameLength, StringBuilder? packageFullName);
}
