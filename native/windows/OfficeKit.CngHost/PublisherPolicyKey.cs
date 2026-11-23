using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Text.Json.Serialization;

internal sealed record PublisherPolicyKeyInfo(
    [property: JsonPropertyName("keyName")] string KeyName,
    [property: JsonPropertyName("publicKeySpki")] string PublicKeySpki,
    [property: JsonPropertyName("securityDescriptorSddl")] string SecurityDescriptorSddl,
    [property: JsonPropertyName("keySize")] int KeySize,
    [property: JsonPropertyName("machineScope")] bool MachineScope,
    [property: JsonPropertyName("privateKeyExportable")] bool PrivateKeyExportable
);

internal static class PublisherPolicyKey
{
    private const string ProviderName = "Microsoft Software Key Storage Provider";
    private const string KeyAlgorithm = "RSA";
    private const int MachineKeyFlag = 0x20;
    private const int AllowSigningFlag = 0x00000002;
    private const int SecurityInformation = 0x00000001 | 0x00000002 | 0x00000004;
    private const string SecurityDescriptorProperty = "Security Descr";
    private const string LengthProperty = "Length";
    private const string KeyUsageProperty = "Key Usage";
    private const string ExportPolicyProperty = "Export Policy";
    private const string KeyNamePrefix = "okp-";

    internal const string ExpectedSecurityDescriptorSddl =
        "O:SYG:SYD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GR;;;BU)";

    private static readonly CngProvider Provider = new(ProviderName);

    public static PublisherPolicyKeyInfo Provision(string installationId)
    {
        EnsureElevatedInstallerContext();
        var keyName = KeyName(installationId);
        if (CngKey.Exists(keyName, Provider, CngKeyOpenOptions.MachineKey))
            throw new InvalidOperationException("publisher_policy_key_already_exists");

        CreateMachineKeyWithProtectedAcl(keyName);
        try
        {
            return ReadInfo(installationId);
        }
        catch
        {
            DeleteKeyIfPresent(keyName);
            throw;
        }
    }

    public static PublisherPolicyKeyInfo ReadPublicKey(string installationId)
    {
        var info = ReadInfo(installationId);
        return info;
    }

