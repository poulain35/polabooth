using System.Windows;

namespace PolaKiosk.Services;

public class DialogService : IDialogService
{
    public Task<bool> ConfirmAsync(string message, string title = "Confirmation")
    {
        var result = MessageBox.Show(message, title, MessageBoxButton.YesNo);
        return Task.FromResult(result == MessageBoxResult.Yes);
    }

    public Task AlertAsync(string message, string title = "Information")
    {
        MessageBox.Show(message, title);
        return Task.CompletedTask;
    }

    public Task<string?> PromptAsync(string message, string title = "Saisie")
    {
        // Implémentation custom dialog à venir
        return Task.FromResult<string?>(null);
    }
}
