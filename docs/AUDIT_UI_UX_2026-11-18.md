# Audit UI/UX — beta.24 — 18 novembre 2026

Statut : utilisateur autorise la poursuite des points relevés et demande le
déploiement après validation. **Premier lot déployé et validé dans beta.25** :
confirmation des suppressions, proposition monoligne lisible et noms des
participants sur une ligne d’identité distincte. **Deuxième lot déployé et validé
dans beta.29** : notes privées hors Discussion, minuteur harmonisé, symboles/
légende des liens et aide modale avec pseudonyme. **Troisième lot déployé dans
beta.30** : commandes de notes en zones explicites et cible de lien recherchable.
Les autres points de l’audit restent à traiter dans des lots suivants. GPU par
défaut/repli CPU est un commit distinct. Validation locale du troisième lot :
372 unités, contrôles statiques/build, 64/64 UI Chromium et Firefox, 4/4
panneaux mobiles par moteur et 3 régressions WebKit ciblées. CI complète, gate
d’activité, recette publique UI, commandes de notes et transcription
CPU/GPU/repli réussies.

## Feedback utilisateur ajouté après l’audit

Les quatre demandes du deuxième lot sont déployées dans beta.29 et couvertes par
des tests locaux et une recette publique.

1. **Notes privées séparées de Discussion** : bouton et panneau dédiés. Préserver
   le contenu existant, l’autosauvegarde locale, le rattachement à la salle et
   l’absence d’accès serveur/admin. Ne pas dupliquer le stockage ni perdre un
   brouillon lors du changement de panneau. Discussion garde Chat/Journal/
   Transcription ; placement et comportement mobile du nouveau bouton à valider.
2. **Police du minuteur harmonisée** : même famille, graisse et échelle que les
   autres commandes de la barre. Corriger aussi l’état ouvert/compte à rebours,
   pas uniquement le texte au repos ; conserver l’alignement des icônes.
3. **Proposition sur une seule ligne** : cette demande remplace explicitement le
   choix multiligne précédent, ainsi que la proposition d’expansion multiligne
   formulée dans cet audit. Prévoir affichage et saisie monolignes. Le traitement
   d’un texte trop long sur mobile reste à convenir (troncature lisible avec accès
   au texte complet, ou autre solution monoligne), sans perdre le contenu.
4. **Relations plus explicites** : renforcer le sens et le type des liens par
   flèches/symboles et légende compréhensible, sans se reposer uniquement sur la
   couleur. Le rendu possède déjà des pointes de flèche ; la demande porte donc
   sur leur lisibilité et le décodage de la relation, notamment au zoom réduit.
   Conserver en parallèle une représentation textuelle accessible.
5. **« Bien démarrer » en popup modale compacte** : inclure le choix d’un pseudo
   parmi les premières étapes, puis des conseils adaptés au rôle. Ouvrir via un
   petit bouton plutôt que déployer une grande zone dans la page. Ouverture à
   la demande proposée, pas d’apparition automatique intrusive. Prévoir fermeture,
   confinement/restauration du focus et taille adaptée au viewport mobile.

Les modifications doivent rester cohérentes avec ces préférences et avec les
permissions, la confidentialité et le consentement existants.

## Périmètre et preuves

- Interface publique beta.24, salle de recette créée pour cet audit puis fermée.
  Aucune salle existante inspectée ou interrompue ; aucun micro réel acquis.
- Français ; parcours admin, participant et spectateur ; desktop 1440×1000,
  mobile émulé 390×844, petit écran 320×568 et paysage 844×390.
- Thèmes clair/lofi et sombre ; accueil, proposition, canvas, notes, Discussion,
  notes privées, transcription vide, réglages et participants.
- Revue complémentaire du code beta.24 (`ac58650`), sans rouvrir les corrections
  historiques déjà livrées.
