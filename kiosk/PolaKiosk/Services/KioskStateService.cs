using System.IO;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

public class KioskStateService : IKioskStateService
{
    private readonly string _statePath;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private KioskState _state = new();

    public Guid?   ActiveEventId    => _state.ActiveEventId;
    public string? ActiveEventName  => _state.ActiveEventName;
    public string? LastAccessCode   => _state.LastAccessCode;
    public string? ContactCompany   => _state.ContactCompany;
    public string? ContactPhone     => _state.ContactPhone;
    public string? ContactEmail     => _state.ContactEmail;
    public Guid?   AccountOrgId     => _state.AccountOrgId;
    public string? AccountName      => _state.AccountName;

    public KioskStateService(AppSettings settings)
    {
        var paths = KioskPaths.From(settings);
        Directory.CreateDirectory(paths.Root);
        _statePath = paths.StateFile;
        Load();
    }

    public async Task SetActiveEventAsync(Guid eventId, string eventName, string accessCode)
    {
        _state = new KioskState
        {
            ActiveEventId   = eventId,
            ActiveEventName = eventName,
            LastAccessCode  = accessCode.ToUpperInvariant(),
            ContactCompany  = _state.ContactCompany,
            ContactPhone    = _state.ContactPhone,
            ContactEmail    = _state.ContactEmail,
            AccountOrgId    = _state.AccountOrgId,
            AccountName     = _state.AccountName,
        };
        await SaveAsync();
    }

    public async Task SetContactInfoAsync(string company, string? phone, string? email)
    {
        _state.ContactCompany = company;
        _state.ContactPhone   = phone;
        _state.ContactEmail   = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        await SaveAsync();
    }

    public async Task ClearActiveEventAsync()
    {
        // Le compte de la borne n'est pas lié à l'événement : il reste.
        _state = new KioskState { AccountOrgId = _state.AccountOrgId, AccountName = _state.AccountName };
        await SaveAsync();
    }

    public async Task SetPairedAccountAsync(string? accountName, Guid? orgId = null)
    {
        _state.AccountName  = string.IsNullOrWhiteSpace(accountName) ? null : accountName.Trim();
        _state.AccountOrgId = orgId is { } id && id != Guid.Empty ? id : null;
        await SaveAsync();
    }

    public async Task SetAccountOrgIdAsync(Guid orgId)
    {
        _state.AccountOrgId = orgId;
        await SaveAsync();
    }

    // Sérialisé dans le verrou : deux écritures rapprochées ne peuvent pas laisser l'état le plus ancien.
    private async Task SaveAsync()
    {
        await _writeLock.WaitAsync();
        try { await AtomicFile.WriteAllTextAsync(_statePath, JsonConvert.SerializeObject(_state)); }
        finally { _writeLock.Release(); }
    }

    private void Load()
    {
        if (!File.Exists(_statePath)) return;
        try { _state = JsonConvert.DeserializeObject<KioskState>(File.ReadAllText(_statePath)) ?? new(); }
        catch { _state = new(); }
    }

    private class KioskState
    {
        public Guid?   ActiveEventId   { get; set; }
        public string? ActiveEventName { get; set; }
        public string? LastAccessCode  { get; set; }
        public string? ContactCompany  { get; set; }
        public string? ContactPhone    { get; set; }
        public string? ContactEmail    { get; set; }
        public Guid?   AccountOrgId    { get; set; }
        public string? AccountName     { get; set; }
    }
}
