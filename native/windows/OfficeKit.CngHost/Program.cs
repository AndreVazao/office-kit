using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

internal static class Program
{
    private const string ProviderName = "Microsoft Software Key Storage Provider";
    private static readonly Regex KeyNamePattern = new(
        "^ok-[a-f0-9]{16}-[a-f0-9]{32}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant
    );

    private static int Main()
    {
        try
        {
            var line = Console.ReadLine();
            if (string.IsNullOrWhiteSpace(line))
                throw new ArgumentException("request_required");

            using var document = JsonDocument.Parse(line);
            var response = Execute(document.RootElement);
            Console.WriteLine(JsonSerializer.Serialize(response));
            return 0;
        }
        catch (Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                ok = false,
                error = NormalizeError(error)
            }));
            return 1;
        }
    }

    private static object Execute(JsonElement request)
    {
        var command = RequiredString(request, "command");
        var installationId = RequiredString(request, "installationId");
        var prefix = ScopePrefix(installationId);

        return command switch
        {
            "create" => Create(prefix),
            "sign" => Sign(prefix, RequiredString(request, "keyId"), Decode(RequiredString(request, "message"))),
            "has" => Has(prefix, RequiredString(request, "keyId")),
            "delete" => Delete(prefix, RequiredString(request, "keyId")),
            "check-export" => CheckExport(prefix, RequiredString(request, "keyId")),
            "tpm-info" => GetTpmInfo(),
            "secret-public-key" => SecretPublicKey(installationId, RequiredString(request, "namespace")),
            "secret-decrypt-key" => SecretDecryptKey(installationId, RequiredString(request, "namespace"), Decode(RequiredString(request, "wrappedKey"))),
            "secret-check-export" => SecretCheckExport(installationId, RequiredString(request, "namespace")),
            "secret-delete-key" => SecretDeleteKey(installationId, RequiredString(request, "namespace")),
            _ => throw new ArgumentException("unsupported_command")
        };
    }

    private static object GetTpmInfo()
    {
        TpmDeviceInfo info = default;
        uint result;
        try
        {
            result = Tbsi_GetDeviceInfo((uint)Marshal.SizeOf<TpmDeviceInfo>(), out info);
        }
        catch (DllNotFoundException)
        {
            return new
            {
                ok = true,
                status = "unavailable",
                reason = "tbs_library_unavailable",
                monotonicAnchorAvailable = false,
                provisioningPerformed = false
            };
        }
        catch (EntryPointNotFoundException)
        {
            return new
            {
                ok = true,
                status = "unavailable",
                reason = "tbs_entrypoint_unavailable",
                monotonicAnchorAvailable = false,
                provisioningPerformed = false
            };
        }

        if (result != 0)
        {
            var status = result == 0x8028400F
                ? "not_present"
                : "unavailable";
            return new
            {
                ok = true,
                status,
                tbsResult = $"0x{result:X8}",
                monotonicAnchorAvailable = false,
                provisioningPerformed = false
            };
        }

        // The current device-info output schema is version 1. Do not interpret
        // fields from a schema version this helper does not explicitly support.
        if (info.StructVersion != 1)
        {
            return new
            {
                ok = true,
                status = "unsupported_schema",
                schemaVersion = info.StructVersion,
                monotonicAnchorAvailable = false,
                provisioningPerformed = false
            };
        }

        var version = info.TpmVersion switch
        {
            1 => "1.2",
            2 => "2.0",
            _ => "unknown"
        };
        var detectionStatus = info.TpmVersion switch
        {
            1 => "detected_tpm_1_2",
            2 => "detected_tpm_2_0",
            _ => "unsupported_tpm_version"
        };

        return new
        {
            ok = true,
            status = detectionStatus,
            schemaVersion = info.StructVersion,
            tpmVersion = version,
            monotonicAnchorAvailable = false,
            provisioningPerformed = false,
            protectionPromotionAllowed = false
        };
    }

    private static object Create(string prefix)
    {
        var keyName = prefix + Guid.NewGuid().ToString("N");
        var parameters = new CngKeyCreationParameters
        {
            Provider = new CngProvider(ProviderName),
            ExportPolicy = CngExportPolicies.None,
            KeyUsage = CngKeyUsages.Signing
        };

        using var key = CngKey.Create(CngAlgorithm.ECDsaP256, keyName, parameters);
        using var ecdsa = new ECDsaCng(key);
        var publicKey = ExportPublicKey(ecdsa.ExportParameters(false));

        return new
        {
            ok = true,
            keyId = keyName,
            algorithm = "ECDSA-P256-SHA256",
            publicKey = Encode(publicKey)
        };
    }

    private static object Sign(string prefix, string keyId, byte[] message)
    {
        ValidateScopedKeyId(prefix, keyId);
        using var key = CngKey.Open(keyId, new CngProvider(ProviderName), CngKeyOpenOptions.None);
        using var ecdsa = new ECDsaCng(key);
        var signature = ecdsa.SignData(
            message,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation
        );
        return new { ok = true, signature = Encode(signature) };
    }

    private static object Has(string prefix, string keyId)
    {
        if (!IsScopedKeyId(prefix, keyId))
            return new { ok = true, exists = false };

        try
        {
            using var key = CngKey.Open(keyId, new CngProvider(ProviderName), CngKeyOpenOptions.None);
            return new { ok = true, exists = true };
        }
        catch (CryptographicException error) when (IsMissingKey(error))
        {
            return new { ok = true, exists = false };
        }
    }

    private static object Delete(string prefix, string keyId)
    {
        ValidateScopedKeyId(prefix, keyId);
        try
        {
            using var key = CngKey.Open(keyId, new CngProvider(ProviderName), CngKeyOpenOptions.None);
            key.Delete();
            return new { ok = true, deleted = true };
        }
        catch (CryptographicException error) when (IsMissingKey(error))
        {
            return new { ok = true, deleted = false };
        }
    }

    private static object CheckExport(string prefix, string keyId)
    {
        ValidateScopedKeyId(prefix, keyId);
        using var key = CngKey.Open(keyId, new CngProvider(ProviderName), CngKeyOpenOptions.None);
        try
        {
            _ = key.Export(CngKeyBlobFormat.EccPrivateBlob);
            return new { ok = true, exportable = true };
        }
        catch (CryptographicException)
        {
            return new { ok = true, exportable = false };
        }
    }


    private static object SecretPublicKey(string installationId, string secretNamespace)
    {
        using var key = OpenOrCreateSecretKey(installationId, secretNamespace);
        if (!key.AlgorithmGroup.Equals(CngAlgorithmGroup.Rsa) || !IsPrivateKeyNonExportable(key))
            throw new InvalidOperationException("secret_key_export_policy_invalid");

        using var rsa = new RSACng(key);
        if (rsa.KeySize < 3072)
            throw new InvalidOperationException("secret_key_size_invalid");

        return new
        {
            ok = true,
            publicKey = Encode(rsa.ExportSubjectPublicKeyInfo()),
            keySize = rsa.KeySize,
            privateKeyNonExportable = true,
            protectionLevel = "os-protected",
            hardwareBacked = false
        };
    }

    private static object SecretDecryptKey(string installationId, string secretNamespace, byte[] wrappedKey)
    {
        var keyName = SecretKeyName(installationId, secretNamespace);
        using var key = CngKey.Open(keyName, new CngProvider(ProviderName), CngKeyOpenOptions.None);
        if (!key.AlgorithmGroup.Equals(CngAlgorithmGroup.Rsa) || !IsPrivateKeyNonExportable(key))
            throw new InvalidOperationException("secret_key_export_policy_invalid");

        using var rsa = new RSACng(key);
        if (rsa.KeySize < 3072 || wrappedKey.Length > 1_024 || wrappedKey.Length != rsa.KeySize / 8)
            throw new ArgumentException("secret_wrapped_key_invalid");

        var dataKey = rsa.Decrypt(wrappedKey, RSAEncryptionPadding.OaepSHA256);
        if (dataKey.Length != 32)
        {
            CryptographicOperations.ZeroMemory(dataKey);
            throw new ArgumentException("secret_data_key_invalid");
        }

        try
        {
            return new { ok = true, key = Encode(dataKey) };
        }
        finally
        {
            CryptographicOperations.ZeroMemory(dataKey);
        }
    }

    private static object SecretCheckExport(string installationId, string secretNamespace)
    {
        var keyName = SecretKeyName(installationId, secretNamespace);
        try
        {
            using var key = CngKey.Open(keyName, new CngProvider(ProviderName), CngKeyOpenOptions.None);
            if (!key.AlgorithmGroup.Equals(CngAlgorithmGroup.Rsa))
                throw new InvalidOperationException("secret_key_algorithm_invalid");
            return new { ok = true, exists = true, exportable = !IsPrivateKeyNonExportable(key) };
        }
        catch (CryptographicException error) when (IsMissingKey(error))
        {
            return new { ok = true, exists = false, exportable = false };
        }
    }

    private static object SecretDeleteKey(string installationId, string secretNamespace)
    {
        var keyName = SecretKeyName(installationId, secretNamespace);
        try
        {
            using var key = CngKey.Open(keyName, new CngProvider(ProviderName), CngKeyOpenOptions.None);
            if (!key.AlgorithmGroup.Equals(CngAlgorithmGroup.Rsa) || !IsPrivateKeyNonExportable(key))
                throw new InvalidOperationException("secret_key_policy_invalid");
            key.Delete();
            return new { ok = true, deleted = true };
        }
        catch (CryptographicException error) when (IsMissingKey(error))
        {
            return new { ok = true, deleted = false };
        }
    }

    private static CngKey OpenOrCreateSecretKey(string installationId, string secretNamespace)
    {
        var keyName = SecretKeyName(installationId, secretNamespace);
        try
        {
            return CngKey.Open(keyName, new CngProvider(ProviderName), CngKeyOpenOptions.None);
        }
        catch (CryptographicException error) when (IsMissingKey(error))
        {
            var parameters = new CngKeyCreationParameters
            {
                Provider = new CngProvider(ProviderName),
                KeyCreationOptions = CngKeyCreationOptions.None,
                ExportPolicy = CngExportPolicies.None,
                KeyUsage = CngKeyUsages.Decryption
            };
            parameters.Parameters.Add(new CngProperty(
                "Length",
                BitConverter.GetBytes(3072),
                CngPropertyOptions.Persist
            ));
            try
            {
                return CngKey.Create(CngAlgorithm.Rsa, keyName, parameters);
            }
            catch (CryptographicException)
            {
                return CngKey.Open(keyName, new CngProvider(ProviderName), CngKeyOpenOptions.None);
            }
        }
    }

    private static string SecretKeyName(string installationId, string secretNamespace)
    {
        _ = ScopePrefix(installationId);
        if (!Regex.IsMatch(secretNamespace, "^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$", RegexOptions.CultureInvariant))
            throw new ArgumentException("secret_namespace_invalid");

        var installationDigest = SHA256.HashData(Encoding.UTF8.GetBytes(installationId));
        var namespaceDigest = SHA256.HashData(Encoding.UTF8.GetBytes(secretNamespace));
        return "okv-" + Convert.ToHexString(installationDigest).ToLowerInvariant()[..16]
            + "-" + Convert.ToHexString(namespaceDigest).ToLowerInvariant()[..32];
    }

    private static bool IsPrivateKeyNonExportable(CngKey key)
    {
        if (key.ExportPolicy != CngExportPolicies.None)
            return false;
        try
        {
            var privateBlob = key.Export(CngKeyBlobFormat.Pkcs8PrivateBlob);
            CryptographicOperations.ZeroMemory(privateBlob);
            return false;
        }
        catch (CryptographicException)
        {
            return true;
        }
    }

    private static byte[] ExportPublicKey(ECParameters parameters)
    {
        if (parameters.Q.X is null || parameters.Q.Y is null
            || parameters.Q.X.Length != 32 || parameters.Q.Y.Length != 32)
            throw new CryptographicException("invalid_p256_public_key");

        var raw = new byte[65];
        raw[0] = 0x04;
        Buffer.BlockCopy(parameters.Q.X, 0, raw, 1, 32);
        Buffer.BlockCopy(parameters.Q.Y, 0, raw, 33, 32);
        return raw;
    }

    private static string ScopePrefix(string installationId)
    {
        if (installationId.Length is < 3 or > 128
            || !Regex.IsMatch(installationId, "^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$", RegexOptions.CultureInvariant))
            throw new ArgumentException("invalid_installation_id");

        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(installationId));
        return "ok-" + Convert.ToHexString(digest).ToLowerInvariant()[..16] + "-";
    }

    private static bool IsScopedKeyId(string prefix, string keyId) =>
        keyId.StartsWith(prefix, StringComparison.Ordinal) && KeyNamePattern.IsMatch(keyId);

    private static void ValidateScopedKeyId(string prefix, string keyId)
    {
        if (!IsScopedKeyId(prefix, keyId))
            throw new InvalidOperationException("key_scope_mismatch");
    }

    private static bool IsMissingKey(CryptographicException error)
    {
        const int NteBadKeyset = unchecked((int)0x80090016);
        const int NteNotFound = unchecked((int)0x80090011);
        return error.HResult == NteBadKeyset || error.HResult == NteNotFound;
    }

    private static string RequiredString(JsonElement request, string name)
    {
        if (!request.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
            throw new ArgumentException("request_field_missing_" + name);
        var text = value.GetString();
        if (string.IsNullOrWhiteSpace(text))
            throw new ArgumentException("request_field_invalid_" + name);
        return text;
    }

    private static byte[] Decode(string value)
    {
        if (!Regex.IsMatch(value, "^[A-Za-z0-9_-]+$", RegexOptions.CultureInvariant))
            throw new ArgumentException("invalid_base64url");
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        return Convert.FromBase64String(normalized);
    }

    private static string Encode(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    [StructLayout(LayoutKind.Sequential)]
    private struct TpmDeviceInfo
    {
        public uint StructVersion;
        public uint TpmVersion;
        public uint TpmInterfaceType;
        public uint TpmImpRevision;
    }

    [DllImport("tbs.dll", EntryPoint = "Tbsi_GetDeviceInfo", ExactSpelling = true)]
    private static extern uint Tbsi_GetDeviceInfo(uint size, out TpmDeviceInfo info);

    private static string NormalizeError(Exception error)
    {
        if (error is InvalidOperationException && Regex.IsMatch(error.Message, "^[a-z0-9_]+$", RegexOptions.CultureInvariant))
            return error.Message;
        if (error is ArgumentException argument)
            return argument.Message;
        if (error is CryptographicException)
            return "windows_cng_operation_failed";
        return "windows_cng_host_error";
    }
}
