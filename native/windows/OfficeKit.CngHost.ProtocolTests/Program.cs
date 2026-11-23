using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

internal static class Program
{
    private static int _assertions;

    private static int Main()
    {
        var valid = BuildResponse(
            moreData: 0,
            0x00000122,
            0x0000012A,
            0x00000134,
            0x00000169
        );

        Assert(TpmCapabilityResponseParser.TryParse(valid, out var parsed, out var error), "valid response parses");
        Assert(error.Length == 0, "valid response has no error");
        Assert(parsed is not null, "valid response returns parsed data");
        Assert(parsed!.MoreData == false, "complete list is marked complete");
        Assert(parsed.IsAdvertised(0x0000012A) == true, "present command is true");
        Assert(parsed.IsAdvertised(0x00000137) == false, "absent command is false for a complete list");

        var incomplete = BuildResponse(moreData: 1, 0x00000122);
        Assert(TpmCapabilityResponseParser.TryParse(incomplete, out var partial, out error), "partial response parses");
        Assert(partial!.MoreData, "partial response records moreData");
        Assert(partial.IsAdvertised(0x00000122) == true, "present command remains true in a partial list");
        Assert(partial.IsAdvertised(0x0000012A) is null, "missing command is unknown in a partial list");

        var sessionTag = (byte[])valid.Clone();
        BinaryPrimitives.WriteUInt16BigEndian(sessionTag.AsSpan(0, 2), 0x8002);
        AssertRejected(sessionTag, "tpm_response_tag_invalid");

        var invalidMoreData = (byte[])valid.Clone();
        invalidMoreData[10] = 2;
        AssertRejected(invalidMoreData, "tpm_response_more_data_invalid");

        var wrongDeclaredSize = (byte[])valid.Clone();
        BinaryPrimitives.WriteUInt32BigEndian(wrongDeclaredSize.AsSpan(2, 4), (uint)(valid.Length + 1));
        AssertRejected(wrongDeclaredSize, "tpm_response_size_mismatch");

        var nonzeroResponseCode = (byte[])valid.Clone();
        BinaryPrimitives.WriteUInt32BigEndian(nonzeroResponseCode.AsSpan(6, 4), 0x00000101);
        AssertRejected(nonzeroResponseCode, "tpm_response_code_nonzero");

        var wrongCapability = (byte[])valid.Clone();
        BinaryPrimitives.WriteUInt32BigEndian(wrongCapability.AsSpan(11, 4), 0x00000001);
        AssertRejected(wrongCapability, "tpm_capability_type_invalid");

        var wrongCount = (byte[])valid.Clone();
        BinaryPrimitives.WriteUInt32BigEndian(wrongCount.AsSpan(15, 4), 257);
        AssertRejected(wrongCount, "tpm_command_count_invalid");

        var mismatchedPayload = (byte[])valid.Clone();
        BinaryPrimitives.WriteUInt32BigEndian(mismatchedPayload.AsSpan(15, 4), 3);
        AssertRejected(mismatchedPayload, "tpm_capability_payload_size_invalid");

        AssertRejected(valid[..10], "tpm_response_size_invalid");

        var duplicate = BuildResponse(moreData: 0, 0x00000122, 0x00000122);
        AssertRejected(duplicate, "tpm_command_code_duplicate");

        Assert(!CngAlgorithmGroupPolicy.IsRsa<string>(null, "RSA"), "null CNG algorithm group is rejected");
        Assert(CngAlgorithmGroupPolicy.IsRsa("RSA", "RSA"), "RSA CNG algorithm group is accepted");
        Assert(!CngAlgorithmGroupPolicy.IsRsa("ECDH", "RSA"), "non-RSA CNG algorithm group is rejected");

        TestPublisherPolicyMachineKey();

        Console.WriteLine($"TPM capability response parser passed {_assertions} assertions.");
        return 0;
    }

    private static void TestPublisherPolicyMachineKey()
    {
        var installationId = "protocol-test-" + Guid.NewGuid().ToString("N");
        var otherInstallationId = "protocol-test-" + Guid.NewGuid().ToString("N");
        try
        {
            var provisioned = PublisherPolicyKey.Provision(installationId);
            Assert(provisioned.MachineScope, "publisher policy key uses machine scope");
            Assert(provisioned.KeySize == 3072, "publisher policy key is RSA 3072");
            Assert(!provisioned.PrivateKeyExportable, "publisher policy private key is non-exportable");
            Assert(string.Equals(provisioned.SecurityDescriptorSddl, PublisherPolicyKey.ExpectedSecurityDescriptorSddl, StringComparison.OrdinalIgnoreCase),
                "publisher policy key has the exact installer-only security descriptor");

            var payload = Encoding.UTF8.GetBytes("{\"schemaVersion\":1,\"purpose\":\"protocol-test\"}");
            var signature = PublisherPolicyKey.SignPayload(installationId, payload);
            using var verifier = RSA.Create();
            verifier.ImportSubjectPublicKeyInfo(Convert.FromBase64String(provisioned.PublicKeySpki), out var read);
            Assert(read == Convert.FromBase64String(provisioned.PublicKeySpki).Length,
                "publisher policy SPKI is fully consumed");
            Assert(verifier.VerifyData(payload, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1),
                "machine CNG key signs policy payloads with SHA-256");

            var second = PublisherPolicyKey.Provision(otherInstallationId);
            Assert(second.KeyName != provisioned.KeyName, "publisher policy keys are installation scoped");
            Assert(second.PublicKeySpki != provisioned.PublicKeySpki, "different installations receive different publisher policy keys");

            var duplicateRejected = false;
            try { _ = PublisherPolicyKey.Provision(installationId); }
            catch (InvalidOperationException error) when (error.Message == "publisher_policy_key_already_exists")
            {
                duplicateRejected = true;
            }
            Assert(duplicateRejected, "publisher policy provisioning never overwrites or regenerates an existing key");
        }
        finally
        {
            PublisherPolicyKey.DeleteForTests(installationId);
            PublisherPolicyKey.DeleteForTests(otherInstallationId);
        }
    }

    private static byte[] BuildResponse(byte moreData, params uint[] commandCodes)
    {
        var response = new byte[19 + commandCodes.Length * sizeof(uint)];
        BinaryPrimitives.WriteUInt16BigEndian(response.AsSpan(0, 2), 0x8001);
        BinaryPrimitives.WriteUInt32BigEndian(response.AsSpan(2, 4), (uint)response.Length);
        BinaryPrimitives.WriteUInt32BigEndian(response.AsSpan(6, 4), 0);
        response[10] = moreData;
        BinaryPrimitives.WriteUInt32BigEndian(response.AsSpan(11, 4), 0x00000002);
        BinaryPrimitives.WriteUInt32BigEndian(response.AsSpan(15, 4), (uint)commandCodes.Length);

        for (var index = 0; index < commandCodes.Length; index++)
        {
            var offset = 19 + index * sizeof(uint);
            BinaryPrimitives.WriteUInt32BigEndian(response.AsSpan(offset, sizeof(uint)), commandCodes[index]);
        }

        return response;
    }

    private static void AssertRejected(byte[] response, string expectedError)
    {
        Assert(!TpmCapabilityResponseParser.TryParse(response, out var parsed, out var error),
            $"response rejected: {expectedError}");
        Assert(parsed is null, $"rejected response has no parsed value: {expectedError}");
        Assert(error == expectedError, $"rejection reason: expected {expectedError}, received {error}");
    }

    private static void Assert(bool condition, string message)
    {
        _assertions++;
        if (!condition)
            throw new InvalidOperationException($"assertion_failed: {message}");
    }
}
