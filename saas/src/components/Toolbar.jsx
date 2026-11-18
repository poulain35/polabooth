import { useRef } from 'react';
import {
  LayoutGrid, Sticker, Sparkles, Image as ImageIcon, Type, Square, Circle, Minus,
  ImagePlus, Copy, Group, Ungroup, Lock, Unlock, ChevronUp, ChevronDown,
  AlignCenterHorizontal, AlignCenterVertical, Trash2, MousePointerClick, TextCursorInput, Frame,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from './ui/dropdown-menu';
import { ALLOWED, ACTION_LABELS, VARIABLE_LABELS, SLOT_LABELS } from '../lib/kioskScreenLayout';

// ariaLabel : nom lu par les lecteurs d'écran quand le libellé visible est un symbole (LAB-355).
function ToolBtn({ onClick, title, ariaLabel, active, danger, disabled, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 px-2 py-1.5 md:px-1 md:py-2 md:w-full
        rounded-xl transition-colors shrink-0
        ${active
          ? 'bg-editor-selected text-editor-accent-fg'
          : danger
            ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-25 disabled:cursor-not-allowed'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed'
        }`}
    >
      {children}
    </button>
  );
}

// Écrans de la borne (LAB-296) : menu d'un outil, limité à ce que l'écran autorise.
function KioskMenu({ title, label, icon, heading, items, labels, onPick }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={title}
          className="flex flex-col items-center gap-0.5 px-2 py-1.5 md:px-1 md:py-2 md:w-full rounded-xl transition-colors shrink-0
            text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-primary-soft data-[state=open]:text-primary-ink"
        >
          {/* La flèche se pose à côté de l'icône : sous le libellé, « Emplacement » sortait du rail. */}
          <span className="relative flex">
            {icon}
            <span aria-hidden="true" className="absolute left-full top-1/2 -translate-y-1/2 ml-0.5 text-[9px] leading-none">▾</span>
          </span>
          <span className="text-[10px] leading-tight text-center whitespace-nowrap md:whitespace-normal">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-medium">{heading}</DropdownMenuLabel>
        {items.map((id) => (
          <DropdownMenuItem key={id} onSelect={() => onPick?.(id)}>{labels[id] ?? id}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Divider() {
  // Vertical line on mobile, horizontal on desktop
  return <div className="w-px h-8 md:w-auto md:h-px bg-border shrink-0 mx-1 md:mx-2 md:my-1" />;
}

// adminMode : titres plus grands dans l'admin (10 px), 8 px côté client.
function SectionLabel({ children, adminMode }) {
  return (
    <p className={`hidden md:block ${adminMode ? 'text-[10px]' : 'text-[8px]'} font-editor-strong text-muted-foreground editor-overline text-center mb-1`}>
      {children}
    </p>
  );
}

export default function Toolbar({
  activePanel,
  onToggleTemplates,
  onToggleStickers,
  onToggleAIBackground,
  showAIBackground,
  onAddPhotoZone,
  // Faux pour l'écran d'accueil (LAB-289) : pas de zone photo sur un écran.
  showPhotoZone = true,
  onAddText,
  onAddRect,
  onAddCircle,
  onAddLine,
  onUploadImage,
  onDeleteSelected,
  onBringForward,
  onSendBackward,
  onCenterH,
  onCenterV,
  onDuplicate,
  onGroup,
  onUngroup,
  onToggleLock,
  hasSelection,
  isLocked,
  hasMultiSelection,
  selectionIsGroup,
  // Faux en format borne : pas de bibliothèque de modèles pour les écrans.
  showTemplates = true,
  // Admin : la bibliothèque s'appelle « Cadres photo » ; le client garde « Modèles » (ses textes ne changent pas).
  adminMode = false,
  // Écrans de la borne (LAB-296) : 'home' | 'result' affiche Bouton, Texte vivant et Emplacement.
  kioskKind = null,
  onAddKioskButton,
  onAddKioskVariable,
  onAddKioskSlot,
}) {
  const fileInputRef = useRef(null);
  const kioskAllowed = kioskKind ? ALLOWED[kioskKind] : null;
  // Libellés longs (« Décorations », « Rectangle ») : 8 px sur le rail étroit du client, taille normale dans l'admin.
  const narrowLabelSize = adminMode ? 'text-editor-2xs' : 'text-editor-2xs md:text-[8px]';

  return (
    <aside className={`
      flex flex-row md:flex-col items-center
      w-full ${adminMode ? 'md:w-[76px]' : 'md:w-[58px]'}
      h-[58px] md:h-auto
      overflow-x-auto md:overflow-y-auto md:overflow-x-hidden
      bg-card
      border-t md:border-t-0 md:border-r
      border-border
      shrink-0
      py-0 md:py-2
      px-1 md:px-0
      fixed bottom-0 left-0 right-0 z-30
      md:static md:bottom-auto md:left-auto md:right-auto md:order-first
      [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
    `}>

      {/* ── Panneaux ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel adminMode={adminMode}>Panneaux</SectionLabel>
        {showTemplates && (
          <ToolBtn onClick={onToggleTemplates} title={adminMode ? 'Cadres photo' : 'Modèles'} active={activePanel === 'templates'}>
            <LayoutGrid className="w-5 h-5" strokeWidth={1.6} />
            <span className="text-editor-2xs font-medium">{adminMode ? 'Cadres' : 'Modèles'}</span>
          </ToolBtn>
        )}
        <ToolBtn onClick={onToggleStickers} title="Décorations" active={activePanel === 'stickers'}>
          <Sticker className="w-5 h-5" strokeWidth={1.6} />
          <span className={`${narrowLabelSize} font-medium tracking-tight whitespace-nowrap`}>Décorations</span>
        </ToolBtn>
        {showAIBackground && (
          <ToolBtn onClick={onToggleAIBackground} title="Fond IA" active={activePanel === 'ai-background'}>
            <Sparkles className="w-5 h-5" fill="currentColor" strokeWidth={0} />
            <span className="text-editor-2xs font-medium">Fond IA</span>
          </ToolBtn>
        )}
      </div>

      <Divider />

      {/* ── Borne ── */}
      {kioskAllowed && (
        <>
          <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
            <SectionLabel adminMode={adminMode}>Borne</SectionLabel>
            <KioskMenu
              title="Ajouter un bouton de la borne"
              label="Bouton"
              icon={<MousePointerClick className="w-5 h-5" strokeWidth={1.6} />}
              heading="Action du bouton"
              items={kioskAllowed.actions}
              labels={ACTION_LABELS}
              onPick={onAddKioskButton}
            />
            <KioskMenu
              title="Ajouter un texte rempli par la borne"
              label="Texte vivant"
              icon={<TextCursorInput className="w-5 h-5" strokeWidth={1.6} />}
              heading="Valeur affichée"
              items={kioskAllowed.variables}
              labels={VARIABLE_LABELS}
              onPick={onAddKioskVariable}
            />
            <KioskMenu
              title="Ajouter un emplacement de photo"
              label="Emplacement"
              icon={<Frame className="w-5 h-5" strokeWidth={1.6} />}
              heading="Photo affichée"
              items={kioskAllowed.slots}
              labels={SLOT_LABELS}
              onPick={onAddKioskSlot}
            />
          </div>

          <Divider />
        </>
      )}

      {/* ── Ajouter ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel adminMode={adminMode}>Ajouter</SectionLabel>
        {showPhotoZone && (
          <ToolBtn onClick={onAddPhotoZone} title="Ajouter une zone photo">
            <ImageIcon className="w-5 h-5" strokeWidth={1.6} />
            <span className="text-editor-2xs">Photo</span>
          </ToolBtn>
        )}
        <ToolBtn onClick={onAddText} title="Ajouter du texte">
          <Type className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs">Texte</span>
        </ToolBtn>
        <ToolBtn onClick={onAddRect} title="Ajouter un rectangle">
          <Square className="w-5 h-5" strokeWidth={1.6} />
          <span className={`${narrowLabelSize} tracking-tight whitespace-nowrap`}>Rectangle</span>
        </ToolBtn>
        <ToolBtn onClick={onAddCircle} title="Ajouter un cercle">
          <Circle className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs">Cercle</span>
        </ToolBtn>
        <ToolBtn onClick={onAddLine} title="Ajouter une ligne">
          <Minus className="w-5 h-5 rotate-45" strokeWidth={1.6} />
          <span className="text-editor-2xs">Ligne</span>
        </ToolBtn>
        <ToolBtn onClick={() => fileInputRef.current?.click()} title="Importer une image">
          <ImagePlus className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs">Image</span>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onUploadImage} />
        </ToolBtn>
      </div>

      <Divider />

      {/* ── Sélection ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel adminMode={adminMode}>Sélection</SectionLabel>
        <ToolBtn onClick={onDuplicate} title="Dupliquer (Ctrl+D)" disabled={!hasSelection}>
          <Copy className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs">Dupliquer</span>
        </ToolBtn>
        {hasMultiSelection && (
          <ToolBtn onClick={onGroup} title="Grouper (Ctrl+G)">
            <Group className="w-5 h-5" strokeWidth={1.6} />
            <span className="text-editor-2xs">Grouper</span>
          </ToolBtn>
        )}
        {selectionIsGroup && (
          <ToolBtn onClick={onUngroup} title="Dégrouper (Ctrl+Shift+G)">
            <Ungroup className="w-5 h-5" strokeWidth={1.6} />
            <span className="text-editor-2xs">Dégrouper</span>
          </ToolBtn>
        )}
        <ToolBtn onClick={onToggleLock} title={isLocked ? 'Déverrouiller' : 'Verrouiller'} disabled={!hasSelection} active={isLocked}>
          {isLocked
            ? <Lock className="w-5 h-5" strokeWidth={1.6} />
            : <Unlock className="w-5 h-5" strokeWidth={1.6} />}
          <span className="text-editor-2xs">{isLocked ? 'Déverr.' : 'Verrou.'}</span>
        </ToolBtn>
      </div>

      <Divider />

      {/* ── Calques ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel adminMode={adminMode}>Calques</SectionLabel>
        <ToolBtn onClick={onBringForward} title="Avancer" disabled={!hasSelection}>
          <ChevronUp className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs">Avant</span>
        </ToolBtn>
        <ToolBtn onClick={onSendBackward} title="Reculer" disabled={!hasSelection}>
          <ChevronDown className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs">Arrière</span>
        </ToolBtn>
      </div>

      <Divider />

      {/* ── Aligner ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel adminMode={adminMode}>Aligner</SectionLabel>
        <ToolBtn onClick={onCenterH} title="Centrer horizontalement" ariaLabel="Centrer horizontalement" disabled={!hasSelection}>
          <AlignCenterVertical className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs whitespace-nowrap" aria-hidden="true">Centrer ↔</span>
        </ToolBtn>
        <ToolBtn onClick={onCenterV} title="Centrer verticalement" ariaLabel="Centrer verticalement" disabled={!hasSelection}>
          <AlignCenterHorizontal className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs whitespace-nowrap" aria-hidden="true">Centrer ↕</span>
        </ToolBtn>
      </div>

      <Divider />

      {/* ── Supprimer ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <ToolBtn onClick={onDeleteSelected} title="Effacer (Suppr)" disabled={!hasSelection} danger>
          <Trash2 className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-editor-2xs">Effacer</span>
        </ToolBtn>
      </div>
    </aside>
  );
}
