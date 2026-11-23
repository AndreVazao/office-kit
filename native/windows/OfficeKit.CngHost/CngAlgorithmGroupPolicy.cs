using System.Security.Cryptography;

internal static class CngAlgorithmGroupPolicy
{
    public static bool IsRsa(CngAlgorithmGroup? algorithmGroup) =>
        algorithmGroup is not null && algorithmGroup.Equals(CngAlgorithmGroup.Rsa);
}