    public static byte[] SignPayload(string installationId, byte[] payload)
    {
        EnsureElevatedInstallerContext();
        if (payload.Length is < 1 or > 65536)
            throw new ArgumentException("publisher_policy_payload_size_invalid");

        var info = ReadInfo(installationId);
        using var key = CngKey.Open(info.KeyName, Provider, CngKeyOpenOptions.MachineKey);
        using var rsa = new RSACng(key);
        return rsa.SignData(payload, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    }

    public static object Sign(string installationId, byte[] payload)
    {
        var signature = SignPayload(installationId, payload);
        return new
        {
            ok = true,
            algorithm = "RSA-3072-SHA256-PKCS1",
            signature = Convert.ToBase64String(signature)
        };
    }

    public static object Delete(string installationId, string confirmInstallationId)
    {
        EnsureElevatedInstallerContext();
        if (!string.Equals(installationId, confirmInstallationId, StringComparison.Ordinal))
            throw new ArgumentException("publisher_policy_delete_confirmation_mismatch");

        var keyName = KeyName(installationId);
        if (!CngKey.Exists(keyName, Provider, CngKeyOpenOptions.MachineKey))
            return new { ok = true, deleted = false };

        using var key = CngKey.Open(keyName, Provider, CngKeyOpenOptions.MachineKey);
        if (!key.IsMachineKey)
            throw new CryptographicException("publisher_policy_key_scope_invalid");
        key.Delete();
        return new { ok = true, deleted = true };
    }

    internal static void DeleteForTests(string installationId)
    {
        var keyName = KeyName(installationId);
        if (!CngKey.Exists(keyName, Provider, CngKeyOpenOptions.MachineKey))
            return;

        using var key = CngKey.Open(keyName, Provider, CngKeyOpenOptions.MachineKey);
        key.Delete();
    }

    private static PublisherPolicyKeyInfo ReadInfo(string installationId)
    {
        var keyName = KeyName(installationId);
        using var key = CngKey.Open(keyName, Provider, CngKeyOpenOptions.MachineKey);
        ValidateKey(key);
        using var rsa = new RSACng(key);
        using var handle = key.Handle;
        var publicKey = rsa.ExportSubjectPublicKeyInfo();
        return new PublisherPolicyKeyInfo(
            keyName,
            Convert.ToBase64String(publicKey),
            ReadSecurityDescriptorSddl(handle),
            key.KeySize,
            key.IsMachineKey,
            key.ExportPolicy != CngExportPolicies.None
        );
    }

    private static void ValidateKey(CngKey key)
    {
        if (!key.IsMachineKey)
            throw new CryptographicException("publisher_policy_key_scope_invalid");
        if (key.AlgorithmGroup is null || !key.AlgorithmGroup.Equals(CngAlgorithmGroup.Rsa))
            throw new CryptographicException("publisher_policy_key_algorithm_invalid");
        if (key.KeySize != 3072)
            throw new CryptographicException("publisher_policy_key_size_invalid");
        if (key.ExportPolicy != CngExportPolicies.None)
            throw new CryptographicException("publisher_policy_key_exportable");
        if (key.KeyUsage != CngKeyUsages.Signing)
            throw new CryptographicException("publisher_policy_key_usage_invalid");

        using var handle = key.Handle;
        var sddl = ReadSecurityDescriptorSddl(handle);
        if (!string.Equals(sddl, ExpectedSecurityDescriptorSddl, StringComparison.OrdinalIgnoreCase))
            throw new CryptographicException("publisher_policy_key_acl_invalid");
    }

    private static void CreateMachineKeyWithProtectedAcl(string keyName)
    {
        IntPtr providerHandle = IntPtr.Zero;
        IntPtr keyHandle = IntPtr.Zero;
        var keyFinalized = false;
        try
        {
            var status = NCryptOpenStorageProvider(out providerHandle, ProviderName, 0);
            ThrowIfNcryptFailed(status, "publisher_policy_provider_open_failed");

            status = NCryptCreatePersistedKey(
                providerHandle,
                out keyHandle,
                KeyAlgorithm,
                keyName,
                0,
                MachineKeyFlag
            );
            ThrowIfNcryptFailed(status, "publisher_policy_key_create_failed");

            SetDwordProperty(keyHandle, LengthProperty, 3072);
            SetDwordProperty(keyHandle, KeyUsageProperty, AllowSigningFlag);
            SetDwordProperty(keyHandle, ExportPolicyProperty, 0);
            SetSecurityDescriptor(keyHandle, ExpectedSecurityDescriptorSddl);

            status = NCryptFinalizeKey(keyHandle, 0);
            ThrowIfNcryptFailed(status, "publisher_policy_key_finalize_failed");
            keyFinalized = true;
        }
        finally
        {
            if (keyHandle != IntPtr.Zero)
            {
                if (!keyFinalized)
                    _ = NCryptDeleteKey(keyHandle, 0);
                _ = NCryptFreeObject(keyHandle);
            }
            if (providerHandle != IntPtr.Zero)
                _ = NCryptFreeObject(providerHandle);
        }
    }

    private static void SetDwordProperty(IntPtr keyHandle, string name, int value)
    {
        var bytes = BitConverter.GetBytes(value);
        var status = NCryptSetProperty(keyHandle, name, bytes, bytes.Length, 0);
        ThrowIfNcryptFailed(status, name == ExportPolicyProperty
            ? "publisher_policy_key_export_policy_set_failed"
            : name == KeyUsageProperty
                ? "publisher_policy_key_usage_set_failed"
                : "publisher_policy_key_size_set_failed");
    }

    private static void SetSecurityDescriptor(IntPtr keyHandle, string sddl)
    {
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor(
                sddl, 1, out var descriptor, out var descriptorSize))
            throw new CryptographicException(Marshal.GetLastWin32Error(), "publisher_policy_acl_encode_failed");

        try
        {
            var bytes = new byte[descriptorSize];
            Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            var status = NCryptSetProperty(
                keyHandle,
                SecurityDescriptorProperty,
                bytes,
                bytes.Length,
                SecurityInformation
            );
            ThrowIfNcryptFailed(status, "publisher_policy_key_acl_set_failed");
        }
        finally
        {
            _ = LocalFree(descriptor);
        }
    }

