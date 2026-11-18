// LAB-243 : page /associer. L'admin scanne le QR affiché par une borne (ou tape son code), nomme
// la borne et l'associe à son compte. Connexion obligatoire (RequireAuth withNext dans App.jsx).
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Monitor } from 'lucide-react';
import {
  lookupPairing, approvePairing, fetchLicenses, fetchKioskAccounts, isAppAdmin,
  setKioskAdminPin, pushKioskAdminPin,
} from '../lib/supabase';
import {
  normalizePairingCode, pairingCodeProblem, pairingCodeHint, formatPairingCode, minutesLeft,
  lookupStatusMessage, approveResultMessage, pairingErrorMessage, pairingFollowState,
  suggestedKioskLabel, isRateLimitError, MSG_EXPIRED,
  PAIRING_POLL_INTERVAL_MS, PAIRING_POLL_TIMEOUT_MS,
} from '../lib/kioskPairing';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select';
import ProductLogo from '../components/ProductLogo';
import useProductFavicon from '../hooks/useProductFavicon';
import { kioskName } from '../lib/kioskLogs';

const NEW_KIOSK = 'new';

function ErrorBox({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-state-red px-3 py-2.5 text-sm text-state-red-fg">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Écran après « Associer » : attend que la borne récupère son secret. */
function PairingDone({ code, result, pinWarning, onAgain }) {
  const [follow, setFollow] = useState('waiting'); // waiting | connected | stopped | timeout

  useEffect(() => {
    let alive = true;
    let timer = null;
    const deadline = Date.now() + PAIRING_POLL_TIMEOUT_MS;

    async function poll() {
      try {
        const res = await lookupPairing(code);
        if (!alive) return;
        const state = pairingFollowState(res?.status);
        if (state !== 'waiting') { setFollow(state); return; }
      } catch (err) {
        if (!alive) return;
        // Trop d'essais faux sur ce compte : inutile d'insister, la borne se connecte quand même.
        if (isRateLimitError(err)) { setFollow('timeout'); return; }
      }
      if (Date.now() >= deadline) { setFollow('timeout'); return; }
      timer = setTimeout(poll, PAIRING_POLL_INTERVAL_MS);
    }

    timer = setTimeout(poll, PAIRING_POLL_INTERVAL_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [code]);

  const modeLine = {
    resumed:  'Ce PC était déjà connu : la borne garde son historique.',
    replaced: 'Le nouveau PC remplace l’ancien : la borne garde son nom, sa couleur et son planning.',
    moved:    `Borne déplacée vers le compte ${result.org_name ?? ''}.`,
  }[result.mode];

  return (
    <Card className="w-full p-6 space-y-5">
      {follow === 'connected' ? (
        <div className="text-center space-y-2">
          <CheckCircle2 className="w-12 h-12 mx-auto text-state-green-fg" />
          <h2 className="text-xl font-medium text-foreground">Borne connectée ✓</h2>
          <p className="text-sm text-muted-foreground">« {result.label} » est prête.</p>
        </div>
      ) : (
        <div className="text-center space-y-2">
          {follow === 'waiting'
            ? <Loader2 className="w-10 h-10 mx-auto text-primary animate-spin" />
            : <Monitor className="w-10 h-10 mx-auto text-muted-foreground" />}
          <h2 className="text-lg font-medium text-foreground">
            C'est fait : la borne affiche le nom « {result.label} » dans quelques secondes
          </h2>
          {follow === 'timeout' && (
            <p className="text-sm text-state-amber-fg">
              La borne n'a pas encore confirmé. Vérifiez qu'elle est allumée et connectée à internet :
              elle se connectera dès son retour en ligne.
            </p>
          )}
          {follow === 'stopped' && (
            <p className="text-sm text-destructive">
              La demande a été annulée sur la borne. Elle affiche un nouveau code : recommencez avec celui-ci.
            </p>
          )}
        </div>
      )}

      {modeLine && <p className="text-xs text-muted-foreground text-center">{modeLine}</p>}
      {pinWarning && <ErrorBox>{pinWarning}</ErrorBox>}

      <div className="flex flex-col gap-2">
        {/* LAB-245 : section « Événement sur la borne » de sa carte, page Licences. */}
        <Button size="lg" asChild className="w-full">
          <Link to={result?.license_id ? `/admin/bornes#envoyer-${result.license_id}` : '/admin/bornes'}>
            Envoyer un événement sur cette borne
          </Link>
        </Button>
        <Button size="lg" asChild variant="outline" className="w-full">
          <Link to="/admin/bornes">Voir mes bornes</Link>
        </Button>
        <Button variant="ghost" className="w-full" onClick={onAgain}>Associer une autre borne</Button>
      </div>
    </Card>
  );
}

export default function AdminPair() {
  useProductFavicon();
  const [params, setParams] = useSearchParams();
  const [codeInput, setCodeInput] = useState(params.get('code') ?? '');
  const code = normalizePairingCode(codeInput);
  const problem = pairingCodeProblem(code);

  // Contexte du compte
  const [superAdmin, setSuperAdmin] = useState(false);
  const [accounts,   setAccounts]   = useState([]);
  const [ownOrgId,   setOwnOrgId]   = useState(null);
  const [licenses,   setLicenses]   = useState([]);

  // Code reconnu
  const [lookup,     setLookup]     = useState(null);   // réponse pending de kiosk_pairing_lookup
  const [checking,   setChecking]   = useState(false);
  const [codeError,  setCodeError]  = useState('');
  const [now,        setNow]        = useState(() => Date.now());

  // Formulaire
  const [label,      setLabel]      = useState('');
  const labelTouched = useRef(false);
  const [pin,        setPin]        = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [replaceId,  setReplaceId]  = useState(params.get('replace') ?? NEW_KIOSK);
  const [orgId,      setOrgId]      = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError,  setFormError]  = useState('');

  // Après « Associer »
  const [done,       setDone]       = useState(null);   // { code, result, pinWarning }

  useEffect(() => {
    isAppAdmin().then(setSuperAdmin).catch(() => {});
    fetchKioskAccounts()
      .then(({ accounts: list, ownOrgId: own }) => { setAccounts(list); setOwnOrgId(own); setOrgId(own); })
      .catch(() => {});
    fetchLicenses({ includeRetired: true }).then(setLicenses).catch(() => {});
  }, []);

  // Le code reste dans l'adresse : un rechargement ou un retour de connexion le garde.
  useEffect(() => {
    const current = params.get('code') ?? '';
    if (normalizePairingCode(current) === code) return;
    const next = new URLSearchParams(params);
    if (code) next.set('code', code); else next.delete('code');
    setParams(next, { replace: true });
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vérification dès que le code a ses 6 signes valides.
  useEffect(() => {
    setLookup(null);
    setCodeError('');
    setFormError('');
    if (problem) return;
    let alive = true;
    setChecking(true);
    lookupPairing(code)
      .then((res) => {
        if (!alive) return;
        const message = lookupStatusMessage(res?.status);
        if (message) { setCodeError(message); return; }
        setLookup(res);
        if (!labelTouched.current) setLabel(suggestedKioskLabel(res));
      })
      .catch((err) => { if (alive) setCodeError(pairingErrorMessage(err)); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [code, problem]);

  // Compte à rebours « Code valable encore N min ».
  useEffect(() => {
    if (!lookup) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [lookup]);

  const left = lookup ? minutesLeft(lookup.expires_at, now) : 0;
  const expired = !!lookup && left === 0;

  const targetOrgId = orgId ?? ownOrgId;
  const replaceChoices = licenses.filter((l) => !targetOrgId || l.org_id === targetOrgId);
  const replaceValue = replaceId !== NEW_KIOSK && replaceChoices.some((l) => l.id === replaceId) ? replaceId : NEW_KIOSK;
  const showAccounts = superAdmin && accounts.length > 1;

  const pinTyped = pin.length > 0;
  const pinValid = !pinTyped || (/^\d{4,8}$/.test(pin) && pin === pinConfirm);
  const canSubmit = !!lookup && !expired && label.trim().length > 0 && pinValid && !submitting;

  const digitsOnly = (v) => v.replace(/\D/g, '').slice(0, 8);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError('');
    try {
      const result = await approvePairing({
        code,
        label: label.trim(),
        replaceLicenseId: replaceValue === NEW_KIOSK ? null : replaceValue,
        orgId: superAdmin && orgId && orgId !== ownOrgId ? orgId : null,
      });
      const refusal = approveResultMessage(result);
      if (refusal) {
        // Code devenu inutilisable : le formulaire disparaît, le message va sous le code.
        if (['expired', 'used', 'cancelled', 'not_found'].includes(result?.status)) {
          setLookup(null);
          setCodeError(refusal);
        } else {
          setFormError(refusal);
        }
        return;
      }

      // PIN facultatif : envoyé une fois la borne créée, par la fonction kiosk-admin-pin.
      let pinWarning = null;
      if (pinTyped) {
        try {
          await setKioskAdminPin(result.license_id, pin);
          await pushKioskAdminPin(result.license_id);
        } catch (err) {
          pinWarning = `La borne est associée, mais le PIN n'a pas pu être envoyé (${err.message}). `
            + 'Définissez-le depuis « Mes bornes ».';
        }
      }
      setPin(''); setPinConfirm('');
      setDone({ code, result, pinWarning });
    } catch (err) {
      setFormError(pairingErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function startAgain() {
    setDone(null);
    setLookup(null);
    setCodeInput('');
    setLabel('');
    labelTouched.current = false;
    setReplaceId(NEW_KIOSK);
    setFormError('');
  }

  const inlineHint = problem === 'ambiguous' || problem === 'too_long' ? pairingCodeHint(code) : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 flex items-center justify-between max-w-md w-full mx-auto">
        <ProductLogo className="h-8 w-auto" />
        <Link to="/admin/bornes" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Mes bornes
        </Link>
      </header>

      <main className="flex-1 px-4 pb-10 max-w-md w-full mx-auto space-y-4">
        <div>
          <h1 className="text-page-title text-foreground">Associer une borne</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scannez le QR code affiché sur la borne, ou tapez le code à 6 caractères.
          </p>
        </div>

        {done ? (
          <PairingDone code={done.code} result={done.result} pinWarning={done.pinWarning} onAgain={startAgain} />
        ) : (
          <>
            <Card className="p-5 space-y-3">
              <Label htmlFor="pairing-code">Code de la borne</Label>
              <Input
                id="pairing-code"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="K7M-4QP"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                maxLength={12}
                className="h-12 text-center text-2xl font-mono tracking-widest uppercase"
              />
              {checking && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Vérification du code…
                </p>
              )}
              {inlineHint && <p className="text-sm text-state-amber-fg">{inlineHint}</p>}
              <ErrorBox>{codeError}</ErrorBox>

              {lookup && (
                <div className="rounded-xl bg-soft px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {lookup.machine_name || 'PC sans nom'}
                    </span>
                    {lookup.app_version && (
                      <span className="text-xs font-mono text-muted-foreground">v{lookup.app_version}</span>
                    )}
                  </div>
                  <p className={`text-xs ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
                    Code {formatPairingCode(code)} · {expired ? MSG_EXPIRED : `Code valable encore ${left} min`}
                  </p>
                  {lookup.license && (
                    <p className="text-xs text-muted-foreground">
                      Ce PC est déjà la borne « {lookup.license.label || 'sans nom'} »
                      {lookup.license.retired ? ' (retirée) : elle sera réactivée.' : ' : elle sera reprise.'}
                    </p>
                  )}
                </div>
              )}
            </Card>

            {lookup && (
              <Card className="p-5">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="kiosk-label">Nom de la borne</Label>
                    <Input
                      id="kiosk-label"
                      value={label}
                      required
                      maxLength={80}
                      onChange={(e) => { labelTouched.current = true; setLabel(e.target.value); }}
                      placeholder="ex : Borne 1"
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Remplacer une borne existante</Label>
                    <Select value={replaceValue} onValueChange={setReplaceId}>
                      <SelectTrigger className="h-11" aria-label="Remplacer une borne existante">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NEW_KIOSK}>Non, c'est une nouvelle borne</SelectItem>
                        {replaceChoices.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            Remplacer {kioskName(l)}{l.retired_at ? ' (retirée)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Pour un PC changé ou réinstallé : la borne garde son nom, sa couleur et son planning.
                    </p>
                  </div>

                  {showAccounts && (
                    <div className="space-y-1.5">
                      <Label>Compte</Label>
                      <Select value={orgId ?? ''} onValueChange={(v) => { setOrgId(v); setReplaceId(NEW_KIOSK); }}>
                        <SelectTrigger className="h-11" aria-label="Compte">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.name || 'Compte sans nom'}{o.id === ownOrgId ? ' (mon compte)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="kiosk-pin">Code PIN admin (facultatif)</Label>
                    <Input
                      id="kiosk-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      value={pin}
                      onChange={(e) => setPin(digitsOnly(e.target.value))}
                      placeholder="4 à 8 chiffres"
                      className="h-11 font-mono"
                    />
                    {pinTyped && (
                      <Input
                        type="password"
                        inputMode="numeric"
                        autoComplete="new-password"
                        value={pinConfirm}
                        onChange={(e) => setPinConfirm(digitsOnly(e.target.value))}
                        placeholder="Confirmer le PIN"
                        aria-label="Confirmer le PIN"
                        className="h-11 font-mono"
                      />
                    )}
                    {pinTyped && pin.length < 4 && (
                      <p className="text-xs text-state-amber-fg">Le PIN compte 4 à 8 chiffres.</p>
                    )}
                    {pin.length >= 4 && pinConfirm.length >= 4 && pin !== pinConfirm && (
                      <p className="text-xs text-destructive">Les deux PIN ne correspondent pas.</p>
                    )}
                    {!pinTyped && (
                      <p className="text-xs text-muted-foreground">Vide : la borne garde son PIN actuel.</p>
                    )}
                  </div>

                  <ErrorBox>{formError}</ErrorBox>

                  <Button size="xl" type="submit" className="w-full" disabled={!canSubmit}>
                    {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Association…</> : 'Associer'}
                  </Button>
                </form>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
