// Appels de send-event-report faits sous le JWT de l'admin (LAB-238), à part de l'index qui écrit
// email_logs (là, seul adminClient est permis : test LAB-125). Deux appels, rien d'autre :
//   - build_event_report(p_freeze => true) : auth.uid() doit être l'admin (sous service_role : 42501) ;
//   - selected_photo_ids : seule colonne que authenticated peut modifier (avec status).
import { userClient } from '../_shared/auth.ts';

export function adminJwtCalls(authHeader: string, eventId: string) {
  const userDb = userClient(authHeader);
  return {
    freeze: () => userDb.rpc('build_event_report', { p_event_id: eventId, p_freeze: true }),
    saveSelection: (ids: string[]) => userDb.from('event_reports').update({ selected_photo_ids: ids }).eq('event_id', eventId),
  };
}
