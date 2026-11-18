using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

public record EffectOption(PhotoEffect Effect, string Label, BitmapImage? Preview);

public partial class EffectSelectViewModel : ObservableObject, IParameterReceiver
{
    private readonly INavigationService _navigation;
    private EffectSelectParams? _params;

    [ObservableProperty] private List<EffectOption> _effects = new();
    [ObservableProperty] private EffectOption? _selectedEffect;
    [ObservableProperty] private BitmapImage? _previewImage;
    [ObservableProperty] private bool _isApplying = false;

    public EffectSelectViewModel(INavigationService navigation)
    {
        _navigation = navigation;
    }

    public void ReceiveParameter(object parameter)
    {
        if (parameter is EffectSelectParams p)
            _ = InitializeAsync(p);
    }

    private async Task InitializeAsync(EffectSelectParams p)
    {
        _params = p;

        var options = new List<EffectOption>();
        foreach (var effectName in p.EnabledEffects)
        {
            var effect  = PhotoEffectService.FromString(effectName);
            var label   = PhotoEffectService.Labels[effect];
            var preview = await GeneratePreviewAsync(p.CompositePath, effect, 200);
            options.Add(new EffectOption(effect, label, preview));
        }

        Effects = options;
        SelectedEffect = options.FirstOrDefault(o => PhotoEffectService.ToString(o.Effect) == p.DefaultEffect)
                        ?? options.FirstOrDefault();

        UpdatePreview();
    }

    [RelayCommand]
    private void SelectEffect(EffectOption option)
    {
        SelectedEffect = option;
        UpdatePreview();
    }

    [RelayCommand]
    private async Task ConfirmAsync()
    {
        if (_params == null || SelectedEffect == null) return;
        IsApplying = true;

        try
        {
            string finalPath;

            if (SelectedEffect.Effect == PhotoEffect.None)
            {
                finalPath = _params.CompositePath;
            }
            else
            {
                finalPath = await Task.Run(() =>
                    PhotoEffectService.ApplyAndSave(
                        _params.CompositePath,
                        SelectedEffect.Effect,
                        Path.GetDirectoryName(_params.CompositePath)!));
            }

            _navigation.NavigateTo<Views.ResultView>(new ResultParameters(
                SessionId:          _params.SessionId,
                EventId:            _params.EventId,
                EventName:          _params.EventName,
                CompositePath:      finalPath,
                AccessCode:         _params.AccessCode,
                MaxPrintsPerEvent:  _params.MaxPrintsPerEvent,
                MaxPrintsPerPhoto:  _params.MaxPrintsPerPhoto,
                PrinterName:        _params.PrinterName,
                PaperFormat:        _params.PaperFormat,
                EmailConfig:        _params.EmailConfig,
                ResultCfg:          _params.ResultCfg,
                PhotoCount:         _params.PhotoCount
            ));
        }
        finally { IsApplying = false; }
    }

    private void UpdatePreview()
    {
        if (SelectedEffect == null) return;
        PreviewImage = SelectedEffect.Preview;
    }

    private static async Task<BitmapImage?> GeneratePreviewAsync(string path, PhotoEffect effect, int maxSize)
    {
        try
        {
            return await Task.Run(() =>
            {
                var bytes = PhotoEffectService.ApplyEffect(path, effect);
                return ImageLoader.FromBytes(bytes, maxSize);
            });
        }
        catch { return null; }
    }
}

public record EffectSelectParams(
    Guid SessionId, Guid EventId,
    string EventName,
    string CompositePath,
    List<string> EnabledEffects,
    string DefaultEffect,
    int? MaxPrintsPerEvent, int? MaxPrintsPerPhoto,
    string PrinterName, string PaperFormat,
    Models.Supabase.EmailShareConfig? EmailConfig,
    string AccessCode = "",
    Models.Supabase.ResultConfig? ResultCfg = null,
    int PhotoCount = 1
);
