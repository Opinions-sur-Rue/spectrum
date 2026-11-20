# Suivi du feedback et des audits UI/UX

Mis à jour le 20 novembre 2026. Synthèse de l’état courant ; les anciens comptes
rendus restent dans [RESUME_V2_PARITY.md](RESUME_V2_PARITY.md). Leurs mentions
« restant », « non déployé » ou « pending » peuvent décrire une étape historique
déjà terminée : elles ne constituent pas le backlog actuel.

## Nouvelle passe UI/UX et demande GPU automatique

### Backlog convenu et mis en pause à la demande utilisateur — 20 novembre

À reprendre plus tard, pas à inclure implicitement dans le lot visuel des pastilles :

- [ ] Audience/droits d’écriture des canaux ; contenu partagé éphémère vs notes
  privées persistantes vs cache public des modèles ; effacement local ciblé sans
  supprimer tout le stockage du site.
- [ ] Étendre le design system aux composants secondaires ; les commandes
  principales et le libellé Minuteur sont déjà livrés, ne pas les rouvrir sans motif.
- [ ] Traduire les erreurs techniques restantes en français/anglais.
- [ ] Évaluer un choix d’avis alternatif au drag ; collisions de noms en grand
  groupe et découverte clavier/tactile du canvas pendant une vraie discussion.
- [ ] Vrais Android/iPhone : Discord/WebViews, ouverture dans le navigateur,
  changements d’app, veille, permissions micro et reprise réseau.
- [ ] Lecteurs d’écran, parcours clavier complet, focus, zoom et contrastes.
- [ ] ASR prolongé : précision française représentative, mémoire/consommation,
  appareils et GPU variés, capacité Firefox et délais du profil de test persistant.
- Dépendances vulnérables et intégrations live réelles restent dans le suivi
  « Hors UI/UX » ci-dessous ; aucune mise à jour globale implicite.

### Priorité immédiate — pastille propre et spectre vocal, déployé dans beta.34 et beta.35

- Point blanc remplacé par un disque CSS positionné au centre géométrique de la
  pastille, sans dépendre d’une glyphe ou de la ligne de base d’une police.
- Spectre radial de **32 bandes réelles**, FFT 1024, bandes logarithmiques
  80–8000 Hz (bornées par Nyquist), lissage attaque/relâchement, au plus 25 images/s.
  Taille du spectre lisible indépendamment du zoom ; espace préservé pour le nom.
- Première passe sur **sa propre pastille** uniquement, avec la piste micro déjà
  autorisée/publiée. Aucun `getUserMedia` supplémentaire, aucun son renvoyé vers
  les haut-parleurs, aucun envoi/persistance des bandes FFT ou de l’audio.
  Les autres participants gardent l’indicateur LiveKit existant, pas un faux FFT.
- Nettoyage lors de mute/fin/changement de piste/démontage ; le visualiseur ne
  stoppe jamais la piste voix. Travail rAF suspendu en onglet caché. Mouvement
  réduit : anneau statique, sans FFT ; erreur d’analyse : anneau de secours.
- Validation locale : centrage mesuré sur trois moteurs, trois largeurs et trois
  niveaux de zoom ; test vocal à deux fréquences confirmant le déplacement du pic
  FFT, capture unique, mute et préférence de mouvement réduit. Les 20 scénarios
  voix Chromium/Firefox et 45 cas UI ciblés sur trois moteurs passent. Check/lint/
  build et 402 tests unitaires verts.
- Déploiement : **beta.34** (source `e67b074`, CI `44669965599`) puis **beta.35**
  (source `96e17ed`, CI `44674342368`), porte de 100 secondes sans activité, aucune
  exception de connexion. Assets `beta34-e67b074` et `beta35-96e17ed` vérifiés.
- Recette publique : `/`, `/v2/`, `/status` à 200 ; centrage sous-pixel sur trois
  largeurs et plusieurs zooms ; 32 bandes réelles avec déplacement du pic FFT de
  440 à 1800 Hz et une seule capture ; mouvement réduit → anneau statique ; mute →
  nettoyage sans couper l’audio. La passe axe complète avec micro actif a révélé le
  libellé « Micro ouvert » vert clair sur fond blanc (contraste 1,26), corrigé en
  beta.35 et revérifié sans violation axe. Les anciens chiffres ≈21:1 étaient
  invalides (coordonnées Oklab interprétées comme RGB). CPU transcrit toujours.
