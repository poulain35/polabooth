@echo off
rem Programme d'installation du SaaS (Windows), a ouvrir par un double-clic.
rem Verifie Node.js et instance.env, fait l'essai (--dry-run), puis lance l'installation si vous le confirmez.
rem Guide pas a pas : docs/guide-installation.html
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Installation de Polabooth

echo.
echo  ==============================================
echo    Installation du SaaS Polabooth
echo  ==============================================
echo.

rem -- 1. Node.js 20 ou plus recent ------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto no_node
set "NODE_MAJOR="
for /f "tokens=1 delims=v." %%a in ('node --version') do set "NODE_MAJOR=%%a"
if not defined NODE_MAJOR goto no_node
if %NODE_MAJOR% LSS 20 goto old_node
echo  Node.js version %NODE_MAJOR% : OK.

rem -- 2. Fichier de configuration instance.env -------------------------------------------------
if exist "instance.env" goto have_env
if exist "%USERPROFILE%\Downloads\instance.env" goto offer_move
goto no_env

:offer_move
echo.
echo  Le fichier instance.env est dans votre dossier Téléchargements.
choice /c ON /n /m " Le déplacer dans le dossier saas ? (O/N) "
if errorlevel 2 goto no_env
move /y "%USERPROFILE%\Downloads\instance.env" "instance.env" >nul
if errorlevel 1 goto no_env
echo  Fichier déplacé.

:have_env
echo  Fichier instance.env : trouvé.

rem -- 3. Outils du projet --------------------------------------------------------------------
if exist "node_modules\" goto deps_ok
echo.
echo  Préparation des outils : quelques minutes la première fois...
echo.
call npm ci
if errorlevel 1 goto npm_failed

:deps_ok
rem -- 4. Essai sans modification -------------------------------------------------------------
echo.
echo  ----------------------------------------------
echo   Essai : vérification de la configuration,
echo   email de test, stockage. Rien n'est modifié.
echo  ----------------------------------------------
echo.
call npm run install-instance -- --dry-run
if errorlevel 1 goto dry_failed

rem -- 5. Installation ------------------------------------------------------------------------
echo.
choice /c ON /n /m " Lancer l'installation maintenant ? (O/N) "
if errorlevel 2 goto cancelled
echo.
call npm run install-instance
if errorlevel 1 goto install_failed
echo.
echo  ==============================================
echo   Installation terminée.
echo   Notez le mot de passe de l'administrateur affiché plus haut,
echo   puis mettez en ligne le dossier dist : étape 8 du guide.
echo  ==============================================
goto fin

rem -- Messages -------------------------------------------------------------------------------
:no_node
echo  Node.js est introuvable sur cet ordinateur.
goto node_help

:old_node
echo  Node.js version %NODE_MAJOR% est trop ancienne : il faut la version 20 ou plus récente.

:node_help
echo.
echo  Installez-le, puis relancez ce programme :
echo    - dans l'invite de commandes : winget install OpenJS.NodeJS.LTS Git.Git
echo    - ou depuis https://nodejs.org/fr/download , version LTS
echo  Détails : étape 1 de docs\guide-installation.html
echo.
choice /c ON /n /m " Ouvrir la page de téléchargement de Node.js ? (O/N) "
if errorlevel 2 goto fin
start "" "https://nodejs.org/fr/download"
goto fin

:no_env
echo.
echo  Le fichier instance.env est introuvable dans ce dossier :
echo    %CD%
echo.
echo  Pour le créer :
echo    1. ouvrez docs\guide-installation.html par un double-clic ;
echo    2. remplissez les étapes 3 à 6, puis cliquez sur « Télécharger instance.env » ;
echo    3. placez le fichier dans le dossier ci-dessus, sous le nom exact instance.env
echo       sans « (1) » ni « .txt » à la fin ;
echo    4. relancez ce programme.
goto fin

:npm_failed
echo.
echo  La préparation des outils a échoué : vérifiez la connexion Internet, puis relancez.
goto fin

:dry_failed
echo.
echo  L'essai a trouvé un problème : lisez le message ci-dessus.
echo  Corrigez instance.env, ou retéléchargez-le depuis l'étape 6 du guide, puis relancez.
goto fin

:install_failed
echo.
echo  L'installation s'est arrêtée : lisez le message ci-dessus, corrigez, puis relancez.
echo  Les étapes déjà faites ne sont pas refaites.
goto fin

:cancelled
echo.
echo  Installation non lancée. Relancez ce programme quand vous serez prêt.

:fin
echo.
endlocal
pause
