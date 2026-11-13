# Sécurité

## Signaler une faille

Ne signalez pas une faille de sécurité dans une issue, une discussion ou une pull request
publique.

Utilisez le signalement privé de GitHub :

1. ouvrez l'onglet **Security** du dépôt ;
2. cliquez sur **Report a vulnerability** ;
3. décrivez la faille : la partie touchée (SaaS, fonction serveur, base de données, borne), les
   étapes pour la reproduire, ce qu'un attaquant peut obtenir, et si possible une piste de
   correction.

Seuls les mainteneurs voient ce signalement. Nous vous répondons dès que possible. Une fois la
faille corrigée et la correction publiée, l'avis de sécurité est rendu public. Votre nom y est cité
si vous le souhaitez.

## Ce qui nous intéresse

- accès aux données d'un autre compte (événements, photos, designs, réponses des invités) ;
- contournement des règles d'accès de la base (RLS) ou des contrôles des fonctions serveur ;
- borne qui accepte une licence, un code ou un fichier `.pola` qu'elle devrait refuser ;
- fuite d'un secret (clé `service_role`, clés de stockage, mots de passe SMTP) dans le site ou
  l'installeur de la borne ;
- exécution de code ou injection (XSS, SQL) depuis une page publique (design client, galerie).

## Hors périmètre

- les failles d'une instance précise mal configurée (clé publiée par son propriétaire, bucket ouvert
  en écriture…) : signalez-les à la personne qui gère cette instance ;
- les failles des services tiers (Supabase, fournisseur de stockage, GitHub) : signalez-les à leur
  éditeur ;
- les attaques qui demandent un accès physique déjà ouvert au PC de la borne (session Windows
  déverrouillée, écran d'administration ouvert).

## Versions concernées

Seule la dernière version publiée sur la branche principale reçoit des correctifs de sécurité.
Pensez à mettre à jour votre SaaS (`git pull`, puis `npm run install-instance`) et vos bornes.

## Version anglaise / English

Please do not report security issues in public issues, discussions or pull requests. Use GitHub
private reporting instead: **Security** tab of this repository, then **Report a vulnerability**.
Describe the affected part, the steps to reproduce and the impact. Only the maintainers can see
the report. The advisory is made public once a fix is released.
