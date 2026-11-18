using System.Text.RegularExpressions;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Controls;

namespace PolaKiosk.ViewModels;

// Écran résultat : envoi de la photo par e-mail (écran 3b, puis « e-mail envoyé »).
public partial class ResultViewModel
{
    private static readonly Regex EmailPattern = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.CultureInvariant);

    internal const int DomainSuggestionCount = 4;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendEmailCommand))]
    private string _emailInputText = "";

    /// <summary>Accord de l'invité : toujours décoché à l'ouverture, même avec une adresse pré-remplie.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendEmailCommand))]
    private bool _emailConsent;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SendButtonText))]
    [NotifyCanExecuteChangedFor(nameof(SendEmailCommand))]
    private bool _isEmailSending;

    [ObservableProperty] private string _emailError = "";
    [ObservableProperty] private string _sentToAddress = "";
    [ObservableProperty] private IReadOnlyList<string> _domainSuggestions = [];

    public string SendButtonText => IsEmailSending ? "Envoi…" : "Envoyer";

    // Saisie de l'adresse (clavier tactile ou physique) : l'invité est actif.
    partial void OnEmailInputTextChanged(string value)
    {
        RegisterActivity();
        EmailError = "";
        DomainSuggestions = EmailDomainSuggestions.Suggest(value ?? "", DomainSuggestionCount);
    }

    partial void OnEmailConsentChanged(bool value) => RegisterActivity();

    /// <summary>Raccourci de domaine : remplace tout ce qui suit « @ » (ou l'ajoute).</summary>
    [RelayCommand]
    private void ApplyEmailDomain(string? domain)
    {
        if (string.IsNullOrWhiteSpace(domain)) return;
        RegisterActivity();
        var text = EmailInputText ?? "";
        var at = text.IndexOf('@');
        var local = at < 0 ? text : text[..at];
        var updated = local + "@" + domain.TrimStart('@');
        if (updated.Length <= EmailMaxLength) EmailInputText = updated;
    }

    internal const int EmailMaxLength = 254;

    internal static bool IsPlausibleEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) && EmailPattern.IsMatch(email.Trim());

    private bool CanSendEmail() =>
        EmailConsent && IsShareReady && !IsEmailSending && IsPlausibleEmail(EmailInputText);

    [RelayCommand(CanExecute = nameof(CanSendEmail))]
    private async Task SendEmailAsync()
    {
        if (_params == null || _photoPublicUrl == null || !CanSendEmail()) return;

        RegisterActivity();
        var address = EmailInputText.Trim();
        IsEmailSending = true;
        EmailError = "";
        try
        {
            await _supabase.SendKioskPhotoEmailAsync(_params.EventId, address, _photoPublicUrl);
            SentToAddress  = address;
            EmailInputText = "";
            EmailConsent   = false;
            Screen         = ResultScreen.EmailSent;
        }
        catch (Exception ex)
        {
            await _kioskLog.LogErrorAsync("email", ex.Message, ex.StackTrace);
            EmailError = "L'envoi n'a pas abouti. Vérifiez l'adresse et réessayez.";
        }
        finally
        {
            IsEmailSending = false;
            RegisterActivity();
        }
    }
}
