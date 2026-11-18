#!/usr/bin/env bash
# Programme d'installation du SaaS (macOS, Linux) : bash saas/installer.sh
# Vérifie Node.js et instance.env, fait l'essai (--dry-run), puis lance l'installation si vous le confirmez.
# Guide pas à pas : docs/guide-installation.html
set -eu
cd "$(dirname "$0")"

pause() {
  printf '\nAppuyez sur Entrée pour fermer… '
  read -r _ || true
}

fail() {
  printf '\n' >&2
  printf '%s\n' "$@" >&2
  pause
  exit 1
}

ask() {
  # ask "Question ? (o/N) " : vrai si la réponse commence par o ou y.
  local answer=""
  read -r -p "$1" answer || true
  case "$answer" in [oOyY]*) return 0 ;; *) return 1 ;; esac
}

printf '\n==============================================\n'
printf '  Installation du SaaS Polabooth\n'
printf '==============================================\n\n'

# 1. Node.js 20 ou plus récent
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js est introuvable sur cet ordinateur." \
    "Installez la version LTS depuis https://nodejs.org/fr/download (macOS : ou « brew install node »)," \
    "puis relancez ce programme. Détails : étape 1 de docs/guide-installation.html"
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
  fail "Node.js version $major est trop ancienne : il faut la version 20 ou plus récente." \
    "Installez la version LTS depuis https://nodejs.org/fr/download, puis relancez ce programme."
fi
echo "Node.js version $major : OK."

# 2. Fichier de configuration instance.env
if [ ! -f instance.env ]; then
  for dir in "$HOME/Downloads" "$HOME/Téléchargements"; do
    if [ -f "$dir/instance.env" ]; then
      echo "Le fichier instance.env est dans $dir."
      if ask "Le déplacer dans le dossier saas ? (o/N) "; then
        mv "$dir/instance.env" instance.env
        echo "Fichier déplacé."
      fi
      break
    fi
  done
fi
if [ ! -f instance.env ]; then
  fail "Le fichier instance.env est introuvable dans ce dossier :" "  $(pwd)" "" \
    "Pour le créer :" \
    "  1. ouvrez docs/guide-installation.html dans votre navigateur ;" \
    "  2. remplissez les étapes 3 à 6, puis cliquez sur « Télécharger instance.env » ;" \
    "  3. placez le fichier dans le dossier ci-dessus, sous le nom exact instance.env ;" \
    "  4. relancez ce programme."
fi
echo "Fichier instance.env : trouvé."

# 3. Outils du projet
if [ ! -d node_modules ]; then
  printf '\nPréparation des outils : quelques minutes la première fois…\n\n'
  npm ci || fail "La préparation des outils a échoué : vérifiez la connexion Internet, puis relancez."
fi

# 4. Essai sans modification
printf '\n----------------------------------------------\n'
printf ' Essai : vérification de la configuration,\n'
printf ' email de test, stockage. Rien n'"'"'est modifié.\n'
printf -- '----------------------------------------------\n\n'
npm run install-instance -- --dry-run || fail "L'essai a trouvé un problème : lisez le message ci-dessus." \
  "Corrigez instance.env, ou retéléchargez-le depuis l'étape 6 du guide, puis relancez."

# 5. Installation
echo
if ! ask "Lancer l'installation maintenant ? (O/N) "; then
  echo "Installation non lancée. Relancez ce programme quand vous serez prêt."
  pause
  exit 0
fi
echo
npm run install-instance || fail "L'installation s'est arrêtée : lisez le message ci-dessus, corrigez, puis relancez." \
  "Les étapes déjà faites ne sont pas refaites."

printf '\n==============================================\n'
printf ' Installation terminée.\n'
printf " Notez le mot de passe de l'administrateur affiché plus haut,\n"
printf ' puis mettez en ligne le dossier dist : étape 8 du guide.\n'
printf '==============================================\n'
pause