    private static string ReadSecurityDescriptorSddl(Microsoft.Win32.SafeHandles.SafeNCryptKeyHandle keyHandle)
    {
        var buffer = new byte[4096];
        var status = NCryptGetProperty(
            keyHandle.DangerousGetHandle(),
            SecurityDescriptorProperty,
            buffer,
            buffer.Length,
            out var bytesRead,
            SecurityInformation
        );
        ThrowIfNcryptFailed(status, "publisher_policy_key_acl_read_failed");
        if (bytesRead <= 0 || bytesRead > buffer.Length)
            throw new CryptographicException("publisher_policy_key_acl_size_invalid");

        var exactBuffer = buffer.AsSpan(0, bytesRead).ToArray();
        var descriptor = new RawSecurityDescriptor(exactBuffer, 0);
        return descriptor.GetSddlForm(AccessControlSections.All);
    }

    private static void DeleteKeyIfPresent(string keyName)
    {
        try
        {
            if (!CngKey.Exists(keyName, Provider, CngKeyOpenOptions.MachineKey))
                return;
            using var key = CngKey.Open(keyName, Provider, CngKeyOpenOptions.MachineKey);
            key.Delete();
        }
        catch (CryptographicException)
        {
            // Preserve the original provisioning failure; the key remains fail-closed
            // and must be removed only by an explicit elevated repair/uninstall action.
        }
    }

    private static string KeyName(string installationId)
    {
        if (installationId.Length is < 3 or > 128
            || !Regex.IsMatch(installationId, "^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$", RegexOptions.CultureInvariant))
            throw new ArgumentException("invalid_installation_id");

        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(installationId));
        return KeyNamePrefix + Convert.ToHexString(digest).ToLowerInvariant()[..32];
    }

    private static void EnsureElevatedInstallerContext()
    {
        using var identity = WindowsIdentity.GetCurrent();
        if (identity.IsSystem)
            return;

        var principal = new WindowsPrincipal(identity);
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator))
            throw new UnauthorizedAccessException("publisher_policy_installer_elevation_required");
    }

    private static void ThrowIfNcryptFailed(int status, string error)
    {
        if (status != 0)
            throw new CryptographicException(status, error);
    }

    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int NCryptOpenStorageProvider(out IntPtr providerHandle, string providerName, int flags);

    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int NCryptCreatePersistedKey(
        IntPtr providerHandle,
        out IntPtr keyHandle,
        string algorithm,
        string keyName,
        int legacyKeySpec,
        int flags
    );

    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int NCryptSetProperty(
        IntPtr objectHandle,
        string propertyName,
        byte[] input,
        int inputLength,
        int flags
    );

    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int NCryptGetProperty(
        IntPtr objectHandle,
        string propertyName,
        byte[] output,
        int outputLength,
        out int resultLength,
        int flags
    );

    [DllImport("ncrypt.dll", ExactSpelling = true)]
    private static extern int NCryptFinalizeKey(IntPtr keyHandle, int flags);

    [DllImport("ncrypt.dll", ExactSpelling = true)]
    private static extern int NCryptDeleteKey(IntPtr keyHandle, int flags);

    [DllImport("ncrypt.dll", ExactSpelling = true)]
    private static extern int NCryptFreeObject(IntPtr objectHandle);

    [DllImport("advapi32.dll", EntryPoint = "ConvertStringSecurityDescriptorToSecurityDescriptorW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string stringSecurityDescriptor,
        uint stringSDRevision,
        out IntPtr securityDescriptor,
        out uint securityDescriptorSize
    );

    [DllImport("kernel32.dll", ExactSpelling = true)]
    private static extern IntPtr LocalFree(IntPtr memory);
}
