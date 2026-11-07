using System.Security.Cryptography;
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
            _ => throw new ArgumentException("unsupported_command")
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

    private static string NormalizeError(Exception error)
    {
        if (error is InvalidOperationException && error.Message == "key_scope_mismatch")
            return "key_scope_mismatch";
        if (error is ArgumentException argument)
            return argument.Message;
        if (error is CryptographicException)
            return "windows_cng_operation_failed";
        return "windows_cng_host_error";
    }
}