- Captures et relevés locaux : `/tmp/opencode/uiux-beta24-audit/`. Les observations
  ci-dessous distinguent comportement reproduit, preuve de code et hypothèse UX.
- Passage final : 20 captures, huit groupes de parcours exécutés sans erreur JS.
  Axe ne détecte aucune violation WCAG A/AA dans les cinq états échantillonnés
  (accueil, spectateur mobile, tableau admin, éditeur mobile, thème sombre).
  Cela ne couvre pas tous les états ni les tâches sémantiques décrites plus bas.
- Ni recette iPhone/Android physique, ni test avec un vrai lecteur d’écran, ni
  certification WCAG. Le comportement du clavier natif reste hors périmètre.

## À traiter en premier

### 1. Protéger la suppression de contenu

**Preuve de code :** la corbeille d’une note partagée envoie directement
`note.delete`. Effacer les notes privées vide et persiste immédiatement le texte.
Ni confirmation ni restauration proposées dans ces chemins.

**Reproduction complémentaire :** un texte de recette enregistré dans les notes
privées disparaît immédiatement après la corbeille, sans bouton de restauration.
Le dialogue mobile déjà présent est celui de Discussion, pas une confirmation
supplémentaire d’effacement.

**Impact :** perte de travail possible sur un clic/toucher accidentel.

**Proposition :** annulation après suppression si compatible avec la rétention
éphémère ; sinon confirmation claire, particulièrement pour tout le bloc privé.
Ne pas introduire de sauvegarde serveur des notes privées.

Références : `NoteCard.svelte`, `PersonalNotes.svelte`.

### 2. Rendre la proposition lisible sur les petits écrans

**Reproduit visuellement :** à 320×568, une question de longueur ordinaire
(« Faut-il rendre les transports en commun gratuits pour tous ? ») n’apparaît
que partiellement. Le titre garde 5rem de marge interne de chaque côté, même
sans bouton de modification ; sa hauteur est limitée à 5em avec scroll interne.
L’affordance pour lire la suite est peu évidente. Les barres occupent alors une
grande partie de la hauteur et le spectrum devient très petit.

Mesure 320×568 : titre de 80px de haut pour 116px de contenu ; 80px de padding
de chaque côté dans une largeur de 292px. Le titre n’est pas focalisable.

**Proposition initiale, remplacée par le feedback ci-dessus :** exploiter la
largeur disponible et proposer une expansion explicite. L’orientation retenue
par l’utilisateur est désormais une proposition monoligne, en affichage et
saisie. Préserver l’accès au texte complet et le zoom choisi ; préciser le
traitement du débordement sur petit écran avant implémentation.

Preuve : `16-admin-320x568.png` ; référence : `ClaimBar.svelte`.

### 3. Donner une équivalence clavier aux tâches du canvas

**Preuve de code :** les commandes de déplacement de notes ne sont proposées
que dans l’inspecteur compact. Desktop permet le drag mais pas la même commande
de position au clavier. Les relations DOM indiquent leur type sans désigner
clairement leur destination ; plusieurs suppressions de lien ont le même nom.

Relevé navigateur : aucune commande « déplacer à gauche » sur desktop ; commande
présente dans l’inspecteur mobile. Pour la pastille, l’arbre d’accessibilité Chrome
expose bien l’avis et les instructions comme description issue du `title` : ne
pas conclure à leur absence totale. L’annonce des changements au lecteur d’écran
reste à tester, distinctement de cette description statique.

**Proposition :** commandes de position accessibles à tous les breakpoints ;
liste sémantique « note A — soutien — note B », navigation vers la cible et
libellés de suppression uniques. Vérifier ensuite avec un lecteur d’écran réel.

Références : `NoteCard.svelte`, `edge-node.ts`.

