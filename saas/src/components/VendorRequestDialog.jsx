// Demande à l'éditeur du logiciel (spec connecteurs-facturation §6) : prépare un email dans la messagerie
// de la personne. Aucun appel réseau, rien en base. `topic` : `connector` ou `module:<id>` (LAB-384).
import { useState } from 'react';
import { Check, Copy, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import {
  MESSAGE_MAX_LENGTH, TOOL_MAX_LENGTH, VENDOR_EMAIL, buildVendorMailto, validateVendorRequest,
} from '../lib/vendorRequest';

export default function VendorRequestDialog({
  open, onOpenChange, topic = 'connector', defaultTool = '', title = 'Demander un autre connecteur',
  description = 'Dites quel outil vous utilisez : la demande arrive à l\'éditeur du logiciel, qui vous répond par email.',
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <VendorRequestForm topic={topic} defaultTool={defaultTool} />
      </DialogContent>
    </Dialog>
  );
}

function VendorRequestForm({ topic, defaultTool }) {
  const [tool, setTool] = useState(defaultTool);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [copied, setCopied] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    const req = validateVendorRequest({ tool, message });
    setErrors(req.errors);
    if (!req.valid) return;
    window.location.href = buildVendorMailto({
      tool: req.tool, message: req.message, topic,
      origin: window.location.origin, version: import.meta.env.VITE_APP_VERSION,
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(VENDOR_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copie impossible : sélectionnez l\'adresse à la main.');
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vendor-request-tool">Outil voulu</Label>
        <Input
          id="vendor-request-tool" value={tool} maxLength={TOOL_MAX_LENGTH} placeholder="Ex. Axonaut"
          onChange={(e) => setTool(e.target.value)} aria-invalid={!!errors.tool}
        />
        {errors.tool && <p className="text-[13px] text-destructive" role="alert">{errors.tool}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vendor-request-message">Message (facultatif)</Label>
        <Textarea
          id="vendor-request-message" rows={4} value={message} maxLength={MESSAGE_MAX_LENGTH}
          onChange={(e) => setMessage(e.target.value)} aria-invalid={!!errors.message}
        />
        {errors.message && <p className="text-[13px] text-destructive" role="alert">{errors.message}</p>}
      </div>

      <div>
        <Button type="submit"><Mail aria-hidden="true" />Préparer l'email</Button>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Votre messagerie s'ouvre avec la demande préremplie. Rien ne part tant que vous ne l'envoyez pas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4">
        <p className="text-[13px] text-muted-foreground">
          Messagerie qui ne s'ouvre pas ? Écrivez à{' '}
          <span className="select-all font-medium text-foreground">{VENDOR_EMAIL}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy} aria-live="polite">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copié' : 'Copier'}
        </Button>
      </div>
    </form>
  );
}
