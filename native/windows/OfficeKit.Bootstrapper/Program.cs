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
            var result = new
            {
                ok = true,
                probeOnly = true,
                systemDirectory,
                packageIdentityStatus = package.Status,
                packageFullName = package.FullName,
                packageFamilyName = package.FamilyName,
                environmentAuthorityUsed = false,
                processId = Environment.ProcessId
            };

            if (package.Status == "packaged")
                WritePackageActivationMarker(result, package.FamilyName!);

            Console.WriteLine(JsonSerializer.Serialize(result));
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

    private static PackageIdentity GetCurrentPackageIdentity()
    {
        uint fullNameLength = 0;
        var fullNameStatus = GetCurrentPackageFullName(ref fullNameLength, null);
        if (fullNameStatus == AppModelErrorNoPackage)
            return new PackageIdentity("not_packaged", null, null);
        if (fullNameStatus != ErrorInsufficientBuffer || fullNameLength == 0)
            throw new InvalidOperationException($"package_identity_query_failed:{fullNameStatus}");

        var fullNameBuffer = new StringBuilder(checked((int)fullNameLength));
        var fullNameResult = GetCurrentPackageFullName(ref fullNameLength, fullNameBuffer);
        if (fullNameResult != 0)
            throw new InvalidOperationException($"package_identity_read_failed:{fullNameResult}");

        uint familyNameLength = 0;
        var familyNameStatus = GetCurrentPackageFamilyName(ref familyNameLength, null);
        if (familyNameStatus != ErrorInsufficientBuffer || familyNameLength == 0)
            throw new InvalidOperationException($"package_family_query_failed:{familyNameStatus}");

        var familyNameBuffer = new StringBuilder(checked((int)familyNameLength));
        var familyNameResult = GetCurrentPackageFamilyName(ref familyNameLength, familyNameBuffer);
        if (familyNameResult != 0)
            throw new InvalidOperationException($"package_family_read_failed:{familyNameResult}");

        var familyName = familyNameBuffer.ToString();
        if (string.IsNullOrWhiteSpace(familyName) || Path.GetFileName(familyName) != familyName)
            throw new InvalidOperationException("package_family_name_invalid");

        return new PackageIdentity("packaged", fullNameBuffer.ToString(), familyName);
    }

    private static void WritePackageActivationMarker(object result, string packageFamilyName)
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
            throw new InvalidOperationException("package_local_app_data_unavailable");

        var localState = Path.Combine(localAppData, "Packages", packageFamilyName, "LocalState");
        Directory.CreateDirectory(localState);

        var markerName = $"bootstrap-probe-{Environment.ProcessId}-{DateTime.UtcNow.Ticks}.json";
        var markerPath = Path.Combine(localState, markerName);
        using var stream = new FileStream(markerPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        JsonSerializer.Serialize(stream, result);
        stream.Flush(true);
    }

    private sealed record PackageIdentity(string Status, string? FullName, string? FamilyName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetSystemDirectoryW(StringBuilder lpBuffer, uint uSize);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetCurrentPackageFullName(ref uint packageFullNameLength, StringBuilder? packageFullName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetCurrentPackageFamilyName(ref uint packageFamilyNameLength, StringBuilder? packageFamilyName);
}
