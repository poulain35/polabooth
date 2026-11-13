using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Une photo de la séance sur l'écran de prise de vue (LAB-248) : pastille en haut, case à droite.
/// </summary>
public partial class LivePhotoSlot : ObservableObject
{
    public LivePhotoSlot(int number) => Number = number;

    public int Number { get; }

    /// <summary>Photo en cours de prise : case surlignée en rose.</summary>
    [ObservableProperty] private bool _isCurrent;

    /// <summary>Photo déjà prise : pastille pleine, case qui montre la photo.</summary>
    [ObservableProperty] private bool _isTaken;

    /// <summary>Vignette de la photo prise (chargée après la prise, null tant qu'elle ne l'est pas).</summary>
    [ObservableProperty] private BitmapSource? _photo;
}