- Les conteneurs LiveKit/PeerJS/TURN ont été recréés à 04:24:34, hors des deux
  fenêtres de déploiement, avec des images identiques et restent actifs — constat
  noté, non causé par ces déploiements. Limitations des vrais appareils ouvertes.

### Retouche compacte et participants distants — local non déployé

- Demande utilisateur : une couleur de base déclinée, amplitude à 70 %, moins de
  fréquences visibles, et visualisation sur les autres participants.
- Palette dérivée de la couleur de chaque pastille, mélangée au texte du thème pour
  trois nuances ; anneau de secours assorti également. Le primaire du thème sert
  uniquement de repli si la couleur de pastille est absente/invalide.
- Réduction visuelle 32 → 12 bandes par agrégation RMS pondérée, sans couper la
  plage fréquentielle FFT. Enveloppe initialement à 70 %, remontée à **85 %**
  après essai local utilisateur ; marge réduite conservée.
- Correction du zoom après essai : géométrie exprimée en coordonnées du canvas,
  sans compensation inverse. Spectre, amplitude, bruit et anneau de secours suivent
  désormais la taille de la pastille ; espacement du nom ajusté dans le même repère.
  Rapport diamètre du spectre/pastille vérifié constant après cinq changements de
  zoom sur Chromium et Firefox. Quatre scénarios ciblés local/distant verts après
  relance de Vite (cache de traductions générées devenu périmé).
- Spectres distants analysés localement sur les pistes audio LiveKit déjà reçues
  après l’action « Rejoindre l’audio ». Aucune capture supplémentaire, aucun FFT
  transmis ou persisté, aucun démutage distant. Retrait sur mute/désabonnement/
  déconnexion ; nettoyage de l’analyse sans arrêter la piste voix.
- Identifiants de dégradés propres à chaque instance ; mouvement réduit et onglet
  caché respectés pour chaque spectre. La présentation masque aussi les spectres
  distants. Coût en grand groupe et vrais appareils encore à valider.
- Validation locale : check/lint/build, 414 tests unitaires et 22 scénarios voix
  Chromium/Firefox verts. Nouveau scénario réel à deux navigateurs : réponse
  fréquentielle distante, aucune capture chez l’auditeur, mute et mouvement réduit
  sans perte de connexion audio. Capture du rendu distant examinée.

### Nouvelle correction — histogramme FFT en courbe radiale, déployé dans beta.37

- Après beta.36, précision utilisateur : pas de sinusoïdes prédéfinies. Relier les
  sommets des 32 bandes FFT par une interpolation lissée, sans perdre les pics
  individuels. Basses à midi puis fréquences croissantes dans le sens horaire.
- Trois secteurs remplis (basses, médiums, aigus), dégradés du thème sans contour ;
  faible base visible dès l’ouverture du micro.
- Bruit cohérent lent ajouté à la base, amplitude maximale 0,3 pixel écran,
  indépendant des pics FFT. Animation plafonnée à 25 images/s, suspendue en onglet
  caché, arrêtée au démontage et désactivée en mouvement réduit.
- Analyse toujours locale sur la piste déjà autorisée ; aucune capture supplémentaire.
  Déployé le 20 novembre à 06:52 UTC après CI complète `44687159061`, source
  `2cb11dc`, contrôle strict sans activité de 100 secondes, aucune exception.
- Recette publique verte : réponse du secteur basses à 150 Hz et aigus à 4000 Hz,
  mouvement continu au silence, centrage, thèmes, capture unique, mute, mouvement
  réduit, 11 étapes UI, 22 captures et sept échantillons axe sans violation.
  Transcription CPU vérifiée. Digests/rollback dans `RESUME_V2_PARITY.md`.
  LiveKit/PeerJS/TURN non redémarrés. Validation prolongée et vrais appareils différés.

### Retouche visuelle du spectre — sinusoïdales, déployé dans beta.36 (historique)

Demande utilisateur sur le visuel des barres, jugé trop simple :

- Remplacer les 32 barres radiales par **trois sinusoïdales qui se croisent**
  (3, 4 et 5 lobes, phases décalées). Aire **sous chaque sinusoïde** remplie en
  couleur de thème **translucide** (primaire, accent, secondaire) avec un dégradé
  radial (transparent au centre → couleur au bord), **sans contour**.
