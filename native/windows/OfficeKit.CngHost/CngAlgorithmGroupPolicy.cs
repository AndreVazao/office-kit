internal static class CngAlgorithmGroupPolicy
{
    public static bool IsRsa(string? algorithmGroup) =>
        string.Equals(algorithmGroup, "RSA", StringComparison.OrdinalIgnoreCase);
}