**Déployé dans beta.33 :** le volet « Position et taille »
est proposé aussi sur desktop dans Organiser, avec déplacements de 40 unités,
dimensions et position annoncée. Pas de détournement des flèches de l’éditeur.
Les liens sortants forment une liste nommée par la source ; destination et auteur
sont lisibles, un bouton cadre/focalise la cible (ouvre son inspecteur sur mobile),
et chaque suppression précise rang, source, relation et destination. Les cibles
absentes ne sont pas navigables. Permissions, épinglage et brouillons conservés.
Tests clavier/navigation/axe automatisés verts sur trois moteurs ; lecteur
d’écran réel toujours à vérifier, ne pas déclarer l’audit d’accessibilité clos.

## Améliorations à fort rendement

### 4. Donner la priorité au nom dans les participants

**Reproduit visuellement :** avec seulement deux personnes sur scène, le nom
« Samira — participante » se réduit à « Sa… » sur mobile ; rôle et quatre
actions d’administration prennent la ligne. Le panneau défile correctement,
mais reconnaître la personne reste difficile.

**Proposition :** nom sur une ligne dédiée ; actions secondaires dans un menu
par personne ou sur une seconde ligne. Garder mute et main levée faciles à
identifier. Recherche/filtre à envisager seulement si les grands groupes le
justifient ; les confirmations existantes de modération restent en place.

Preuve : `14-people-mobile.png` ; référence : `PeopleMenu.svelte`.

### 5. Simplifier les commandes de notes et la création de relations

**Reproduit visuellement :** une note sélectionnée affiche plusieurs groupes
flottants superposés (édition, mise en forme, modération, liens) au-dessus du
canvas. Le bouton « Plus » déclenche un focus, pas une ouverture explicite.
Les cibles de liens sont choisies par titre dans une petite liste, ambiguë si
des titres sont longs ou identiques.

**Proposition :** zone contextuelle explicite « Modifier / Organiser / Relier »,
actions fréquentes visibles et secondaires repliées ; choix de cible avec
recherche, titre, auteur ou extrait. Ne pas confondre édition de l’auteur et
modération de l’admin, ni refaire inutilement l’inspecteur mobile déjà livré.
Le feedback utilisateur ajoute des symboles/flèches plus explicites directement
sur les liens, avec sens et type lisibles même sans distinction de couleur.

**État beta.30 :** quatre zones nommées et espacées dans le dock — Modifier
(enregistrer/annuler, mise en forme repliée), Organiser (épingler, supprimer,
position/taille dans l’inspecteur mobile), Modération (admin uniquement) et
Relier. La création de lien est repliée sous « Relier une note » ; la recherche
porte sur le titre, l’auteur et le texte, avec titre, auteur et extrait dans une
liste de boutons radio native. Les liens existants restent visibles avec leur
glyphe. Le dock reste du côté le plus spacieux et défile au lieu de recouvrir la
note. L’inspecteur mobile est conservé, ses commandes déplacées dans Organiser.

Preuve : `07-note-actions-desktop.png` ; référence : `NoteCard.svelte`.

### 6. Afficher l’avis courant en texte lisible

**Reproduit visuellement :** les libellés du spectrum deviennent minuscules à
36 % sur mobile, davantage à 20 % sur petit écran. Les noms de pastilles proches
peuvent se superposer. La signification dépend trop de la lecture du diagramme.
Le clavier déplace déjà la pastille, mais le retour non visuel après mouvement
reste à éprouver ; ne pas prétendre qu’un attribut `title` suffit à le valider.

**Proposition :** résumé « Mon avis : … » lisible hors du canvas, instructions
courtes et annonce des changements de case. Évaluer un choix d’avis alternatif
au drag, sans supprimer le geste actuel. Tester le chevauchement des noms avec
un groupe plus important avant de décider d’un traitement automatique.

Preuves : `05-participant-mobile.png`, `16-admin-320x568.png` ; référence :
`SpectrumBoard.svelte`.

