# Suivi du feedback et des audits UI/UX

Mis à jour le 19 novembre 2026. Synthèse de l’état courant ; les anciens comptes
rendus restent dans [RESUME_V2_PARITY.md](RESUME_V2_PARITY.md). Leurs mentions
« restant », « non déployé » ou « pending » peuvent décrire une étape historique
déjà terminée : elles ne constituent pas le backlog actuel.

## Nouvelle passe UI/UX et demande GPU automatique

### Feedback supplémentaire à intégrer au prochain lot discuté

- [x] Sortir les notes privées de Discussion : bouton/panneau dédiés, contenu
  local existant conservé et confidentialité inchangée. **Déployé dans beta.29.**
- [x] Harmoniser la police du minuteur avec les autres boutons. Minuteur et
  boutons voisins mesurés à 12 px / 600, hauteur 36 px. **Déployé dans beta.29.**
- [x] Proposition/claim sur une seule ligne, y compris la saisie — déployée
  dans beta.25. Ellipsis et lecture complète
  au clic ; remplace la demande multiligne précédente.
- [x] Rendre le sens/type des liens plus explicite par symboles/flèches lisibles,
  légende et alternative textuelle, pas uniquement des couleurs. Glyphe sur le
  canevas, liste « symbole + relation + note cible », légende de l’aide.
  **Déployé dans beta.29.**
- [x] « Bien démarrer » en popup modale compacte, avec l’étape pseudonyme et une
  aide adaptée au rôle ; petit bouton d’ouverture, gestion correcte du focus.
  **Déployé dans beta.29**, y compris nom accessible du bouton icône sur mobile.

L’utilisateur a demandé de poursuivre les points relevés, puis de déployer les
derniers changements après validation. Premier lot borné : protéger l’effacement,
proposition monoligne, noms lisibles ; les autres demandes restent au suivi.
Deuxième lot : les quatre points ci-dessus, validés localement sur les trois
moteurs puis en production (22 captures, axe sans violation, CPU/GPU/repli).

- [Audit complet beta.24 du 18 novembre](AUDIT_UI_UX_2026-11-18.md) : 20 captures,
  trois rôles, desktop/mobile émulé/paysage, thèmes clair et sombre, revue de code.
  Liste priorisée discutée, poursuite autorisée. Pas de refonte générale :
  implémenter/tester les lots explicitement annoncés et tenir leur état à jour.
- Points principaux : protection de l’effacement, lisibilité de la proposition
  sur petit écran, noms dans Participants, clavier/relations, commandes de notes,
  avis courant lisible, audience/confidentialité et onboarding adapté au rôle.
- Nouvelle demande séparée : GPU par défaut si matériel compatible, puis un seul
  repli CPU visible en cas d’échec technique. Cette politique remplace le choix
  précédent de GPU caché/absence de repli et **est déployée dans beta.25**.
  Commit `9af4736` poussé sur `v2` ; 324 tests et recette réelle GPU AMD passent, y compris
  perte du périphérique, récupération CPU et nouveaux sous-titres pour Parakeet
  et Base. Aucun téléchargement/capture implicite ; budget Base GPU+CPU annoncé
  avant consentement (FP16 puis q8 seulement si repli), sans substitution cachée.
- Premier lot UI déployé dans beta.25 : confirmations de suppression partagée/
  privée, saisie/affichage monolignes avec lecture complète, noms à largeur utile
  et actions séparées dans Participants. Commit `c2c7f84` poussé sur `v2`.
  366 tests frontend, check/lint/build, 30 régressions finales sur trois moteurs
  et six tests voix passent. CI complète et recette publique réussies.
- Deuxième lot implémenté et validé localement :
  - notes privées dans un panneau dédié, hors des onglets Discussion ; stockage
    local par salle et confirmation d’effacement inchangés ;
  - minuteur aligné sur la typographie et la hauteur des boutons voisins ;
  - liens lisibles sans couleur : flèche directionnelle, glyphe de type sur le
    canevas, liste « symbole + relation + note cible » et légende dans l’aide ;
  - « Bien démarrer » en `<dialog>` compact avec saisie immédiate du pseudonyme,
    fermeture Échap/bouton, focus rendu au déclencheur, adaptation au rôle.
- Validation du deuxième lot : 367 tests unitaires, check/lint/build verts,
  68/68 cas UI Chromium et Firefox, 34+34 WebKit, plus 8 régressions ciblées par
  moteur sur panneaux, focus, aide et notes. Aucune assertion retirée.
- Publication : tags beta.26 à beta.29. beta.26 et beta.27 ont échoué en CI
  (erreur Svelte-check, import e2e inutilisé) et n’ont pas été déployées. La
  recette publique de beta.28 a trouvé un bouton d’aide sans nom accessible sur
  mobile ; corrigé, beta.29 est passée complète, a été déployée puis validée.

## État de publication

