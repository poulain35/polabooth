import { Download, ChevronDown, Loader2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { Separator } from '../ui/separator';
import { Spinner } from '../ui/spinner';
import { Button } from '../ui/button';
import BrandLogo from '../BrandLogo';

// En-tête de l'éditeur : format, aperçu de l'accueil, annuler / rétablir, grille, sauvegarde, envoi, export.
export default function EditorHeader({
  onSaveTemplate, onHistoryOpen, onEditAnswers, onSubmitRequest, isClientMode, currentFormat, kioskMode,
  kioskKind, neutralPreview, setNeutralPreview, activePanel, setActivePanel, isSubmitting,
  setShowSubmitConfirm, isSavingTemplate, isSavingClient, setShowBatchImport, isDirty, canUndo, canRedo,
  isExporting, exportProgress, exportMenuOpen, setExportMenuOpen, snapGrid, undo, redo, handleClientSave,
  handleSaveTemplateClick, toggleSnapGrid, handleExport, submitText,
}) {
  // En-tête : dans l'admin, sous 1280 px le menu latéral prend 268 px (et porte déjà le logo) ; le logo
  // et le sous-titre du format n'y apparaissent qu'en très large.
  const headerLogoClass = isClientMode ? 'hidden md:block' : 'hidden xl:block';
  const headerLogoTextClass = isClientMode ? 'hidden md:inline' : 'hidden xl:inline';
  const formatSubtitleClass = isClientMode ? 'hidden lg:inline' : 'hidden xl:inline whitespace-nowrap';

  // ── Header ──
  return (
    <header className="flex items-center px-3 py-2 bg-card border-b border-editor-line gap-2 shrink-0 z-10 min-h-[52px]">

      {/* Logo (LAB-351 : logo carré sur téléphone, le logo en largeur pousserait « Valider » hors de l'écran) */}
      <div className="flex items-center shrink-0">
        <BrandLogo variant="square" className={`${kioskMode ? 'hidden' : 'hidden min-[360px]:block md:hidden'} h-7 w-7 object-contain`} />
        <BrandLogo className={`${headerLogoClass} h-8 w-auto`} textClassName={`${headerLogoTextClass} text-base font-semibold text-editor-fg`} />
      </div>

      <Separator orientation="vertical" className={`${headerLogoClass} h-4`} />

      {/* Format selector — pill (écran de la borne : format fixe, pas de modèles) */}
      {kioskMode ? (
        <span className="hidden lg:flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-foreground whitespace-nowrap">
          <span>{currentFormat.label}</span>
          <span className="hidden min-[1440px]:inline text-muted-foreground">·</span>
          <span className="hidden min-[1440px]:inline text-muted-foreground">{currentFormat.subtitle}</span>
        </span>
      ) : (
      <button
        onClick={() => setActivePanel(activePanel === 'templates' ? null : 'templates')}
        title={isClientMode ? 'Changer de format ou de modèle' : 'Changer de format ou de cadre photo'}
        className={`flex items-center min-w-0 gap-1 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full text-xs font-medium transition-colors
          ${activePanel === 'templates'
            ? 'bg-editor-selected text-editor-accent-fg'
            : 'bg-editor-hover text-editor-fg hover:bg-editor-pressed'}`}
      >
        <span className="truncate">{currentFormat.label}</span>
        <span className={`${formatSubtitleClass} text-editor-muted`}>·</span>
        <span className={`${formatSubtitleClass} text-editor-muted`}>{currentFormat.subtitle}</span>
        <svg className="w-3 h-3 shrink-0 text-editor-muted ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      )}

      {/* Aperçu de l'accueil de la borne : personnalisé (nom de l'événement) ou neutre */}
      {kioskKind === 'home' && (
        <div className="flex bg-muted rounded-full p-0.5 gap-0.5" role="group" aria-label="Aperçu de l'accueil">
          {[{ id: false, label: 'Personnalisé' }, { id: true, label: 'Neutre' }].map(({ id, label }) => (
            <button
              key={label}
              onClick={() => setNeutralPreview(id)}
              aria-pressed={neutralPreview === id}
              title={id
                ? "Aperçu sans le nom de l'événement : les objets « Seulement si l'accueil est personnalisé » sont masqués"
                : "Aperçu avec le nom de l'événement : tout est affiché"}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors
                ${neutralPreview === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Undo / Redo — masqués sur mobile (pas assez de place) */}
      <div className="hidden md:flex items-center gap-0.5">
        <button onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)"
          className="p-2 rounded-xl text-editor-muted hover:bg-editor-hover hover:text-editor-fg
            disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
        <button onClick={redo} disabled={!canRedo} title="Rétablir (Ctrl+Y)"
          className="p-2 rounded-xl text-editor-muted hover:bg-editor-hover hover:text-editor-fg
            disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
          </svg>
        </button>
      </div>

      {/* Snap grid toggle — masqué sur mobile */}
      <button
        onClick={toggleSnapGrid}
        title={snapGrid ? 'Désactiver la grille' : 'Activer la grille (20px)'}
        className={`hidden md:block p-2 rounded-xl transition-colors ${snapGrid
          ? 'bg-editor-selected text-editor-accent-fg'
          : 'text-editor-muted hover:bg-editor-hover hover:text-editor-fg'}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h.01M8 5h.01M12 5h.01M16 5h.01M20 5h.01M4 9h.01M8 9h.01M12 9h.01M16 9h.01M20 9h.01M4 13h.01M8 13h.01M12 13h.01M16 13h.01M20 13h.01M4 17h.01M8 17h.01M12 17h.01M16 17h.01M20 17h.01" />
        </svg>
      </button>

      {/* Right actions */}
      <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
        {exportProgress && (
          <span className="text-xs text-editor-muted animate-pulse hidden sm:block">{exportProgress}</span>
        )}
        {/* Téléphone (client) : historique dans un menu, pour garder le bouton d'envoi entier.
            Avec « Modifier mes réponses », le menu est aussi visible sur ordinateur. */}
        {isClientMode && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button aria-label="Plus d'actions" title="Plus d'actions"
                className={`${onEditAnswers ? 'flex' : 'md:hidden flex'} items-center justify-center w-10 h-10 rounded-full text-editor-muted
                  hover:bg-editor-soft data-[state=open]:bg-editor-hover transition-colors`}>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => onHistoryOpen?.()} className="py-2.5 md:hidden">
                Historique
              </DropdownMenuItem>
              {onEditAnswers && (
                <DropdownMenuItem onSelect={() => onEditAnswers()} className="py-2.5">
                  Modifier mes réponses
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onSaveTemplate && !kioskMode && (
          <Button
            variant="secondary" size="sm"
            onClick={() => setShowBatchImport(true)}
            title="Import en lot" aria-label="Import en lot">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="hidden sm:max-md:inline lg:inline">Import lot</span>
          </Button>
        )}
        {onSaveTemplate && (
          <Button
            size="sm"
            onClick={handleSaveTemplateClick}
            disabled={isSavingTemplate}
            title={kioskMode ? 'Enregistrer le brouillon (ne change rien sur les bornes)' : undefined}
          >
            {isSavingTemplate
              ? <Spinner className="h-3.5 w-3.5 border-current" label="Sauvegarde en cours" />
              : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
            }
            {isSavingTemplate ? 'Sauvegarde…' : 'Sauvegarder'}
          </Button>
        )}
        {isClientMode && (
          <>
            {/* Bouton historique */}
            <button
              onClick={() => onHistoryOpen?.()}
              title="Historique des versions"
              aria-label="Historique"
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-full border border-editor-line
                text-editor-muted hover:bg-editor-soft hover:border-primary hover:text-primary transition-colors"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="hidden xl:inline">Historique</span>
            </button>

            {/* Bouton sauvegarde manuelle */}
            <button
              onClick={handleClientSave}
              disabled={isSavingClient || !isDirty}
              title={isSavingClient ? 'Sauvegarde en cours…' : isDirty ? 'Sauvegarder les modifications' : 'Aucune modification'}
              aria-label={isSavingClient ? 'Sauvegarde…' : isDirty ? 'Sauvegarder' : 'Sauvegardé'}
              className={`flex items-center justify-center w-10 h-10 md:w-auto md:h-auto gap-1.5 md:px-2.5 md:py-1.5 text-xs font-medium rounded-full border transition-colors relative
                ${isSavingClient
                  ? 'border-primary text-primary bg-primary/10 cursor-wait'
                  : isDirty
                    ? 'border-primary text-primary bg-primary/10 hover:bg-primary/15 cursor-pointer'
                    : 'border-editor-line text-editor-faint cursor-default'}`}
            >
              {isSavingClient
                ? <Spinner className="h-3.5 w-3.5 shrink-0" label="Sauvegarde en cours" />
                : <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
              }
              <span className="hidden xl:inline">
                {isSavingClient ? 'Sauvegarde…' : isDirty ? 'Sauvegarder' : 'Sauvegardé'}
              </span>
              {isDirty && !isSavingClient && (
                <span className="xl:hidden absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary/100 rounded-full" />
              )}
            </button>

            {/* Bouton valider */}
            <button onClick={() => (onSubmitRequest ? onSubmitRequest() : setShowSubmitConfirm(true))} disabled={isSubmitting}
              className="flex shrink-0 items-center gap-1.5 h-11 px-4 md:h-auto md:py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-full
                hover:bg-primary disabled:opacity-50 disabled:cursor-wait transition-colors shadow-sm">
              {isSubmitting
                ? <Spinner className="h-3.5 w-3.5 border-primary-foreground/40 border-t-primary-foreground" label="Envoi en cours" />
                : <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
              }
              <span className="hidden md:inline whitespace-nowrap">{submitText.full}</span>
              <span className="md:hidden whitespace-nowrap">{submitText.short}</span>
            </button>
          </>
        )}
        {!isClientMode && kioskMode && (
          <Button variant="secondary" size="sm" disabled={isExporting} onClick={() => handleExport(false)}
            title={`Télécharger l'écran en PNG ${currentFormat.exportWidth}×${currentFormat.exportHeight}`}
            aria-label="Télécharger PNG">
            {isExporting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Download className="w-3.5 h-3.5" />}
            <span className="hidden xl:inline">{isExporting ? 'Export…' : 'Télécharger PNG'}</span>
          </Button>
        )}
        {!isClientMode && !kioskMode && (
          <DropdownMenu open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" disabled={isExporting} aria-label="Télécharger PNG">
                {isExporting
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />}
                <span className="hidden sm:max-md:inline lg:inline">{isExporting ? 'Export…' : 'Télécharger PNG'}</span>
                {!isExporting && <ChevronDown className="w-3 h-3" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onSelect={() => handleExport(true)} className="flex-col items-start py-3">
                <div className="text-sm font-medium text-foreground">Zones photo transparentes</div>
                <div className="text-xs text-muted-foreground mt-0.5">Trous transparents à l'emplacement des photos (pour superposer).</div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => handleExport(false)} className="flex-col items-start py-3">
                <div className="text-sm font-medium text-foreground">Fond plein (sans transparence)</div>
                <div className="text-xs text-muted-foreground mt-0.5">Fond du cadre photo visible partout, à recadrer ailleurs.</div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
