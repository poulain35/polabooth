## Ce que change cette pull request

<!-- Le problème, la solution, et l'issue liée (« Corrige #123 »). -->

## Comment je l'ai testée

<!-- Tests ajoutés, essais à la main, matériel utilisé pour la borne (appareil photo, imprimante). -->

## Vérifications

- [ ] SaaS : `npm run lint`, `npm test`, `VITE_PRIVATE_MODULES=none npm run build` et `npm run check:open-build` passent (si `saas/` est touché).
- [ ] Borne : `dotnet build` et `dotnet test` passent sur `kiosk/PolaKiosk.slnx` (si `kiosk/` est touché).
- [ ] Les textes affichés sont en français, les noms dans le code en anglais.
- [ ] Un changement de schéma a sa migration dans `saas/supabase/migrations/`, vérifiée pour le SaaS et la borne.
- [ ] Un changement qui touche l'installation met à jour `docs/installation*.md`.
- [ ] Aucun secret, fichier `.env`, `appsettings.local.json` ni DLL Canon EDSDK n'est commité.
- [ ] J'ai lu `CONTRIBUTING.md` et j'accepte le CLA (`CLA.md`) : le robot vous demandera de le confirmer en commentaire.
