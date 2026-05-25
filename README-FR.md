# Vendor (TPRM) -- Application web de gestion des risques fournisseurs

Application web 100% client-side pour gérer les risques liés aux fournisseurs tiers (**Third-Party Risk Management**) : classification, évaluations de sécurité, plans d'action, suivi documentaire, maturité pondérée.

> Cet outil fait partie de la suite **[CISO Toolbox](https://www.cisotoolbox.org)** -- une collection d'outils open-source de sécurité, conçus pour les RSSI, analystes de risques et responsables conformité. L'objectif de cette suite logicielle est d'être modulaire et légère pour que chacun puisse utiliser uniquement le ou les outils dont il a besoin.
>
> Pour voir les autres outils de la suite vous pouvez consulter le site [cisotoolbox.org](https://www.cisotoolbox.org/#tools)

---

## Pourquoi cet outil ?

La gestion des risques liés aux fournisseurs est une obligation réglementaire (DORA, NIS 2, SecNumCloud) et une exigence opérationnelle (chaîne d'approvisionnement, continuité). Les outils GRC existants sont souvent :

- Coûteux et complexes à déployer pour une équipe sécurité de taille modeste
- Hébergés dans le cloud public, ce qui pose des problèmes de confidentialité pour les données fournisseurs
- Verrouillés sur un format propriétaire

Cette application a été conçue autour de deux principes simples :

**1) Aucune donnée ne quitte le navigateur**

- Pas de serveur applicatif, pas de base de données, pas de compte utilisateur
- Tout le traitement se fait côté client, en JavaScript
- Les données restent sur le poste de l'analyste
- L'application fonctionne hors-ligne une fois chargée
- Le chiffrement/déchiffrement des sauvegardes (AES-256-GCM) est réalisé localement

**2) Aucune dépendance à l'outil**

- Export JSON / Excel à tout moment pour continuer le suivi dans un tableur
- Format de données ouvert et documenté
- Les modèles d'évaluation sont importables/exportables en `.xlsx`

---

## Fonctionnalités

### Registre des fournisseurs et scoring

- **Classification sur 6 axes** : impact opérationnel, processus dépendants, difficulté de remplacement, sensibilité des données, intégration au SI, exposition réglementaire
- **Niveau de menace** calculé automatiquement selon la formule EBIOS RM : `(Dépendance × Pénétration) / (Maturité × Confiance)`
- Dérivation automatique du **tier** (critique / élevé / moyen / faible)
- Détection automatique des **prestataires TIC critiques DORA**
- Matrice des risques 5×5 (initiaux et résiduels) avec frise chronologique

### Modèles d'évaluation et évaluations

- **Modèles d'évaluation** personnalisables pour les questionnaires (remplis par le fournisseur) ou les audits (remplis en interne). Deux modèles par défaut sont créés à la première visite, dont un audit basé sur les **42 règles d'hygiène ANSSI**.
- Éditeur graphique : sections, questions en texte libre, criticité (info / majeur / bloquant), poids (0--100)
- **Import depuis Excel** d'un modèle structuré (un fichier `.xlsx` d'exemple avec validation de données est téléchargeable)
- Évaluations pilotées par modèle avec **statut de couverture** (`Couverte` / `Partielle` / `Non couverte` / `Non applicable`), **actions correctives ou justification obligatoires** en cas de couverture partielle ou nulle, progression en temps réel, workflow de soumission pour approbation
- **Score de maturité pondéré** agrégeant plusieurs évaluations approuvées (criticité par question, poids par type d'évaluation, décroissance temporelle, surcharges manuelles)

### Portail fournisseur (application compagnon sous `/portal/`)

- Application web autonome pour permettre au fournisseur de remplir le questionnaire dans son propre navigateur, sans compte ni installation
- **Lien direct** chiffré AES-256 et gzippé dans l'URL (pratique pour les petits questionnaires)
- Partage par fichier (`.json`, `.ctenc`, `.xlsx`) avec un modèle d'email HTML prêt à envoyer
- Badge rouge « Date limite dépassée » dans l'en-tête quand la date limite est passée
- Sauvegarde automatique dans le `localStorage` du navigateur du fournisseur
- Le fournisseur ré-exporte sa réponse (JSON chiffré ou Excel) et la renvoie par email ; vous la ré-importez dans l'évaluation correspondante

### Registre DORA d'information (RoI)

- **Module Registre DORA** intégré, conforme au règlement UE 2024/2956 et aux ITS RoI de l'EBA (DPM v4.0)
- Tables prises en charge : **B_01.01 à B_07.01** (entités déclarantes, branches, hiérarchie, accords, signataires, sous-traitants, fonctions supportées, substituabilité)
- **Listes de valeurs EBA officielles** (activité agréée, type de service TIC, type d'accord, motif de résiliation, devise, pays…) avec libellés localisés FR/EN ; le code ITS (ex. `eba_TA:x182`) est conservé en stockage et émis tel quel à l'export
- **Recherche LEI via GLEIF** depuis chaque champ LEI (entités, signataires, sous-traitants)
- **Export RoI** (Fichier → Export RoI DORA) : génère un classeur XLSX EBA RoI ITS (un onglet par table B_xx) avec saisie de la période de reporting et de la devise cible — les montants en devises étrangères sont conservés et complétés d'une colonne normalisée
- **Onglet DORA par fournisseur** : carte agrégée des accords, signataires, sous-traitants déclarés et fonctions supportées
- **Gestion des sous-traitants** (4th parties) directement depuis la liste des fournisseurs (onglet Sous-traitants) ou depuis chaque accord (lien accord ↔ sous-traitant avec rang et service fourni)

### Suivi documentaire et historique

- **Registre documentaire** par fournisseur (certifications, DPA, rapports d'audit, politiques...) avec alertes d'expiration et vérification d'URL
- **Annuler / Rétablir** (Ctrl+Z / Ctrl+Y) sur toutes les actions
- **Snapshots** (points de sauvegarde) stockés dans le navigateur, avec chiffrement AES-256 optionnel
- Chiffrement AES-256-GCM avec dérivation PBKDF2 (250 000 itérations) pour les fichiers et les snapshots
- Interface bilingue FR / EN avec chargement différé de l'anglais

### Assistant IA (optionnel)

- Suggestions de **risques spécifiques** à la relation fournisseur
- Suggestions de **mesures d'atténuation** pour chaque risque
- **Collecte automatique** d'informations publiques sur le fournisseur (site web, secteur, certifications)
- **Suggestion de réponses** au questionnaire basée sur les informations connues
- Supporte **Anthropic (Claude)** et **OpenAI (GPT)**

---

## Prise en main

### Démo en ligne

L'application est accessible en ligne : **https://vendor.cisotoolbox.org/**

Le portail fournisseur est accessible sur **https://vendor.cisotoolbox.org/portal/**

### Fichier de démonstration

Un fichier de démonstration (`demo-fr.json`) est fourni avec l'application. Il contient un registre complet pour une entreprise fictive (MedSecure) avec une dizaine de fournisseurs, leurs classifications, risques, mesures et évaluations.

### Démarrage rapide

1. Ouvrir l'application dans un navigateur
2. Cliquer sur **Fichier > Ouvrir**
3. Sélectionner le fichier `demo-fr.json`
4. Parcourir les fournisseurs depuis la barre latérale (**Fournisseurs**)
5. Cliquer sur un fournisseur pour voir sa fiche détaillée (Informations / Risques / Évaluations / Documents)

### Workflow type d'une évaluation

1. Depuis **Modèles d'évaluation**, créer ou choisir un modèle (ou importer un `.xlsx`)
2. Ouvrir un fournisseur, onglet **Évaluations**, cliquer sur **Nouvelle évaluation** et sélectionner le modèle
3. Générer le lien direct pour le portail fournisseur (bouton **Lien direct**) ou exporter le fichier
4. Envoyer le lien + mot de passe au fournisseur par deux canaux séparés (email + SMS par exemple)
5. Le fournisseur remplit son questionnaire dans son navigateur et ré-exporte sa réponse
6. Ré-importer le fichier renvoyé dans l'évaluation, approuver ou renvoyer pour corrections

---

## Import / Export

L'application n'enferme pas les données. Tout peut être importé et exporté dans des formats ouverts :

| Action | Contexte | Format | Notes |
|--------|----------|--------|-------|
| **Ouvrir** / **Enregistrer sous** | Menu Fichier | `.json` / `.ctenc` | Format natif. Le `.ctenc` est chiffré AES-256-GCM avec PBKDF2 250k itérations. |
| **Export évaluation Excel** | Sur une évaluation | `.xlsx` | Fichier préfabriqué avec onglet instructions, colonnes d'identité verrouillées, listes déroulantes de couverture et mise en forme conditionnelle sur les actions/justifications manquantes. |
| **Export évaluation JSON / chiffré** | Sur une évaluation | `.json` / `.ctenc` | Sérialisation complète de l'évaluation + instantané du modèle. |
| **Lien d'évaluation** | Sur une évaluation | URL | Charge utile gzippée + chiffrée AES-256 dans le hash de l'URL. Pour les petits questionnaires (&lt; 2 Mo). |
| **Import évaluation** | Sur une évaluation | `.xlsx` / `.json` / `.ctenc` | Les réponses, couvertures et actions sont fusionnées dans l'évaluation existante. |
| **Import modèle Excel** | Page Modèles d'évaluation | `.xlsx` | Crée un nouveau modèle à partir d'un fichier structuré (Section, Question, Réponse attendue, Criticité, Poids). Un exemple téléchargeable est fourni. |

> **Note :** l'import/export Excel nécessite la bibliothèque [ExcelJS](https://github.com/exceljs/exceljs), chargée à la demande depuis un CDN (`cdn.jsdelivr.net`). Une connexion Internet est donc requise lors du premier import ou export Excel. Toutes les autres fonctionnalités (JSON, chiffrement, lien, analyse) fonctionnent entièrement hors-ligne.

---

## Architecture

### Principes de conception

| Principe | Détail |
|----------|--------|
| 100% client-side | Pas de backend, pas de base de données, pas de comptes utilisateurs |
| Souveraineté des données | Toutes les données restent dans le navigateur (localStorage + fichiers) |
| Pas d'étape de build | JavaScript vanilla, pas de framework, pas de transpileur, pas de `node_modules` |
| Bibliothèques partagées | Code commun (`cisotoolbox.js`, `cisotoolbox_local.js`, `i18n.js`, `ai_common.js`) partagé entre les apps CISO Toolbox |
| Chargement à la demande | Assets lourds (templates Excel, bibliothèque ExcelJS) chargés uniquement si nécessaire |
| Conforme CSP | Pas de script inline, pas de `eval`, pas de `unsafe-inline` pour le JS |

### Structure des fichiers

```
index.html                    Point d'entrée (app principale, <body class="ct-app-shell">)
css/
  cisotoolbox.css                Styles partagés (toolbar, sidebar, tableaux, dialogues, .ct-icon, .ct-app-shell)
  tprm.css                       Styles spécifiques à Vendor (cartes de modèles, cartes de tier, badges DORA)
js/
  i18n.js                        Moteur i18n (t(), switchLang, attributs data-i18n)
  cisotoolbox.js                 Bibliothèque partagée (événements, esc, _icon, CT_ICONS, undo/redo, AES)
  cisotoolbox_local.js           Persistance locale (autosave, fichiers, snapshots, _installUndoHook, _renderSnapshotsPanel)
  ct_refselect.js                Widget multi-sélection partagé
  referentiels_catalog.js        Catalogue partagé des référentiels
  ai_common.js                   Module IA partagé (fournisseurs, réglages, appels API)
  TPRM_data.js                   Données initiales (registre vide)
  TPRM_i18n_fr.js                Traductions FR (~600 clés + contenu d'aide)
  TPRM_i18n_en.js                Traductions EN (chargées à la demande)
  TPRM_questions.js              Catalogue des questions par défaut + règles ANSSI 42
  TPRM_app.js                    Logique applicative principale (~6200 lignes)
  TPRM_ai_assistant.js           Suggestions IA (risques, mesures, réponses, collecte d'informations)
portal/
  index.html                    Portail fournisseur (app autonome, pas de .ct-app-shell)
  css/portal.css                Styles spécifiques au portail (carte d'accueil, drop-zone, badge overdue)
  js/
    VendorPortal_app.js         Logique du portail (~1100 lignes)
    VendorPortal_i18n_fr.js     Traductions FR du portail
    VendorPortal_i18n_en.js     Traductions EN du portail
```

### Ordre de chargement des scripts

Les scripts sont chargés de manière synchrone dans un ordre strict en bas de `index.html`. L'ordre est important car chaque script dépend de globales définies par les précédents :

```
1. i18n.js                   Moteur i18n, doit être disponible avant tout appel à t()
2. cisotoolbox.js            Bibliothèque partagée (esc, _icon, undo/redo)
3. cisotoolbox_local.js      Persistance locale (dépend de cisotoolbox.js + D)
4. ct_refselect.js           Widget multi-select
5. referentiels_catalog.js   Catalogue des référentiels
6. TPRM_data.js              Définit D par défaut
7. TPRM_i18n_fr.js           Enregistre les clés FR
8. TPRM_questions.js         Catalogue des questions + règles ANSSI 42
9. TPRM_app.js               App principale (dépend de tous les précédents)
10. ai_common.js             Lit AI_APP_CONFIG, fournit les fonctions IA partagées
11. TPRM_ai_assistant.js     Enveloppe les fonctions de rendu avec les hooks IA
```

### Patterns clés

**CT_CONFIG** -- Chaque application déclare un objet de configuration avant que `cisotoolbox.js` ne s'exécute :

```javascript
window.CT_CONFIG = {
    autosaveKey: "tprm_autosave",
    initDataVar: "TPRM_INIT_DATA",
    label: "analyse",
    filePrefix: "TPRM",
    getSociete: function() { return D.metadata && D.metadata.organization || ""; },
    getDate: function() { return D.metadata && D.metadata.date || ""; }
};
```

**D** -- L'objet de données global contenant l'intégralité du registre (fournisseurs, risques, mesures, documents, évaluations, modèles, configuration de maturité). Il est sérialisé en JSON pour la sauvegarde/export et désérialisé à l'ouverture/import.

**Délégation d'événements** -- Aucun gestionnaire d'événement inline (`onclick`, `onchange`). Toutes les interactions utilisent les attributs `data-click`, `data-change` et `data-input` dispatchés par `_safeDispatch()`. Ceci est conforme CSP et évite `unsafe-inline`.

**`<body class="ct-app-shell">`** -- La classe active le layout fixe toolbar + sidebar + scroll interne (`body { overflow: hidden; height: 100vh; }` dans `cisotoolbox.css`). Le portail fournisseur omet cette classe pour bénéficier du scroll document naturel d'une page simple.

**Helpers partagés** --

| Helper | Fichier | Usage |
|---|---|---|
| `_icon("plus")` / `_icon("trash", 18)` | `cisotoolbox.js` | Icône SVG inline (style Lucide) qui hérite de `currentColor`. Jeu `CT_ICONS` : plus, minus, check, x, upload, download, clipboard, shield, pencil, copy, trash, search, settings, alert. |
| `_installUndoHook()` | `cisotoolbox_local.js` | À appeler une fois au boot. Enveloppe `_autoSave` pour empiler l'état précédent sur `_undoStack` à chaque sauvegarde. Les apps n'ont plus besoin de sprinkler `_saveState()`. Compatible avec les appels manuels (anti-doublon sur le top de la pile). |
| `_renderSnapshotsPanel({target, orgField, keys})` | `cisotoolbox_local.js` | Rend le panneau Snapshots commun (Créer / Chiffrer / Restaurer / Exporter / Supprimer). Chaque app passe ses propres clés i18n et le nom du champ organisation. |

**Modèles d'évaluation (templates)** -- Les modèles vivent dans `D.questionnaire_templates[]`. Chaque modèle contient des sections et des questions `free_text` avec criticité et poids. Une évaluation (`D.assessments[]`) embarque un **instantané** du modèle au moment de sa création (`template_snapshot`), ce qui garantit que les modifications ultérieures du modèle n'affectent pas les évaluations déjà en cours.

**Lien de partage avec le portail** -- Le bouton « Lien direct » d'une évaluation génère une URL de la forme `https://vendor.cisotoolbox.org/portal/#data=v1gz.<base64url>`. Le payload est construit ainsi : `JSON.stringify(assessment)` → compression gzip via `CompressionStream` → chiffrement AES-256-GCM avec la clé dérivée du mot de passe → encodage base64url. Le portail déchiffre côté navigateur après saisie du mot de passe.

### Flux de données

```
Interaction utilisateur
    |
    v
updateField(path, value)   -- écrit dans D
    |
    v
_autoSave()                -- écrit D dans localStorage
    |
    v (via _installUndoHook)
_undoStack.push(état précédent)
```

**Opérations sur les fichiers :**

```
Ouvrir    --> _loadBuffer() --> gère le chiffrement (AES-256-GCM) --> JSON.parse --> D
Enregistrer --> _serializeForSave() --> JSON ou blob chiffré --> File System Access API ou téléchargement
```

**Génération et ouverture d'un lien portail :**

```
Issuer : assessment --> JSON.stringify --> gzip --> AES-256-GCM(password) --> base64url --> URL hash
Vendor : URL hash --> base64url decode --> AES-256-GCM decrypt(password) --> gunzip --> JSON.parse --> Q
```

### Architecture de la bibliothèque partagée

Chaque application vit dans son propre dépôt git. Les fichiers partagés sont maintenus à l'identique entre toutes les apps de la suite CISO Toolbox et copiés dans chaque app par `shared/deploy-all-staging.sh` :

| Fichier | Rôle |
|---------|------|
| `cisotoolbox.js` | Délégation d'événements, I/O fichiers, chiffrement, undo/redo, icônes SVG (`_icon`, `CT_ICONS`), palette (`CT_COLORS`), sliders |
| `cisotoolbox_local.js` | Auto-save, ouverture/sauvegarde fichier, bannière de restauration, snapshots CRUD, `_installUndoHook`, `_renderSnapshotsPanel` |
| `cisotoolbox.css` | Styles partagés (toolbar, sidebar, tableaux, dialogues, `.ct-icon`, normalisation `td > input/select`, opt-in `body.ct-app-shell`) |
| `i18n.js` | Moteur de traduction : `t(clé)`, `switchLang()`, scan des attributs `data-i18n` |
| `ai_common.js` | Configuration des fournisseurs IA, wrapper d'appel API, panneau de réglages |
| `ct_refselect.js` | Widget multi-sélection partagé |
| `referentiels_catalog.js` | Métadonnées des 9 référentiels complémentaires |

---

## Sécurité

| Mesure | Détail |
|--------|--------|
| **CSP** | `script-src 'self' https://cdn.jsdelivr.net` -- pas de script inline, pas de `eval` |
| **X-Frame-Options** | `DENY` -- empêche le clickjacking via iframe |
| **X-Content-Type-Options** | `nosniff` -- empêche le navigateur de deviner le Content-Type |
| **Permissions-Policy** | Désactive caméra, micro, géolocalisation, paiement, USB, capteurs |
| **Chiffrement** | AES-256-GCM avec dérivation PBKDF2 (250 000 itérations) pour les fichiers, les snapshots et les liens de partage |
| **Clés API IA** | Stockées uniquement en localStorage, jamais incluses dans les fichiers sauvegardés |
| **Mot de passe de déchiffrement** | Saisie dans un modal à champ masqué (`<input type="password">`), jamais stocké, jamais loggé |
| **Blocklist de dispatch** | `_safeDispatch` refuse d'appeler les fonctions internes/dangereuses |
| **Assainissement HTML** | Toutes les saisies utilisateur sont échappées via `esc()` avant insertion dans le DOM |
| **SRI** | Intégrité vérifiée pour ExcelJS chargé depuis un CDN |
| **HTTPS** | Imposé au niveau du serveur/hébergement |
| **Pas de serveur** | Aucune donnée ne transite par un serveur tiers (sauf assistant IA si activé) |

---

## Assistant IA

### Fonctionnement

L'assistant IA fournit un panneau de suggestions pour chaque fournisseur. Lorsqu'il est ouvert, il envoie le contexte du fournisseur en cours (nom, secteur, site web, classification, risques existants) accompagné d'un prompt au fournisseur IA sélectionné.

Fonctionnalités principales :

- **Collecte d'informations** -- pré-remplit la fiche fournisseur (site web, secteur, pays, services) à partir du nom seul
- **Suggestion de risques** -- identifie des risques spécifiques à la relation fournisseur (non génériques) avec mesures d'atténuation associées
- **Suggestion de mesures** -- pour un risque donné, propose des mesures contractuelles / techniques / organisationnelles
- **Suggestion de réponses** -- aide au remplissage du questionnaire basée sur les informations publiques du fournisseur

### Fournisseurs supportés

| Fournisseur | Modèles | Endpoint API |
|-------------|---------|-------------|
| Anthropic | Claude (Sonnet, Haiku) | `https://api.anthropic.com` |
| OpenAI | GPT-4o, GPT-4o-mini | `https://api.openai.com` |

### Configuration

1. Cliquer sur la roue crantée dans la barre d'outils
2. Saisir une clé API du fournisseur choisi
3. Activer le toggle « Assistant IA »
4. Un avertissement détaillé de sécurité est affiché (voir ci-dessous)

### Avertissements de confidentialité et de sécurité

> En activant l'assistant IA, vous acceptez les points suivants :
>
> 1. **Partage de données** -- Les données de votre registre (noms de fournisseurs, secteurs, classifications, risques, mesures) sont envoyées au fournisseur IA sélectionné pour générer des suggestions. Assurez-vous que votre politique de confidentialité et vos engagements contractuels (clauses de sous-traitance, RGPD, NDA, accords de non-divulgation fournisseur) autorisent ce partage avec un service tiers.
>
> 2. **Exposition de la clé API** -- L'application fonctionne sans serveur backend. La clé API est donc transmise directement depuis votre navigateur vers l'API du fournisseur. Cela implique que :
>    - La clé est visible dans les outils de développement du navigateur (onglet Network)
>    - Les extensions navigateur disposant de la permission `webRequest` peuvent la capturer
>    - Un proxy d'entreprise peut journaliser les headers HTTP (même si le contenu est chiffré en HTTPS)
>
>    **Recommandation :** utilisez un profil navigateur dédié, sans extensions, pour les analyses contenant des données sensibles.
>
> 3. **Stockage de la clé** -- La clé API est stockée dans le `localStorage` du navigateur. Elle n'est jamais incluse dans les fichiers JSON sauvegardés. Toute personne ayant accès au navigateur (même session, même profil) peut la lire via les DevTools.
>
> 4. **Aucune garantie sur les réponses** -- Les suggestions générées par l'IA sont des propositions à valider par l'analyste. Elles ne se substituent pas à l'expertise humaine et à la connaissance du contexte de la relation fournisseur.

---

## Déploiement

L'application est un ensemble de fichiers statiques. Aucun serveur applicatif n'est nécessaire.

### Options d'hébergement

- **Serveur web** (Apache, Nginx, hébergement statique) -- déposer les fichiers
- **Poste local** -- ouvrir `index.html` dans un navigateur (les assets JS doivent être dans la même arborescence)
- **Intranet** -- aucune connexion Internet requise après le chargement initial

### Fonctionnement hors-ligne

L'application fonctionne hors-ligne une fois chargée, avec deux exceptions :

- **Import/export Excel** nécessite la bibliothèque ExcelJS depuis le CDN lors de la première utilisation
- **Assistant IA** nécessite une connexion Internet pour communiquer avec l'API du fournisseur

### Instances en ligne

| Environnement | URL |
|---------------|-----|
| Production | https://vendor.cisotoolbox.org |
| Portail fournisseur (production) | https://vendor.cisotoolbox.org/portal/ |
| Staging | https://vendor.cisotoolbox.org/staging |
| Portail fournisseur (staging) | https://vendor.cisotoolbox.org/staging/portal/ |

---

## Contribuer

Ce projet est open source. Les contributions sont les bienvenues : signalement de bugs, suggestions de fonctionnalités, ajout de modèles d'évaluation, traductions, améliorations du code.

Site : **https://www.cisotoolbox.org**

---

## Licence

MIT
