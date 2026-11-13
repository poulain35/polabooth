import { useRef } from 'react';
import {
  LayoutGrid, Sticker, Sparkles, Image as ImageIcon, Type, Square, Circle, Minus,
  ImagePlus, Copy, Group, Ungroup, Lock, Unlock, ChevronUp, ChevronDown,
  AlignCenterHorizontal, AlignCenterVertical, Trash2,
} from 'lucide-react';

function ToolBtn({ onClick, title, active, danger, disabled, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 px-2 py-1.5 md:px-1 md:py-2 md:w-full
        rounded-xl transition-colors shrink-0
        ${active
          ? 'bg-primary/15 text-primary'
          : danger
            ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-25 disabled:cursor-not-allowed'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed'
        }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  // Vertical line on mobile, horizontal on desktop
  return <div className="w-px h-8 md:w-auto md:h-px bg-border shrink-0 mx-1 md:mx-2 md:my-1" />;
}

function SectionLabel({ children }) {
  return (
    <p className="hidden md:block text-[8px] font-semibold text-muted-foreground uppercase tracking-wider text-center mb-1">
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
}) {
  const fileInputRef = useRef(null);

  return (
    <aside className="
      flex flex-row md:flex-col items-center
      w-full md:w-[58px]
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
    ">

      {/* ── Panneaux ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel>Panneaux</SectionLabel>
        <ToolBtn onClick={onToggleTemplates} title="Modèles" active={activePanel === 'templates'}>
          <LayoutGrid className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px] font-medium">Modèles</span>
        </ToolBtn>
        <ToolBtn onClick={onToggleStickers} title="Stickers" active={activePanel === 'stickers'}>
          <Sticker className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px] font-medium">Stickers</span>
        </ToolBtn>
        {showAIBackground && (
          <ToolBtn onClick={onToggleAIBackground} title="Fond IA" active={activePanel === 'ai-background'}>
            <Sparkles className="w-5 h-5" fill="currentColor" strokeWidth={0} />
            <span className="text-[9px] font-medium">Fond IA</span>
          </ToolBtn>
        )}
      </div>

      <Divider />

      {/* ── Ajouter ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel>Ajouter</SectionLabel>
        <ToolBtn onClick={onAddPhotoZone} title="Ajouter une zone photo">
          <ImageIcon className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Photo</span>
        </ToolBtn>
        <ToolBtn onClick={onAddText} title="Ajouter du texte">
          <Type className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Texte</span>
        </ToolBtn>
        <ToolBtn onClick={onAddRect} title="Ajouter un rectangle">
          <Square className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Rect.</span>
        </ToolBtn>
        <ToolBtn onClick={onAddCircle} title="Ajouter un cercle">
          <Circle className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Cercle</span>
        </ToolBtn>
        <ToolBtn onClick={onAddLine} title="Ajouter une ligne">
          <Minus className="w-5 h-5 rotate-45" strokeWidth={1.6} />
          <span className="text-[9px]">Ligne</span>
        </ToolBtn>
        <ToolBtn onClick={() => fileInputRef.current?.click()} title="Importer une image">
          <ImagePlus className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Image</span>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onUploadImage} />
        </ToolBtn>
      </div>

      <Divider />

      {/* ── Sélection ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel>Sélection</SectionLabel>
        <ToolBtn onClick={onDuplicate} title="Dupliquer (Ctrl+D)" disabled={!hasSelection}>
          <Copy className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Dupliquer</span>
        </ToolBtn>
        {hasMultiSelection && (
          <ToolBtn onClick={onGroup} title="Grouper (Ctrl+G)">
            <Group className="w-5 h-5" strokeWidth={1.6} />
            <span className="text-[9px]">Grouper</span>
          </ToolBtn>
        )}
        {selectionIsGroup && (
          <ToolBtn onClick={onUngroup} title="Dégrouper (Ctrl+Shift+G)">
            <Ungroup className="w-5 h-5" strokeWidth={1.6} />
            <span className="text-[9px]">Dégrouper</span>
          </ToolBtn>
        )}
        <ToolBtn onClick={onToggleLock} title={isLocked ? 'Déverrouiller' : 'Verrouiller'} disabled={!hasSelection} active={isLocked}>
          {isLocked
            ? <Lock className="w-5 h-5" strokeWidth={1.6} />
            : <Unlock className="w-5 h-5" strokeWidth={1.6} />}
          <span className="text-[9px]">{isLocked ? 'Déverr.' : 'Verrou.'}</span>
        </ToolBtn>
      </div>

      <Divider />

      {/* ── Calques ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel>Calques</SectionLabel>
        <ToolBtn onClick={onBringForward} title="Avancer" disabled={!hasSelection}>
          <ChevronUp className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Avant</span>
        </ToolBtn>
        <ToolBtn onClick={onSendBackward} title="Reculer" disabled={!hasSelection}>
          <ChevronDown className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Arrière</span>
        </ToolBtn>
      </div>

      <Divider />

      {/* ── Aligner ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <SectionLabel>Aligner</SectionLabel>
        <ToolBtn onClick={onCenterH} title="Centrer horizontalement" disabled={!hasSelection}>
          <AlignCenterVertical className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Ctr H</span>
        </ToolBtn>
        <ToolBtn onClick={onCenterV} title="Centrer verticalement" disabled={!hasSelection}>
          <AlignCenterHorizontal className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Ctr V</span>
        </ToolBtn>
      </div>

      <Divider />

      {/* ── Supprimer ── */}
      <div className="flex flex-row md:flex-col items-center w-auto md:w-full px-0.5 md:px-1.5">
        <ToolBtn onClick={onDeleteSelected} title="Effacer (Suppr)" disabled={!hasSelection} danger>
          <Trash2 className="w-5 h-5" strokeWidth={1.6} />
          <span className="text-[9px]">Effacer</span>
        </ToolBtn>
      </div>
    </aside>
  );
}
