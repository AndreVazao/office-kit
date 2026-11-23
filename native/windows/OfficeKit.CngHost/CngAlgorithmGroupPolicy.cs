internal static class CngAlgorithmGroupPolicy
{
    public static bool IsRsa<TGroup>(TGroup? algorithmGroup, TGroup expectedRsaGroup)
        where TGroup : class =>
        algorithmGroup is not null && algorithmGroup.Equals(expectedRsaGroup);
}
