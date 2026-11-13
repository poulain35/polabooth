import { Download, Users } from 'lucide-react';
import { exportReminderBadge, exportReminderDetail } from '../../lib/guestExportReminder';
import { Button } from '../ui/button';

/** Bandeau « Contacts à exporter » en haut de l'onglet Questionnaire (LAB-224). `reminder` : guestExportReminder(). */
export default function GuestExportReminderBanner({ reminder }) {
  if (!reminder) return null;
  const { urgent } = reminder;

  function goToExport() {
    document.getElementById('guest-export')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div role="status"
      className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 shadow-sm ${urgent ? 'border-red-200 bg-red-50' : 'border-teal-200 bg-teal-50'}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${urgent ? 'bg-red-100 text-red-600' : 'bg-teal-100 text-teal-600'}`}>
        <Users className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-[12rem]">
        <p className="text-sm font-semibold text-gray-800">{exportReminderDetail(reminder)}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {reminder.newSinceExport
            ? 'De nouvelles réponses sont arrivées depuis le dernier export.'
            : 'Exportez le fichier puis envoyez-le au client avant cette date.'}
        </p>
      </div>
      <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${urgent ? 'bg-red-600 text-white' : 'bg-teal-100 text-teal-700'}`}>
        {exportReminderBadge(reminder)}
      </span>
      <Button size="sm" onClick={goToExport} className="rounded-xl shrink-0">
        <Download /> Exporter
      </Button>
    </div>
  );
}
