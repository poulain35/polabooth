import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { fr } from 'react-day-picker/locale';
import 'react-day-picker/style.css';

const pad = (n) => String(n).padStart(2, '0');

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => {
  const s = new Date(2000, i, 1).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
});

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

/** Parse "YYYY-MM-DD" ou "YYYY-MM-DDTHH:MM" en Date locale (sans ambiguïté de fuseau). */
function parseValue(value) {
  if (!value) return undefined;
  const [datePart, timePart] = value.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart ? timePart.split(':').map(Number) : [0, 0];
  if (!y || !mo || !d) return undefined;
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

/** Sérialise une date (+ heure optionnelle) au format attendu par la base. */
function serialize(date, hour, minute, showTime) {
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return showTime ? `${base}T${pad(hour)}:${pad(minute)}` : base;
}

function formatDisplay(date, showTime) {
  if (!date) return null;
  const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
  if (showTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return date.toLocaleString('fr-FR', opts);
}

// ── Sélecteur d'heure à chevrons (HH : MM) ────────────────────────────────────
function Chevron({ up }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={up ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
    </svg>
  );
}

function StepColumn({ value, onUp, onDown }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" onClick={onUp} className="text-gray-400 hover:text-violet-600 transition-colors">
        <Chevron up />
      </button>
      <span className="text-xl font-semibold text-gray-800 tabular-nums w-9 text-center">{value}</span>
      <button type="button" onClick={onDown} className="text-gray-400 hover:text-violet-600 transition-colors">
        <Chevron />
      </button>
    </div>
  );
}

function TimeStepper({ hour, minute, onChange }) {
  const setHour   = (h) => onChange((h + 24) % 24, minute);
  const setMinute = (m) => onChange(hour, (m + 60) % 60);
  return (
    <div className="flex items-center justify-center gap-3 py-1 select-none">
      <StepColumn value={pad(hour)}   onUp={() => setHour(hour + 1)}     onDown={() => setHour(hour - 1)} />
      <span className="text-xl font-semibold text-gray-300 pb-0.5">:</span>
      <StepColumn value={pad(minute)} onUp={() => setMinute(minute + 1)} onDown={() => setMinute(minute - 1)} />
    </div>
  );
}

// ── Vues de sélection mois / année ────────────────────────────────────────────
function SideChevron({ next }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={next ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
    </svg>
  );
}

function ViewHeader({ label, onPrev, onNext, onLabelClick }) {
  const navBtn = 'w-9 h-9 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors';
  return (
    <div className="flex items-center justify-between h-10 mb-1.5">
      <button type="button" onClick={onPrev} className={navBtn}><SideChevron /></button>
      {onLabelClick ? (
        <button type="button" onClick={onLabelClick}
          className="px-2 py-0.5 rounded-md text-[15px] font-semibold text-gray-900 hover:bg-gray-100 transition-colors">
          {label}
        </button>
      ) : (
        <span className="text-[15px] font-semibold text-gray-900">{label}</span>
      )}
      <button type="button" onClick={onNext} className={navBtn}><SideChevron next /></button>
    </div>
  );
}

function GridCell({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2.5 rounded-lg text-sm font-medium text-center transition-colors
        ${selected ? 'bg-violet-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
    >
      {label}
    </button>
  );
}

function MonthGrid({ month, selectedDate, onPick, onYear, onNavYear }) {
  const year = month.getFullYear();
  return (
    <div className="min-w-[276px] px-1">
      <ViewHeader label={year} onPrev={() => onNavYear(-1)} onNext={() => onNavYear(1)} onLabelClick={onYear} />
      <div className="grid grid-cols-3 gap-1.5 pt-1">
        {MONTH_LABELS.map((m, i) => (
          <GridCell
            key={i}
            label={m}
            selected={!!selectedDate && selectedDate.getFullYear() === year && selectedDate.getMonth() === i}
            onClick={() => onPick(i)}
          />
        ))}
      </div>
    </div>
  );
}

function YearGrid({ month, selectedDate, onPick, onNavDecade }) {
  const start = Math.floor(month.getFullYear() / 10) * 10;
  const years = Array.from({ length: 10 }, (_, i) => start + i);
  return (
    <div className="min-w-[276px] px-1">
      <ViewHeader label={`${start} - ${start + 9}`} onPrev={() => onNavDecade(-10)} onNext={() => onNavDecade(10)} />
      <div className="grid grid-cols-2 gap-1.5 pt-1">
        {years.map((y) => (
          <GridCell
            key={y}
            label={y}
            selected={!!selectedDate && selectedDate.getFullYear() === y}
            onClick={() => onPick(y)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Sélecteur de date unifié.
 * @param showTime  affiche le sélecteur d'heure et sérialise avec HH:MM (défaut true).
 *                  Si false : date seule, format "YYYY-MM-DD".
 */
export default function DateTimePicker({ value, onChange, min, label, placeholder = 'Choisir une date', showTime = true }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('days'); // 'days' | 'months' | 'years'
  const [month, setMonth] = useState(() => startOfMonth(parseValue(value) ?? new Date()));
  const ref = useRef(null);

  const selected = parseValue(value);
  const [hour, setHour]     = useState(() => selected?.getHours()   ?? 12);
  const [minute, setMinute] = useState(() => selected?.getMinutes() ?? 0);

  useEffect(() => {
    const d = parseValue(value);
    if (d) { setHour(d.getHours()); setMinute(d.getMinutes()); }
  }, [value]);

  // À l'ouverture : repartir sur la vue jours, centrée sur la valeur courante
  function toggleOpen() {
    if (!open) {
      setView('days');
      setMonth(startOfMonth(parseValue(value) ?? new Date()));
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function handleDaySelect(day) {
    if (!day) { onChange(''); return; }
    onChange(serialize(day, hour, minute, showTime));
    if (!showTime) setOpen(false);
  }

  function handleTimeChange(h, m) {
    setHour(h); setMinute(m);
    if (selected) onChange(serialize(selected, h, m, showTime));
  }

  function navYear(delta) {
    setMonth((d) => new Date(d.getFullYear() + delta, d.getMonth(), 1));
  }
  function pickMonth(i) { setMonth((d) => new Date(d.getFullYear(), i, 1)); setView('days'); }
  function pickYear(y)  { setMonth((d) => new Date(y, d.getMonth(), 1)); setView('months'); }

  const minDate = min ? parseValue(min) : undefined;

  return (
    <div ref={ref} className="relative">
      {label && <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>}

      {/* Champ déclencheur */}
      <button
        type="button"
        onClick={toggleOpen}
        className={`w-full flex items-center gap-2 text-sm border rounded-lg px-3 py-2 text-left outline-none
          transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100
          ${open ? 'border-violet-400 ring-2 ring-violet-100' : 'border-gray-200'}
          ${selected ? 'text-gray-800' : 'text-gray-400'}`}
      >
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="flex-1">{selected ? formatDisplay(selected, showTime) : placeholder}</span>
        {selected && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="text-gray-300 hover:text-gray-500 transition-colors leading-none"
          >
            ✕
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div className="pola-calendar absolute z-50 mt-1 bg-card border border-gray-200 rounded-xl shadow-lg p-3 min-w-[300px]">
          {view === 'days' && (
            <DayPicker
              mode="single"
              navLayout="around"
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              onSelect={handleDaySelect}
              locale={fr}
              disabled={minDate ? { before: minDate } : undefined}
              components={{
                CaptionLabel: () => (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setView('months')}
                      className="px-1.5 py-0.5 rounded-md text-[15px] font-semibold text-gray-900 capitalize hover:bg-gray-100 transition-colors"
                    >
                      {month.toLocaleDateString('fr-FR', { month: 'long' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('years')}
                      className="px-1.5 py-0.5 rounded-md text-[15px] font-semibold text-gray-900 hover:bg-gray-100 transition-colors"
                    >
                      {month.getFullYear()}
                    </button>
                  </span>
                ),
              }}
            />
          )}

          {view === 'months' && (
            <MonthGrid
              month={month}
              selectedDate={selected}
              onPick={pickMonth}
              onYear={() => setView('years')}
              onNavYear={navYear}
            />
          )}

          {view === 'years' && (
            <YearGrid
              month={month}
              selectedDate={selected}
              onPick={pickYear}
              onNavDecade={navYear}
            />
          )}

          {showTime && view === 'days' && (
            <div className="border-t border-gray-100 mt-1 pt-3">
              <TimeStepper hour={hour} minute={minute} onChange={handleTimeChange} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