**Déployé dans beta.33 :** « Mon avis » hors du canvas affiche
la case de la pastille propre selon la géométrie SVG et l’état serveur. Résumé
absent pour les spectateurs/en présentation ; attente, hors zone et hors ligne
distingués. Aide courte et retour à sa pastille avec focus clavier sans vote
implicite. Annonce de case stabilisée, annulée lors des changements de contexte.
Tests sur trois moteurs et captures 320/390 px ; validation lecteur d’écran réel,
choix alternatif d’une case et collisions de noms en grand groupe restent ouverts.

### 7. Clarifier audience et conservation des données

**Constat UI/code :** sur mobile, l’explication d’audience du chat est cachée ;
« Salle » et « Scène » demandent de connaître les rôles. La rédaction de l’aide
sur la conservation RAM n’explicite pas l’exception des notes privées persistées
dans le navigateur. La vue Notes privées précise déjà qu’elles ne sont jamais
envoyées aux admins : ce point est acquis, pas une fuite découverte.

**Proposition :** mini-indication d’audience/droits d’écriture près du composeur ;
aide distinguant contenu partagé éphémère, notes privées conservées sur cet
appareil et fichiers publics du modèle. Expliquer comment effacer ces seules
notes sans recommander de supprimer tout le stockage du site.

Preuves : `09-discussion-chat-mobile.png`, `10-private-notes-mobile.png` ;
références : `ChatPanel.svelte`, `AppMenu.svelte`, messages FR/EN.

### 8. Adapter le premier usage au rôle et harmoniser les mots

**Constat UI/code :** le lobby français dit encore « Claim initial », la salle
dit « Proposition ». L’aide de démarrage propose de relier des notes à des rôles
qui ne disposent pas de cette commande. Sur mobile, lever la main est surtout
une icône, alors que c’est l’étape essentielle d’un nouveau spectateur.

**Proposition :** vocabulaire unique ; une prochaine action adaptée au rôle
(observer/demander la parole, se positionner/proposer, animer/modérer), et label
visible pour la première demande de parole. Ne pas suggérer que rejoindre
l’audio accorde le droit d’ouvrir le micro.
Le feedback utilisateur précise une aide « Bien démarrer » modale plutôt qu’un
bloc déplié, en mentionnant d’abord le choix d’un pseudo.

Preuves : `02-lobby-mobile-fr.png`, `04-spectator-mobile.png` ; références :
`RoomOnboarding.svelte`, messages FR/EN et barre d’actions.

## Pistes à discuter, pas des défauts confirmés

- Sur mobile, comparer l’accueil actuel à deux entrées « Créer / Rejoindre »
  avec réglages avancés repliés. Ne pas supprimer les choix de configuration ni
  imposer ce changement sans essai utilisateur : les invitations directes
  contournent déjà cet écran.
- Éprouver les grands tableaux, les titres identiques et les nombreuses mains
  levées ; recherche et filtres seulement si le volume réel les justifie.
- Finir le contrôle des erreurs techniques FR/EN et l’accessibilité manuelle.

## Ce qu’il faut préserver

- Identité visuelle sobre et séparation canvas / Discussion ; pas de refonte
  générale nécessaire sur la base de ces observations.
- Brouillons conservés, vrais onglets et retour de focus de Discussion.
- Édition de contenu réservée à l’auteur, validation et visibilité séparées.
- Confidentialité des notes privées, consentement audio et absence de micro
  ouvert automatiquement, même lors d’un repli GPU vers CPU.

## Ordre proposé pour discussion

1. Protection contre l’effacement + proposition sur petit écran + noms lisibles.
2. Notes/relations et équivalence clavier ; retour d’avis lisible.
3. Audience, confidentialité et onboarding/vocabulaire.
4. Essai mobile physique/lecteur d’écran avant tout nouveau polish optionnel.

L’utilisateur a depuis demandé de poursuivre les points relevés. Le premier lot
est volontairement borné aux suppressions, à la proposition et aux noms ; ne pas
présenter les autres points comme implémentés.
