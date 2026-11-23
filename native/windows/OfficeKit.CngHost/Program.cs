using System.Buffers.Binary;
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
            "tpm-capabilities" => GetTpmCapabilities(),
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

    private static object GetTpmCapabilities()
    {
        // Do not create a TBS context unless the metadata query explicitly reports TPM 2.0.
        TpmDeviceInfo deviceInfo = default;
        uint infoResult;
        try
        {
            infoResult = Tbsi_GetDeviceInfo((uint)Marshal.SizeOf<TpmDeviceInfo>(), out deviceInfo);
        }
        catch (DllNotFoundException)
        {
            return TpmCapabilitiesUnavailable("tbs_library_unavailable");
        }
        catch (EntryPointNotFoundException)
        {
            return TpmCapabilitiesUnavailable("tbs_entrypoint_unavailable");
        }

        if (infoResult != 0)
        {
            return new
            {
                ok = true,
                status = infoResult == 0x8028400F ? "not_present" : "unavailable",
                tbsResult = $"0x{infoResult:X8}",
                tpmResponded = false,
                nvProvisioningPerformed = false,
                monotonicAnchorAvailable = false,
                protectionPromotionAllowed = false
            };
        }
        if (deviceInfo.StructVersion != 1)
            return TpmCapabilitiesUnavailable("unsupported_tpm_info_schema");
        if (deviceInfo.TpmVersion != 2)
            return new
            {
                ok = true,
                status = deviceInfo.TpmVersion == 1 ? "unsupported_tpm_1_2" : "unsupported_tpm_version",
                tpmResponded = false,
                nvProvisioningPerformed = false,
                monotonicAnchorAvailable = false,
                protectionPromotionAllowed = false
            };

        IntPtr context = IntPtr.Zero;
        try
        {
            var parameters = new TbsContextParams2 { Version = 2, Flags = 0x4 };
            var createResult = Tbsi_Context_Create(ref parameters, out context);
            if (createResult != 0 || context == IntPtr.Zero)
                return new
                {
                    ok = true,
                    status = createResult == 0x8028400F ? "not_present" : "unavailable",
                    tbsResult = $"0x{createResult:X8}",
                    tpmResponded = false,
                    nvProvisioningPerformed = false,
                    monotonicAnchorAvailable = false,
                    protectionPromotionAllowed = false
                };

            // TPM2_GetCapability(TPM_CAP_COMMANDS) is read-only. This query only
            // asks which NV command codes the TPM advertises; it never defines,
            // reads, writes, increments, or removes an NV index.
            var command = new byte[22];
            BinaryPrimitives.WriteUInt16BigEndian(command.AsSpan(0, 2), 0x8001);
            BinaryPrimitives.WriteUInt32BigEndian(command.AsSpan(2, 4), (uint)command.Length);
            BinaryPrimitives.WriteUInt32BigEndian(command.AsSpan(6, 4), 0x0000017A);
            BinaryPrimitives.WriteUInt32BigEndian(command.AsSpan(10, 4), 0x00000002);
            BinaryPrimitives.WriteUInt32BigEndian(command.AsSpan(14, 4), 0x00000122);
            BinaryPrimitives.WriteUInt32BigEndian(command.AsSpan(18, 4), 256);

            var response = new byte[4096];
            uint responseSize = (uint)response.Length;
            var submitResult = Tbsip_Submit_Command(
                context, 0, 200, command, (uint)command.Length, response, ref responseSize
            );
            if (submitResult != 0)
                return new
                {
                    ok = true,
                    status = "unavailable",
                    tbsResult = $"0x{submitResult:X8}",
                    tpmResponded = false,
                    nvProvisioningPerformed = false,
                    monotonicAnchorAvailable = false,
                    protectionPromotionAllowed = false
                };

            if (responseSize < 10 || responseSize > response.Length)
                return TpmCapabilitiesUnavailable("tpm_response_size_invalid");
            var actualSize = checked((int)responseSize);
            var responseTag = BinaryPrimitives.ReadUInt16BigEndian(response.AsSpan(0, 2));
            var declaredSize = BinaryPrimitives.ReadUInt32BigEndian(response.AsSpan(2, 4));
            if (responseTag != 0x8001)
                return TpmCapabilitiesUnavailable("tpm_response_tag_invalid");
            if (declaredSize != responseSize)
                return TpmCapabilitiesUnavailable("tpm_response_size_mismatch");

            var responseCode = BinaryPrimitives.ReadUInt32BigEndian(response.AsSpan(6, 4));
            if (responseCode != 0)
                return new
                {
                    ok = true,
                    status = "tpm_command_rejected",
                    tpmResponseCode = $"0x{responseCode:X8}",
                    tpmResponded = true,
                    nvProvisioningPerformed = false,
                    monotonicAnchorAvailable = false,
                    protectionPromotionAllowed = false
                };

            if (!TpmCapabilityResponseParser.TryParse(
                response.AsSpan(0, actualSize),
                out var parsedCapabilities,
                out var parseError))
                return TpmCapabilitiesUnavailable(parseError);

            var capabilities = parsedCapabilities!;
            return new
            {
                ok = true,
                status = "capabilities_read",
                tpmResponded = true,
                tpmVersion = "2.0",
                commandListMoreData = capabilities.MoreData,
                commandListComplete = !capabilities.MoreData,
                advertisedNvCommands = new
                {
                    defineSpace = capabilities.IsAdvertised(0x0000012A),
                    undefineSpace = capabilities.IsAdvertised(0x00000122),
                    increment = capabilities.IsAdvertised(0x00000134),
                    read = capabilities.IsAdvertised(0x0000014E),
                    readPublic = capabilities.IsAdvertised(0x00000169),
                    write = capabilities.IsAdvertised(0x00000137)
                },
                // TPM advertisement is not proof that Windows TBS policy permits
                // the command for this process, nor proof of usable NV authorization.
                tbsCommandPermissionVerified = false,
                nvProvisioningPerformed = false,
                monotonicAnchorAvailable = false,
                protectionPromotionAllowed = false
            };
        }
        catch (DllNotFoundException)
        {
            return TpmCapabilitiesUnavailable("tbs_library_unavailable");
        }
        catch (EntryPointNotFoundException)
        {
            return TpmCapabilitiesUnavailable("tbs_entrypoint_unavailable");
        }
        finally
        {
            if (context != IntPtr.Zero)
                _ = Tbsip_Context_Close(context);
        }
    }

    private static object TpmCapabilitiesUnavailable(string reason) => new
    {
        ok = true,
        status = "unavailable",
        reason,
        tpmResponded = false,
        nvProvisioningPerformed = false,
        monotonicAnchorAvailable = false,
        protectionPromotionAllowed = false
    };

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
        if (!CngAlgorithmGroupPolicy.IsRsa(key.AlgorithmGroup) || !IsPrivateKeyNonExportable(key))
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
        if (!CngAlgorithmGroupPolicy.IsRsa(key.AlgorithmGroup) || !IsPrivateKeyNonExportable(key))
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
            if (!CngAlgorithmGroupPolicy.IsRsa(key.AlgorithmGroup))
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
            if (!CngAlgorithmGroupPolicy.IsRsa(key.AlgorithmGroup) || !IsPrivateKeyNonExportable(key))
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
    private struct TbsContextParams2
    {
        public uint Version;
        public uint Flags;
    }

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

    [DllImport("tbs.dll", EntryPoint = "Tbsi_Context_Create", ExactSpelling = true)]
    private static extern uint Tbsi_Context_Create(ref TbsContextParams2 parameters, out IntPtr context);

    [DllImport("tbs.dll", EntryPoint = "Tbsip_Submit_Command", ExactSpelling = true)]
    private static extern uint Tbsip_Submit_Command(
        IntPtr context, uint locality, uint priority,
        byte[] command, uint commandSize, byte[] result, ref uint resultSize
    );

    [DllImport("tbs.dll", EntryPoint = "Tbsip_Context_Close", ExactSpelling = true)]
    private static extern uint Tbsip_Context_Close(IntPtr context);

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
