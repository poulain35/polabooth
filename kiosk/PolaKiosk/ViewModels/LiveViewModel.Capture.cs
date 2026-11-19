using System.IO;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

// Écran Live : compte à rebours et prise de vue, une photo par zone du cadre, puis fin de séance.
public partial class LiveViewModel
{
    private async Task RunCountdownAndCaptureAsync(CancellationToken token)
    {
        var eventId  = _kioskState.ActiveEventId ?? Guid.Empty;

        // Chargement config kiosk avant le loop (pour le countdown en secondes)
        var ev = await _sync.GetCurrentEventAsync(eventId);
        var kioskCfg = KioskConfig.FromFormConfig(ev?.FormConfigJson);
        var eventName = ev?.Name ?? "Événement";
        int countdownSecs = kioskCfg?.Capture?.CountdownSeconds ?? 5;

        // Format choisi à l'accueil (LAB-237) : GIF = N photos au flash, puis une animation.
        var format = _journey.CaptureFormat == CaptureFormat.Gif ? CaptureFormat.Gif : CaptureFormat.Photo;
        bool isGif = format == CaptureFormat.Gif;

        // Questionnaire après la prise de vue (LAB-222) : une seule fois par parcours (« Reprendre »
        // ne le repose pas). Mode obligatoire : la photo reste en attente jusqu'à la validation.
        var questionnaire = kioskCfg?.Questionnaire;
        bool askQuestionnaire = questionnaire?.IsActive == true && !_journey.QuestionnaireHandled;
        bool isPending = askQuestionnaire && questionnaire!.RequiredForPhoto;

        // Identifiant tiré dès le début : il nomme le dossier d'attente et devient celui de la séance.
        var sessionId  = Guid.NewGuid();
        _logContext?.BeginSession(sessionId, eventId); // journaux rattachés à la séance jusqu'au retour à l'accueil
        var capturedAt = UtcNow();

        // Photos rangées dans un dossier propre à l'événement (originals + composites),
        // ou dans pending\{sessionId}\ tant que l'invité n'a pas validé le questionnaire.
        _sessionPaths.EnsureDirectoriesExist(eventName, eventId);
        string photoDir, compositeDir;
        if (isPending)
        {
            _sessionPaths.EnsurePendingDirectoriesExist(sessionId);
            photoDir     = _sessionPaths.GetPendingOriginalsDirectory(sessionId);
            compositeDir = _sessionPaths.GetPendingCompositesDirectory(sessionId);
        }
        else
        {
            photoDir     = _sessionPaths.GetOriginalsDirectory(eventName, eventId);
            compositeDir = _sessionPaths.GetCompositesDirectory(eventName, eventId);
        }

        List<string> capturedPaths;
        try
        {
            capturedPaths = isGif
                ? await CaptureGifAsync(countdownSecs, kioskCfg?.Capture?.Gif ?? new GifCaptureConfig(), photoDir, token)
                : await CaptureAllZonesAsync(countdownSecs, photoDir, token);

            // Écran quitté pendant la prise de vue (retour, erreur) : ni montage, ni navigation.
            token.ThrowIfCancellationRequested();
        }
        catch when (isPending)
        {
            // Prise de vue ratée ou interrompue : les poses déjà prises ne quittent pas l'attente.
            _sessions.DiscardPendingSession(sessionId);
            throw;
        }

        var context = new CaptureContext(
            SessionId:           sessionId,
            CapturedAtUtc:       capturedAt,
            EventId:             eventId,
            EventName:           eventName,
            Config:              kioskCfg,
            Template:            _preloadedTemplate,
            TemplateFormat:      _activeTemplateFormat,
            PhotoPaths:          capturedPaths,
            CompositesDirectory: compositeDir,
            IsPending:           isPending,
            EarlyUpload:         askQuestionnaire && !isPending && !CaptureResult.UserChoosesEffect(kioskCfg, format),
            AccessCode:          _kioskState.LastAccessCode ?? "",
            PrinterName:         _settings.Kiosk.PrinterName,
            PhotoConsent:        _journey.PhotoConsent,
            Format:              format);

        if (askQuestionnaire)
        {
            // Montage en arrière-plan, navigation immédiate : l'invité répond pendant qu'il se prépare.
            _journey.QuestionnaireHandled = true;
            var captureCts = new CancellationTokenSource();
            var capture = _finisher.FinishCaptureAsync(context, captureCts.Token);
            _navigation.NavigateTo<Views.QuestionnaireView>(new QuestionnaireParameters(
                Capture:             capture,
                CaptureCancellation: captureCts,
                Config:              questionnaire!,
                SessionId:           sessionId,
                EventId:             eventId,
                AccessCode:          context.AccessCode,
                PhotoConsent:        context.PhotoConsent,
                Provider:            CaptureFinisher.QuestionnaireProviderFor(_kioskState, _settings)));
            return;
        }

        // ── Sans questionnaire : montage puis navigation, comme avant ────
        CompositingText = isGif ? CompositingAnimationText : CompositingPhotoText;
        IsCompositing = true;
        CaptureResult result;
        try { result = await _finisher.FinishCaptureAsync(context, CancellationToken.None); }
        finally { IsCompositing = false; }

        // L'accueil a pu être affiché pendant le montage : ne pas y superposer le résultat.
        token.ThrowIfCancellationRequested();
        result.NavigateNext(_navigation);
    }

