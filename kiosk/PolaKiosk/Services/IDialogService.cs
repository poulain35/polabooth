namespace PolaKiosk.Services;

public interface IDialogService
{
    Task<bool> ConfirmAsync(string message, string title = "Confirmation");
    Task AlertAsync(string message, string title = "Information");
    Task<string?> PromptAsync(string message, string title = "Saisie");
}
