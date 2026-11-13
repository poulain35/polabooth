using FluentAssertions;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-197 : cache de licence signé (HMAC, clé protégée par DPAPI) pour le mode hors ligne.
public class LicenseCacheTests : IDisposable
{
    private const string MachineId = "machine-test-0001";
    private static readonly DateTime Now   = new(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan Grace = TimeSpan.FromDays(14);

    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    private LicenseCache NewCache(string machineId = MachineId) => new(_dir.Path, machineId);

    private void Edit(Action<JObject> change)
    {
        var path = _dir.File("license.json");
        var json = JObject.Parse(File.ReadAllText(path));
        change(json);
        File.WriteAllText(path, json.ToString());
    }

    [Fact]
    public void Read_accepts_a_signed_cache_within_the_grace_period()
    {
        NewCache().Write(true, Now.AddDays(-3));

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Valid);
    }

    [Fact]
    public void Read_reports_a_missing_cache()
    {
        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Missing);
    }

    [Fact]
    public void Read_reports_a_signed_negative_result()
    {
        NewCache().Write(false, Now);

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.NotLicensed);
    }

    [Fact]
    public void Read_rejects_a_cache_whose_result_was_modified()
    {
        NewCache().Write(false, Now);
        Edit(j => j["licensed"] = true);

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Tampered);
    }

    [Fact]
    public void Read_rejects_a_cache_whose_date_was_modified()
    {
        NewCache().Write(true, Now.AddDays(-30));
        Edit(j => j["cached_at"] = Now.AddDays(-1).ToString("o"));

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Tampered);
    }

    [Fact]
    public void Read_rejects_the_old_unsigned_format()
    {
        File.WriteAllText(_dir.File("license.json"),
            $$"""{"licensed":true,"machine_id":"{{MachineId}}","cached_at":"{{Now:o}}"}""");

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Tampered);
    }

    [Fact]
    public void Read_rejects_a_cache_from_another_machine()
    {
        NewCache("autre-poste").Write(true, Now);

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Tampered);
    }

    [Fact]
    public void Read_rejects_a_cache_when_the_signing_key_is_lost()
    {
        NewCache().Write(true, Now);
        File.Delete(_dir.File("license.key"));

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Tampered);
    }

    [Fact]
    public void Read_rejects_a_cache_dated_in_the_future()
    {
        NewCache().Write(true, Now.AddDays(2));

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.FutureDate);
    }

    [Fact]
    public void Read_tolerates_a_small_clock_skew()
    {
        NewCache().Write(true, Now.AddMinutes(2));

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Valid);
    }

    [Fact]
    public void Read_expires_after_the_grace_period()
    {
        NewCache().Write(true, Now.AddDays(-15));

        NewCache().Read(Now, Grace).Should().Be(LicenseCacheStatus.Expired);
    }

    [Fact]
    public void Write_keeps_the_same_key_between_instances()
    {
        NewCache().Write(true, Now);
        var key = File.ReadAllBytes(_dir.File("license.key"));

        NewCache().Write(true, Now);

        File.ReadAllBytes(_dir.File("license.key")).Should().Equal(key);
        File.ReadAllText(_dir.File("license.json")).Should().NotContain(Convert.ToBase64String(key));
    }
}