- **Production : beta.29**, déployée le 19 novembre à 02:05 UTC. Source
  `b731a9f6f0f79eeb241a464916848d0d6bb14f0c`,
  [CI 44438724366](https://github.com/Opinions-sur-Rue/spectrum/actions/runs/44438724366)
  entièrement verte. Frontend
  `sha256:6830528470601c5f72111585c9c06776d279d25e945593b3c40862b6521da23c`,
  backend `sha256:e21f12c7a99f47096a262aaceff8ec0de888fc1146215c31323bb0c2105f6c8a`.
  Paire épinglée par digest, 100 secondes sans salle, participant audio ni
  connexion backend. LiveKit/PeerJS/TURN inchangés. Assets
  `/opt/spectrum/stt/releases/beta29-b731a9f` (38 fichiers vérifiés) ; retour
  arrière `/opt/spectrum/deploy-v2.0.0-beta.29-20261119T020539Z` vers beta.28.
- Recette publique beta.29 : 11 étapes UI sur 11, 22 captures, axe sans violation
  sur six écrans, minuteur 12 px/600 comme les boutons, légende et glyphes de
  relations, panneau privé dédié, pseudonyme et focus rendus. CPU, GPU automatique
  et repli CPU visible passent avec sous-titres réels, préparation sans micro,
  cache modèle réutilisé, historique spectateur et absence de publication tardive.
- Historique : beta.28 déployée à 01:33 UTC puis remplacée après la régression
  d’accessibilité détectée en recette. beta.26 et beta.27 ont échoué en CI et n’ont
  jamais été déployées. beta.25 reste la référence précédente acceptée.
- Toujours : paire frontend/backend validée ensemble, contrôle d’activité strict,
  pas d’interruption de réunion, v1 et services voix préservés.

## Optimisation frontend CI demandée

- Mesure beta.24 : environ 20 min de frontend, dont 340 s UI Chromium/Firefox,
  372 s WebKit, 250 s voix, exécutés successivement. Unitaires : 20 s ; npm ci :
  70 s ; installation navigateurs : 42 s ; fixtures : 64 s.
- Nouveau découpage actif depuis beta.26 : qualité/v1/chargeur, UI Chromium, UI
  Firefox, deux shards WebKit à un worker, voix Chromium et voix Firefox, fixtures
  isolées. Commit `c1ef2b1`.
- Toutes les étapes restent obligatoires. Statut `frontend` agrégateur refusant
  aussi les jobs échoués, annulés, ignorés ou manquants avant publication.
- Couverture vérifiée par découverte : 201 cas UI et 18 cas voix exactement une
  fois ; verrou testé sur 216 combinaisons et résultats absents ; actionlint vert.
- Les tests UI croisés nécessitent un second moteur. `--fully-parallel` distribue
  les cas WebKit, pas simplement les deux gros fichiers. Exécution Chromium
  réelle dans ce mode : 67/67 tests passent avec deux workers.
- Mesure beta.28 : frontend vert en environ 6 min pour trois jobs UI. Le cache
  Playwright ramène l’installation des moteurs à 26–41 s. Un job WebKit a encore
  passé 21 min dans l’installation apt de `--with-deps` : le téléchargement des
  navigateurs n’est plus le coût variable, les dépendances système le restent.

## Feedback fonctionnel livré

Ces groupes sont clos côté implémentation et déploiement. Ils ne remplacent pas
la validation sur appareils physiques indiquée plus bas.

- [x] Panneaux mobiles, espace du canvas, pseudonyme accessible et aide compacte.
- [x] Reconnexion et conservation des brouillons autorisés ; reprise mobile
  bornée par la grâce de 60 secondes, sans restaurer une autorité révoquée.
- [x] Pseudonymes au-dessus des pastilles ; attribution des notes ; édition du
  contenu réservée à l’auteur, avec nouvelle validation après modification.
- [x] Notes neuves sans texte prérempli ; proposition centrée, désormais monoligne
  selon la préférence mise à jour.
- [x] Push-to-talk ; mute ciblé par l’admin ; reprise uniquement par le propriétaire
  du micro ; temps de parole partagé pour le Spectrum courant.
- [x] Notes personnelles locales, privées même vis-à-vis des admins ; canaux
  Salle/Scène/Admin et masquage des messages par modération.
- [x] Co-admins additifs et abandon volontaire des droits, avec protection du
  dernier admin.
- [x] Lots UI/UX A–D : recherche et raccourcis, export Markdown, minuteur partagé,
  sélecteur de micro et niveau d’entrée, état hors ligne, thème et invitation,
  récupération d’erreurs, caméra au redimensionnement, espacements/typographie.
- [x] Corrections ciblées de l’audit initial : brouillons, commandes de notes
  mobiles, Discussion compacte, erreur micro obsolète, contraste du journal,
  états de notes visibles, focus des dialogues et badges moins bruyants.
- [x] Menu audio unifié, progression/cache des modèles, Parakeet et Base seulement
  — beta.22.

## Changements beta.24 : déployés et recette publique réussie

- [x] Option de transcription du spectre activée par défaut, sans consentement
  implicite au téléchargement, à la capture ou au partage de texte.
- [x] Préparation du modèle sans rejoindre l’audio ni ouvrir le micro.
- [x] Préparation conservée menu audio fermé et modèle conservé à la coupure du
  micro ; attente explicite jusqu’à une piste publiée et une nouvelle session.
- [x] Résultats tardifs et attachements audio périmés écartés.
- [x] GPU Parakeet expérimental derrière `?stt-gpu=1`, puis sélection et consentement
  explicites. Mêmes poids ; encodeur accéléré, autres étapes CPU ; aucun repli
  silencieux de session vers CPU. Budget annoncé : environ 255 Mo.
- [x] Validation locale : 283 tests frontend, check/lint/build, tests Go avec
  détection de courses, régression v1, six tests de chargement sur trois moteurs,
  six tests voix Chromium/Firefox et trois tests réels GPU à froid.
- [x] Publier beta.24 avec la synchronisation du test de viewport corrigée.
- [x] Confirmer la CI complète beta.24, les deux images et le manifeste.
- [x] Déployer la paire après le contrôle strict d’activité.
- [x] Vérifier la transcription CPU et GPU réelle sur le site public : préparation
  sans micro/menu fermé, sous-titres partagés, historique spectateur, aucun envoi
  tardif et une seule capture du micro, préservée à l’arrêt de la transcription.
  Poids du modèle réutilisés depuis le cache vérifié. Premier contrôle spectateur
  expiré, puis passage CPU complet réussi sans changement produit ; cause du
  timeout initial non établie. Passage GPU complet réussi également.

Le déploiement est clos. Les validations physiques, accessibilité et précision
prolongée ci-dessous restent ouvertes. Pour essayer le GPU :
`https://spectrum.utile.space/v2/?stt-gpu=1`, puis sélection WebGPU et consentement
dans Options audio si le navigateur propose un GPU matériel compatible. Pour
une salle existante, conserver son paramètre `room` en ajoutant `stt-gpu=1`.

## Validation restant à faire — prioritaire

1. **Appareils physiques iPhone/Safari et Android/Chrome**
   - [ ] Clavier natif, orientation, petits écrans et accès aux commandes.
   - [ ] Mise en veille, changement d’application, retour réseau et reprise.
   - [ ] Permissions micro, écoute/publication, push-to-talk et réseaux réels.
   - Les tests WebKit/Linux et les claviers simulés ne valent pas cette recette.
2. **Accessibilité manuelle**
   - [ ] Lecteur d’écran et parcours clavier complets pour les trois rôles.
   - [ ] Grossissement, ordre du focus et contrastes des états/thèmes non audités.
   - Les contrôles automatisés existants ne constituent pas une certification WCAG.
3. **Transcription et GPU**
   - [ ] Évaluer un échantillon français représentatif et des sessions prolongées.
   - [ ] Mesurer mémoire, consommation et comportement sur appareils physiques.
   - [ ] Évaluer les limites de capacité Firefox et la compatibilité GPU réelle.
   - Français GPU différent du CPU sur la phrase testée (`lois`/`loin fiscales`,
     notamment). Pas de parité de précision revendiquée.
   - Mesure locale sur une seule phrase : 2 980 ms CPU / 631 ms GPU AMD. Ce n’est
     pas une garantie de vitesse générale ni de latence de bout en bout.

## Finitions et pistes UX non bloquantes

- [ ] Auditer les erreurs techniques encore susceptibles d’apparaître en anglais.
- [ ] Éprouver navigation clavier/tactile du canvas et découverte des notes/liens
  pendant une vraie discussion, notamment avec du contenu hors écran.
- [ ] Prioriser d’éventuelles retouches visuelles à partir de cette observation.

Ces pistes ne sont pas de nouveaux bugs bloquants confirmés. Ne pas rouvrir les
lots déjà livrés sans reproduction ou besoin utilisateur précis.

## Hors UI/UX — toujours ouvert

- [ ] Trier les dépendances vulnérables et choisir les mises à jour compatibles ;
  pas de correction globale automatique.
- [ ] Valider les intégrations Twitch/YouTube/TikTok avec de vrais directs.
- [ ] Configurer explicitement le signer TikTok compatible si cette intégration
  est retenue ; ne pas confondre tests de protocole et validation opérationnelle.
- [ ] Examiner la cancellation des connexions initiales/reconnexions du SDK Twitch.

## Documents de référence

- [RESUME_V2_PARITY.md](RESUME_V2_PARITY.md) : historique technique, preuves de
  validation, déploiements et reprise du travail.
- [BROWSER_STT.md](BROWSER_STT.md) : transcription, consentement, cache, mesures et
  limites de compatibilité/précision.
- [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md) : architecture et parité ; certaines
  sections de planification sont historiques.
- [CHANGELOG.md](../CHANGELOG.md) : changements par version.

Prochaine priorité proposée après beta.23 : recette mobile physique, puis audit
accessibilité manuel, avant de nouveaux ajouts fonctionnels.