- **Base très basse visible dès que le micro est ouvert**, même silencieux :
  plancher d’amplitude constant, puis l’énergie réelle fait monter les lobes.
  La transition n’est plus tout-ou-rien : l’amplitude suit les bandes lissées
  (attaque/relâchement existants) au lieu d’un affichage conditionné à « en train
  de parler ». Basses/médiums/aigus pilotent respectivement les trois ondes.
- Plus de vert : les couleurs viennent des tokens du thème, donc le rendu s’adapte
  aux thèmes lofi/clair/sombre (monochrome ou coloré selon le thème actif).
- Mêmes garde-fous : aucune capture supplémentaire, aucun son renvoyé, aucun envoi
  des données ; mouvement réduit → anneau statique ; mute → nettoyage ; erreur FFT
  → repli sûr sans toucher la piste.
- Validation locale : 404 tests unitaires, 20 scénarios voix Chromium/Firefox et
  45 cas UI ciblés sur trois moteurs verts, check/lint/build verts. Test vocal à
  deux fréquences : le centroïde spectral passe de ~11 (440 Hz) à ~22 (1800 Hz).
  Déployé le 20 novembre à 05:53 UTC après CI complète `44680879694`, source
  `68ed793`, contrôle strict sans activité de 100 secondes, aucune exception.
- Recette publique verte : centrage, réponse fréquentielle, base au silence,
  captures lofi/clair/sombre, capture micro unique, mute et mouvement réduit.
  11 étapes UI, 22 captures et sept échantillons axe sans violation ; transcription
  CPU vérifiée. Phases fixes : pas d’animation temporelle indépendante, amplitude
  pilotée par le lissage FFT existant. Validation prolongée et vrais appareils différés.
- Paire de digests et rollback consignés dans `RESUME_V2_PARITY.md`.
  LiveKit/PeerJS/TURN non redémarrés pendant ce déploiement.

### Avis courant lisible hors du canvas — déployé dans beta.33

- Audit §6 : résumé « Mon avis : … » dans la barre de guidage, à taille UI
  indépendante du zoom du canvas. Géométrie SVG existante et position de la
  pastille propre reçue du serveur ; aucune inférence sur les autres personnes.
- Hors zone, position en attente et déconnexion ont des textes distincts.
  Aucun ancien avis présenté comme synchronisé hors ligne. Résumé absent pour
  les spectateurs et en présentation ; aucune conservation supplémentaire.
- Aide courte et action Revenir à ma pastille : recadrage puis focus pour les
  flèches/Maj + flèche, sans mouvement ni envoi automatique d’un avis. Le drag
  reste inchangé ; pas encore de choix d’une case via une liste alternative.
- Annonce polie après 400 ms de stabilisation de la case, sans répétition pour
  les seuls changements de coordonnées internes. File annulée au changement de
  rôle, de salle/proposition/configuration, au chargement de géométrie et à la
  déconnexion. Lecteur d’écran réel toujours à valider.
- Revue à 320 px : avis sur une ligne dédiée sous pseudo/aide, pour ne pas
  comprimer l’identité. Texte de 14 px lisible hors du canvas, sans débordement.
- Validation cumulée locale : check/lint/build verts, **395 unitaires** ;
  **42 scénarios UI ciblés** verts sur Chromium/Firefox/WebKit (avis, clavier/liens,
  design system, panneaux, mobile/paysage, présentation et accessibilité).
  Axe sans violation dans la barre de guidage avec aide ouverte ; captures
  320/390 px examinées. Voix/ASR et stockage inchangés.

### Notes au clavier et parcours des liens — déployé dans beta.33

- Audit §3 : volet Position/taille désormais disponible sur desktop aussi, sous
  Organiser. Boutons natifs pour déplacer de 40 unités, dimensions et retour de
  position textuel annoncé poliment ; aucun raccourci global ni interception des
  flèches dans l’éditeur. Offline, épinglage, permissions, présentation et masquage
  sont respectés, y compris par un gestionnaire conservé après changement de contexte.