    // ── Boucle de capture — une photo par zone ────────────────────────
    private async Task<List<string>> CaptureAllZonesAsync(int countdownSecs, string photoDir, CancellationToken token)
    {
        // Zones à photographier (au moins 1 zone couvrant tout le canvas si aucune parsée)
        var zones = _photoZones.Count > 0
            ? _photoZones
            : new[] { new PhotoZone(0, 0, (float)TemplateCanvasWidth, (float)TemplateCanvasHeight) };

        var capturedPaths = new List<string>();

        for (int i = 0; i < zones.Count; i++)
        {
            token.ThrowIfCancellationRequested();

            SetCurrentPhoto(i + 1);

            // Photos 2, 3… : redémarrer le live view, repositionner, laisser 1,5s au sujet
            if (i > 0)
            {
                await _camera.StartLiveViewAsync(OnFrameReceived);
                SetCameraToZone(zones[i]);
                await Delay(TimeSpan.FromMilliseconds(1500), token);
            }
            else
            {
                SetCameraToZone(zones[0]);
            }

            await RunCountdownAsync(countdownSecs, token);
            token.ThrowIfCancellationRequested();

            var flashStart = StartFlash();
            try
            {
                await _camera.StopLiveViewAsync();
                var path = await _camera.CaptureAsync(photoDir);
                capturedPaths.Add(path);
                MarkPhotoTaken(i + 1, path);
            }
            finally
            {
                await EndFlashAsync(flashStart, token);
            }
        }
        return capturedPaths;
    }

