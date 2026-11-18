import { Download, Users } from 'lucide-react';
import { exportReminderBadge, exportReminderDetail } from '../../lib/guestExportReminder';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { IconCircle } from '../ui/icon-circle';
import { StatusPill } from '../ui/status-pill';

/** Bandeau « Contacts à exporter » en haut de l'onglet Questionnaire (LAB-224). `reminder` : guestExportReminder(). */
export default function GuestExportReminderBanner({ reminder }) {
  if (!reminder) return null;
  const { urgent } = reminder;

  function goToExport() {
    document.getElementById('guest-export')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <Card role="status" tone={urgent ? 'rose' : 'mint'} className="flex flex-wrap items-center gap-3 p-card">
      <IconCircle tone="white"><Users /></IconCircle>
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-medium text-foreground">{exportReminderDetail(reminder)}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {reminder.newSinceExport
            ? 'De nouvelles réponses sont arrivées depuis le dernier export.'
            : 'Exportez le fichier puis envoyez-le au client avant cette date.'}
        </p>
      </div>
      <StatusPill tone="white">{exportReminderBadge(reminder)}</StatusPill>
      <Button size="sm" onClick={goToExport} className="shrink-0">
        <Download /> Exporter
      </Button>
    </Card>
  );
}