- Liens sortants dans une liste nommée par la source, relation/glyphe et titre/auteur
  de destination. Bouton pour cadrer et focaliser la note liée sans enregistrer le
  brouillon ; sur mobile l’inspecteur source se ferme avant celui de la cible.
  Cible absente : libellé indisponible, pas de bouton de navigation.
- Suppressions de lien nommées par rang, source, relation, destination et auteur,
  y compris lorsque plusieurs cibles ont le même titre. Suppression admin seulement.
- Titres des zones de commandes en h2 après le titre h1 de la note : saut de niveau
  détecté par le nouveau contrôle axe complet puis corrigé, sans désactiver la règle.
- Validation : 387 tests unitaires ; 24 régressions notes/dock/inspecteur/axe sur
  trois moteurs, puis 21 scénarios clavier/design system/panneaux/aide, tous verts.
  Captures desktop/mobile et conservation des brouillons vérifiées. Recette réelle
  avec lecteur d’écran toujours requise. Aucune modification voix/ASR ou stockage.

### Publication commune des deux lots — beta.33

- Source `40de234`, tag immuable `v2.0.0-beta.33`, CI `44544248996` entièrement
  verte : 395 unitaires, 73 cas UI par moteur (219 au total), 18 cas voix,
  régression v1 et six cas du chargeur. Les deux suivis de CI interrompus ont
  subi des resets réseau locaux ; aucun job de cette CI n’a échoué.
- Déploiement le 20 novembre à **01:54 UTC**, paire frontend/backend épinglée
  par digest, 38 assets vérifiés dans `beta33-40de234`. Images et heures de
  démarrage LiveKit/PeerJS/TURN inchangées ; secrets et configuration voix intacts.
- **Exception expressément autorisée par l’utilisateur pour ce déploiement** :
  une connexion backend se recréait après sa coupure ciblée autorisée. Deux
  tentatives strictes ont été bloquées sans redémarrer. Après accord explicite,
  le runner a conservé 100 secondes avec zéro salon/participant audio et au plus
  une connexion backend (`allowedBackendConnections: 1`), consigné dans le backup.
  Cette exception ne change pas le seuil strict par défaut des prochains lots.
- Recette publique : `/`, `/v2/`, `/status` à 200 ; 11 étapes UI, 22 captures,
  six écrans axe sans violation. Trois thèmes/quatre largeurs et six contrôles
  axe des barres verts. Recette française ciblée verte : avis serveur/annonce,
  focus sans vote, mobile 320/390 px, absence du résumé chez le spectateur,
  déplacement clavier/épinglage, navigation de lien et brouillon conservé lors
  du transfert d’inspecteur mobile ; trois contrôles axe ciblés sans violation.
- CPU et GPU produisent des sous-titres ; repli CPU injecté visible, un seul
  accès micro, préparation sans micro/menu fermé, historique spectateur et aucun
  envoi tardif. Vérification physique Discord/lecteur d’écran toujours ouverte.
- Preuves : `/tmp/opencode/beta33-deploy-approved.log`, `beta33-production-*.log`,
  `uiux-beta33-production/`, `uiux-beta33-controls/`, `uiux-beta33-opinion-notes/`.

### Design system — première passe déployée dans beta.32

- Contrat partagé dans `frontend/src/lib/canvas/design-system.css`, limité à
  `.v2-shell` : famille UI, taille/graisse/interligne, espacements, rayons,
  hauteurs desktop/mobile et états focus/ouvert/désactivé. Variantes primaire et
  danger conservées ; v1 et prose des notes non redessinées.
- Bouton **Minuteur**, son libellé réel et son décompte alignés avec les autres
  commandes. Suppression des tailles de texte propres aux libellés de menus.
  Icônes de déclencheurs Minuteur/Interface/main/réactions dans Iconoir ; les
  choix et animations de réactions restent des emojis sémantiques.
- `IconButton` utilise les couleurs du thème plutôt que des bleus/gris fixes.
  Icônes par défaut en rem ; agrandissement des préférences de texte respecté.
- Noms accessibles corrigés : Interface inclut son libellé visible ; Participants
  inclut son compteur. Tests de navigation utilisent le titre stable du menu et
  vérifient séparément le nouveau nom accessible.