    // ── GIF (LAB-237, méthode A) : N photos au flash, « k/N » entre deux prises ──
    /// <summary>
    /// Compte à rebours habituel avant la première photo, puis « 2/N », « 3/N »… pendant
    /// <c>capture.gif.interval_ms</c> avant chacune des suivantes (live view relancé pour que l'invité
    /// change de pose). Cadrage de la première zone : chaque image remplira toutes les zones.
    /// Une prise ratée arrête la série (erreur habituelle, aucune séance partielle).
    /// </summary>
    private async Task<List<string>> CaptureGifAsync(int countdownSecs, GifCaptureConfig gif, string photoDir, CancellationToken token)
    {
        var zone = _photoZones.Count > 0
            ? _photoZones[0]
            : new PhotoZone(0, 0, (float)TemplateCanvasWidth, (float)TemplateCanvasHeight);
        SetPhotoCount(gif.Shots);
        SetCameraToZone(zone);
        var interval = TimeSpan.FromMilliseconds(gif.IntervalMs);

        DateTime flashStart = default;
        var taken = new List<string>();
        try
        {
            var paths = await _camera.CaptureSequenceAsync(photoDir, gif.Shots,
                beforeShot: async (shot, ct) =>
                {
                    SetCurrentPhoto(shot);
                    if (shot == 1)
                        await RunCountdownAsync(countdownSecs, ct);
                    else
                        await RunGifStepAsync(shot, gif.Shots, interval, ct);
                    ct.ThrowIfCancellationRequested();
                    flashStart = StartFlash();
                    await _camera.StopLiveViewAsync();
                },
                afterShot: async (shot, path, ct) =>
                {
                    taken.Add(path);
                    MarkPhotoTaken(shot, path);
                    await EndFlashAsync(flashStart, ct);
                },
                token);
            return paths.ToList();
        }
        catch
        {
            // Série incomplète : aucune séance partielle, les poses déjà prises sont supprimées.
            foreach (var path in taken)
            {
                try { if (File.Exists(path)) File.Delete(path); }
                catch (IOException) { /* fichier occupé : le nettoyage de l'événement le reprendra */ }
                catch (UnauthorizedAccessException) { }
            }
            throw;
        }
        finally
        {
            IsFlashing = false;
            IsGifStep  = false;
        }
    }

    /// <summary>« k/N » pendant l'intervalle, live view relancé (son démarrage compte dans l'intervalle).</summary>
    private async Task RunGifStepAsync(int shot, int shots, TimeSpan interval, CancellationToken token)
    {
        GifStepText = $"{shot}/{shots}";
        IsGifStep   = true;
        var start   = DateTime.UtcNow;
        await _camera.StartLiveViewAsync(OnFrameReceived);
        var left = interval - (DateTime.UtcNow - start);
        await Delay(left > TimeSpan.Zero ? left : TimeSpan.Zero, token);
    }

    /// <summary>
    /// Compte à rebours : chiffres dans l'anneau (LAB-248), puis directement le flash et son
    /// « Souriez ! » (LAB-260). Durée et premier chiffre AVANT IsCountingDown : la vue lance
    /// alors l'anneau qui se vide sur toute la durée.
    /// </summary>
    private async Task RunCountdownAsync(int countdownSecs, CancellationToken token)
    {
        if (countdownSecs <= 0) return;
        CountdownTotalSeconds = countdownSecs;
        CountdownValue = countdownSecs;
        IsCountingDown = true;
        for (int s = countdownSecs; s >= 1; s--)
        {
            token.ThrowIfCancellationRequested();
            CountdownValue = s;
            await Delay(TimeSpan.FromSeconds(1), token);
        }
    }

    /// <summary>
    /// Écran blanc : affiché AVANT le déclenchement et maintenu pendant toute la capture. L'APN
    /// (Canon R100) met un moment à répondre à TakePicture ; si on masquait l'écran trop tôt,
    /// l'obturateur se déclenchait après la disparition du blanc. Le blanc passe devant l'anneau
    /// (ou le « k/N ») avant que celui-ci ne disparaisse.
    /// </summary>
    private DateTime StartFlash()
    {
        IsFlashing     = true;
        IsCountingDown = false;
        IsGifStep      = false;
        return DateTime.UtcNow;
    }

    /// <summary>Durée minimale de l'effet flash, puis le blanc s'éteint.</summary>
    private async Task EndFlashAsync(DateTime flashStart, CancellationToken token)
    {
        var elapsed = DateTime.UtcNow - flashStart;
        if (elapsed < MinFlashDuration)
        {
            try { await Delay(MinFlashDuration - elapsed, token); }
            catch (OperationCanceledException) { /* écran quitté : le flash s'éteint tout de suite */ }
        }
        IsFlashing = false;
    }
}
