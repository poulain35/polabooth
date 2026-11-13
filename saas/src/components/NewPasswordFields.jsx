import { Input } from './ui/input';
import { Label } from './ui/label';
import { PASSWORD_MIN_LENGTH } from '../lib/passwordRules';

/** Nouveau mot de passe + confirmation (page de réinitialisation et Paramètres). */
export default function NewPasswordFields({ idPrefix, password, confirmation, onPassword, onConfirmation, autoFocus = false }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-new`}>Nouveau mot de passe</Label>
        <Input
          id={`${idPrefix}-new`} type="password" value={password} required autoFocus={autoFocus}
          autoComplete="new-password"
          onChange={(e) => onPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{PASSWORD_MIN_LENGTH} caractères au minimum.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-confirm`}>Confirmation</Label>
        <Input
          id={`${idPrefix}-confirm`} type="password" value={confirmation} required
          autoComplete="new-password"
          onChange={(e) => onConfirmation(e.target.value)}
        />
      </div>
    </>
  );
}