- Validation locale : check/lint/build, 378 unitaires et régression v1 verts.
  Passe UI complète sur trois moteurs : 210 cas verts, trois assertions de
  redimensionnement à seuil fixe échouées car le zoom initial dépend de la
  hauteur des barres. Assertion remplacée par la variation exacte de 80 unités
  monde ; les trois redimensionnements et les trois scénarios design system
  repassent ensuite (6/6). Aucun contrôle fonctionnel supprimé.
- Le scénario design system vérifie trois thèmes, quatre largeurs, le libellé
  **Minuteur en français**, la version anglaise, clavier, focus, icônes, état
  désactivé et taille de texte agrandie. Axe sans violation sur les barres
  desktop/mobile dans les trois thèmes ; captures examinées clair et sombre.
- Contrat et limites : [DESIGN_SYSTEM_V2.md](DESIGN_SYSTEM_V2.md). Première passe
  sur les commandes, pas déclaration d’achèvement d’un design system exhaustif.
- Publication : source `4e93ffb`, tag immuable `v2.0.0-beta.32`, CI complète
  `44505388781` verte : 378 unitaires, 71 cas UI par moteur, 18 cas voix,
  régression v1 et six cas du chargeur. Déploiement le 19 novembre à 10:51 UTC,
  après 100 secondes sans activité ; LiveKit/PeerJS/TURN inchangés. Assets :
  38 fichiers vérifiés dans `beta32-4e93ffb`.
- Recette publique finale : `/`, `/v2/`, `/status` répondent 200 ; 11 étapes UI
  et 22 captures ; six écrans généraux axe sans violation. Contrôles français
  vérifiés sur trois thèmes et quatre largeurs : libellé **Minuteur** à 12 px /
  600 / 15 px d’interligne comme les voisins, icônes 18 px, cibles 36/44 px,
  clavier et agrandissement du texte. Six audits axe des barres sans violation,
  captures françaises desktop/mobile clair/sombre examinées. Recette notes,
  liens, inspecteur et aide Android/iOS verte ; trois audits axe ciblés verts.
- CPU, GPU et repli CPU injecté produisent des sous-titres, avec préparation
  sans micro/menu fermé, historique spectateur, une capture et aucun envoi tardif.
  Premiers essais conservés : resets/timeouts avant chargement public, attente de
  création de lien expirée, démarrage mobile incomplet, téléchargement interrompu,
  puis délai avant les premiers sous-titres GPU (avant injection). Reprises finales
  vertes sans changement produit ; causes des délais non toutes établies. Le
  harness mobile attend désormais explicitement le lobby connecté avant l’aide.
  Aucun nettoyage du stockage utilisateur ni redémarrage supplémentaire.

### Retour après beta.30 — déployé dans beta.31

- En-tête d’identité des notes non sélectionnable et utilisable pour déplacer
  une note sur desktop, même lorsque l’éditeur garde le focus. Restrictions de
  droits, note épinglée et inspecteur mobile conservés.
- Boutons H1 / gras / italique / liste directement visibles dans les commandes,
  sans ouvrir un volet de mise en forme. Création de lien toujours repliable.
- Aide mobile Android/iOS pour quitter le navigateur intégré de Discord ou d’une
  autre app : automatique pour les marqueurs reconnus, accessible manuellement
  sur les autres navigateurs mobiles. Menu Android, menu/partage iOS et lien
  copiable avec champ sélectionnable si le presse-papiers échoue. Aucune
  redirection forcée. Détection heuristique, sans garantie pour toutes les apps.
- L’aide précise que le salon reste le même, mais que l’identité et les notes
  privées locales ne sont pas transférées entre navigateurs ; aucune promesse de
  maintien du micro en arrière-plan. Vérification Discord sur vrais téléphones
  Android/iPhone encore nécessaire.
- Validation locale : check/lint verts, 378 tests unitaires ; 30 régressions UI
  ciblées passent sur Chromium, Firefox et WebKit, dont déplacement depuis
  l’en-tête pendant l’édition, mise en forme visible, inspecteur/panneaux mobiles
  et aide Android/iOS (axe sans violation sur cette aide).
- Publication : source `62413e4`, tag immuable `v2.0.0-beta.31`, CI complète
  `44474475801` verte. Paire frontend/backend épinglée par digest déployée le
  19 novembre à 06:57 UTC après 100 secondes sans activité ; LiveKit, PeerJS et
  TURN inchangés. Assets : 38 fichiers vérifiés dans `beta31-62413e4`.
