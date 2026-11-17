using System.Buffers.Binary;

internal sealed class TpmCapabilityResponse
{
    private readonly HashSet<uint> _commandCodes;

    internal TpmCapabilityResponse(bool moreData, HashSet<uint> commandCodes)
    {
        MoreData = moreData;
        _commandCodes = commandCodes;
    }

    internal bool MoreData { get; }

    // A missing code is only a confirmed negative when the TPM returned the
    // complete command list. If moreData is set, absence from this page is unknown.
    internal bool? IsAdvertised(uint commandCode)
    {
        if (_commandCodes.Contains(commandCode))
            return true;
        return MoreData ? null : false;
    }
}

internal static class TpmCapabilityResponseParser
{
    private const ushort TpmStNoSessions = 0x8001;
    private const uint TpmRcSuccess = 0;
    private const uint TpmCapCommands = 0x00000002;
    private const uint MaximumCommandCount = 256;
    private const int ResponseParametersOffset = 19;

    internal static bool TryParse(
        ReadOnlySpan<byte> response,
        out TpmCapabilityResponse? parsed,
        out string error)
    {
        parsed = null;
        error = string.Empty;

        if (response.Length < ResponseParametersOffset)
            return Fail("tpm_response_size_invalid", out error);

        // GetCapability is submitted without authorization sessions. A
        // TPM_ST_SESSIONS response has a different parameter layout and must
        // never be interpreted using the no-sessions offsets below.
        var tag = BinaryPrimitives.ReadUInt16BigEndian(response[..2]);
        if (tag != TpmStNoSessions)
            return Fail("tpm_response_tag_invalid", out error);

        var declaredSize = BinaryPrimitives.ReadUInt32BigEndian(response.Slice(2, 4));
        if (declaredSize != (uint)response.Length)
            return Fail("tpm_response_size_mismatch", out error);

        var responseCode = BinaryPrimitives.ReadUInt32BigEndian(response.Slice(6, 4));
        if (responseCode != TpmRcSuccess)
            return Fail("tpm_response_code_nonzero", out error);

        var moreDataByte = response[10];
        if (moreDataByte > 1)
            return Fail("tpm_response_more_data_invalid", out error);

        var capability = BinaryPrimitives.ReadUInt32BigEndian(response.Slice(11, 4));
        if (capability != TpmCapCommands)
            return Fail("tpm_capability_type_invalid", out error);

        var count = BinaryPrimitives.ReadUInt32BigEndian(response.Slice(15, 4));
        if (count > MaximumCommandCount)
            return Fail("tpm_command_count_invalid", out error);

        var expectedSize = ResponseParametersOffset + (long)count * sizeof(uint);
        if (expectedSize != response.Length)
            return Fail("tpm_capability_payload_size_invalid", out error);

        var commandCodes = new HashSet<uint>();
        for (var index = 0; index < (int)count; index++)
        {
            var offset = ResponseParametersOffset + index * sizeof(uint);
            var commandCode = BinaryPrimitives.ReadUInt32BigEndian(response.Slice(offset, sizeof(uint)));
            if (!commandCodes.Add(commandCode))
                return Fail("tpm_command_code_duplicate", out error);
        }

        parsed = new TpmCapabilityResponse(moreDataByte == 1, commandCodes);
        return true;
    }

    private static bool Fail(string reason, out string error)
    {
        error = reason;
        return false;
    }
}