- Recette publique : `/`, `/v2/` et `/status` répondent 200 ; 11 étapes UI,
  22 captures et six écrans axe sans violation. Recette ciblée : déplacement
  depuis l’en-tête pendant l’édition, mise en forme visible, recherche/liens,
  dock sans chevauchement, commandes mobiles et aide Android/iOS ; axe sans
  violation sur le picker et les deux aides. Premier script ciblé corrigé : son
  parseur de coordonnées n’acceptait pas les décimales après déplacement.
- ASR public : CPU et GPU produisent des sous-titres. Le repli GPU → CPU injecté
  passe avec sous-titres CPU réels et un seul accès micro dans un contexte neuf.
  Deux essais sur profil persistant ont expiré avant l’injection de panne, sans
  premiers sous-titres attendus ; cause non établie, résultats conservés. Aucun
  nettoyage du stockage utilisateur ni changement du code ASR dans ce lot.
- Design system global boutons/polices/icônes différé à la demande utilisateur.
  Le minuteur utilise déjà 12 px / 600 et une hauteur desktop de 36 px ; sa
  cohérence visuelle complète reste à revoir dans cette passe globale.

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
- Troisième lot déployé dans beta.30 : commandes de notes en zones explicites
  Modifier / Organiser / Modération / Relier. Mise en forme et création de lien
  repliées ; recherche de cible par titre, auteur ou extrait ; liste radio native
  avec contexte ; liens existants toujours visibles. Le dock reste du côté le
  plus spacieux et défile plutôt que de recouvrir la note. L’inspecteur mobile
  garde ses commandes de position dans Organiser. Validation locale : 372 tests
  unitaires, 64/64 UI Chromium et Firefox, 4/4 panneaux mobiles par moteur et
  3 régressions WebKit ciblées (inspecteur, dock, liens). Recette publique :
  zones et focus, recherche titre/auteur/extrait, création de lien, dock sans
  recouvrement et axe sans violation ; les 11 étapes UI et les smokes
  transcription CPU/GPU/repli restent verts.
- Publication : tags beta.26 à beta.29. beta.26 et beta.27 ont échoué en CI
  (erreur Svelte-check, import e2e inutilisé) et n’ont pas été déployées. La
  recette publique de beta.28 a trouvé un bouton d’aide sans nom accessible sur
  mobile ; corrigé, beta.29 est passée complète, a été déployée puis validée.

## État de publication

- **Production : beta.30**, déployée le 19 novembre à 03:31 UTC. Source
  `fa87b8998bc7070f05aedbaf7f145f644b742cd5`,
  [CI 44447674132](https://github.com/Opinions-sur-Rue/spectrum/actions/runs/44447674132)
  entièrement verte. Frontend
  `sha256:644cfd67364fe0950c112a587e52ca0171227f3d1860f699a205dfe17e472899`,
  backend `sha256:4c431e55cdb43e7faccde6572f24146aaf17db661b6a64991905953b7ac671a4`.
  Paire épinglée par digest, 100 secondes sans salle, participant audio ni
  connexion backend. LiveKit/PeerJS/TURN inchangés. Assets recopiés et vérifiés
  dans `/opt/spectrum/stt/releases/beta30-fa87b89` (38 fichiers, même révision de
  modèles) ; retour arrière
  `/opt/spectrum/deploy-v2.0.0-beta.30-20261119T033127Z` vers beta.29.
- Recette publique beta.30 : `/`, `/v2/` et `/status` en 200 ; 11 étapes UI sur
  11 et 22 captures de la recette beta.29 rejouées sans échec, axe sans violation
  sur six écrans. Recette ciblée des commandes : quatre zones Modifier/Organiser/
  Modération/Relier, recherche par titre, auteur et extrait, liste radio avec
  contexte, création de lien et glyphe, dock ouvert sans recouvrement (placement
  above), commandes de position mobiles, axe sans violation. CPU, GPU automatique
  et repli CPU visible passent avec sous-titres réels, préparation sans micro,
  historique spectateur et absence de publication tardive.
- Historique : beta.28 déployée à 01:33 UTC puis remplacée après la régression
  d’accessibilité détectée en recette. beta.26 et beta.27 ont échoué en CI et n’ont
  jamais été déployées. beta.29 reste la référence précédente acceptée.
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
