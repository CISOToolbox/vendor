# Vendor (TPRM) -- Application web de gestion des risques fournisseurs


> **Ceci est la version 100 % navigateur** — tout s'exécute dans votre
> navigateur, les données n'en sortent jamais (localStorage + export JSON).
> Idéale en solo, pour évaluer, pour un consultant sur les données d'un
> client, ou en contexte isolé. Besoin de comptes, d'une base partagée,
> d'une API et du multi-utilisateurs ? Le **backend standalone** du même
> module est à la [racine de ce dépôt](../) — mêmes fonctionnalités, même
> format de données, un export JSON fait passer votre travail de l'un à
> l'autre. Voir « One repository, two versions » dans le README principal.

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
- **Score de maturité pondéré** agrégeant les évaluations validées du fournisseur (poids par question, poids par type d'évaluation ou par modèle, décroissance temporelle, surcharge du poids ou exclusion par évaluation)

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
- Interface bilingue FR / EN : les deux langues sont chargées au démarrage et la bascule se fait sur place (bouton globe de la barre d'outils ou panneau de réglages) ; le choix est conservé dans `localStorage["ct_lang"]`

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

Le dépôt fournit un jeu de données de démonstration fictif (MedSecure) :
`demo-fr.json` et `demo-en.json`. Il se charge depuis le panneau de réglages,
section *Démonstration* (le fichier de la langue courante est chargé). Le
chargement passe par `fetch()` : servez l'application avec un serveur statique
plutôt que de l'ouvrir en `file://`.

### Démarrage rapide

1. Ouvrir l'application dans un navigateur
2. Aller dans **Fournisseurs** et cliquer sur **Ajouter**
3. Parcourir les fournisseurs depuis la barre latérale (**Fournisseurs**)
4. Cliquer sur un fournisseur pour voir sa fiche détaillée (Informations / Risques / Évaluations / Documents / Registre DORA)

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
| **Lien d'évaluation** | Sur une évaluation | URL | Charge utile gzippée + chiffrée AES-256 dans le hash de l'URL. Pour les petits questionnaires : au-delà de 8 000 caractères, l'application signale un risque de troncature par certains clients mail, et au-delà de 12 000 recommande l'export en fichier chiffré. |
| **Import évaluation** | Sur une évaluation | `.xlsx` / `.json` / `.ctenc` | Les réponses, couvertures et actions sont fusionnées dans l'évaluation existante. |
| **Import modèle Excel** | Page Modèles d'évaluation | `.xlsx` | Crée un nouveau modèle à partir d'un fichier structuré (Section, Question, Réponse attendue, Criticité, Poids). Un exemple téléchargeable est fourni. |

> **Note :** l'import/export Excel utilise la bibliothèque [ExcelJS](https://github.com/exceljs/exceljs), livrée avec l'application sous `js/vendor/` et chargée à la demande depuis la même origine. Aucune connexion Internet n'est requise : l'application fonctionne intégralement hors-ligne.

---

## Architecture

### Principes de conception

| Principe | Détail |
|----------|--------|
| 100% client-side | Pas de backend, pas de base de données, pas de comptes utilisateurs |
| Souveraineté des données | Toutes les données restent dans le navigateur (localStorage + fichiers) |
| Pas d'étape de build pour l'exécuter | JavaScript vanilla, pas de framework, pas de bundler, pas de `node_modules` ; le code propre au module est écrit en TypeScript (`ts/`) et le JavaScript compilé (`js/`) est versionné (voir CONTRIBUTING) |
| Bibliothèques partagées | Code commun (`cisotoolbox.js`, `cisotoolbox_local.js`, `i18n.js`, `ai_common.js`) partagé entre les apps CISO Toolbox |
| Chargement à la demande | La bibliothèque ExcelJS (`js/vendor/`) n'est chargée qu'au premier import ou export Excel |
| Conforme CSP | Pas de script inline, pas de `eval`, pas de `unsafe-inline` pour le JS |

### Structure des fichiers

```
index.html                    Point d'entrée (app principale, <body class="ct-app-shell">)
css/
  cisotoolbox.css                Styles partagés (toolbar, rail, tableaux, dialogues, .ct-icon, .ct-app-shell)
  tprm.css                       Styles spécifiques à Vendor (cartes de modèles, cartes de tier, badges DORA)
ts/                              Sources TypeScript du code propre au module (compilées vers js/)
js/
  Partagés :
  cisotoolbox.js                 Bibliothèque commune (événements, esc, _icon, CT_ICONS, undo/redo, AES)
  i18n.js, i18n_core_fr.js, i18n_core_en.js   Moteur i18n et clés communes
  ct_schema.js                   Versionnement et migration du modèle de données
  cisotoolbox_local.js           Persistance locale (autosave, fichiers, snapshots)
  ct_refselect.js                Widget multi-sélection
  ct_modal.js                    Dialogues
  ct_userpicker.js               Champ « personne » (texte libre dans cette app, sans annuaire)
  ct_measure_modal.js            Fenêtre de mesure
  ct_nonconformity.js, ct_nonconformity_local.js   Registre des non-conformités et dérogations
  ct_table.js, ct_bulkbar.js     Tableaux et actions groupées
  ai_common.js                   Module IA (fournisseurs, réglages, appels API)
  ct_settings.js                 Panneau de réglages
  Propres à Vendor :
  TPRM_i18n_fr.js, TPRM_i18n_en.js   Traductions
  TPRM_questions.js              Catalogue des questions par défaut
  TPRM_app.js                    Logique applicative principale (registre vide, modèle d'audit ANSSI 42 règles)
  TPRM_dora.js                   Registre d'informations DORA (RoI)
  TPRM_dora_validation.js        Contrôles de cohérence du RoI
  TPRM_dora_export.js            Export du RoI au format du classeur EBA
  dora_codelists.js, dora_codelists_i18n.js   Listes de codes DORA et leurs libellés
  vendor/exceljs.min.js          ExcelJS (bibliothèque tierce), chargé à la demande pour les imports et exports Excel
portal/
  index.html                    Portail fournisseur (app autonome, pas de .ct-app-shell)
  css/portal.css                Styles spécifiques au portail (carte d'accueil, drop-zone, badge overdue)
  ts/                           Sources TypeScript du portail
  js/
    VendorPortal_app.js         Logique du portail
    VendorPortal_i18n_fr.js     Traductions FR du portail
    VendorPortal_i18n_en.js     Traductions EN du portail
fonts/                          Polices embarquées (aucun chargement externe)
e2e/                            Tests de bout en bout (Playwright)
```

Le portail charge depuis l'app principale le socle partagé, l'i18n (commun et
du module) et les feuilles de style (`../js/`, `../css/`).

### Ordre de chargement des scripts

Les scripts sont chargés de manière synchrone dans un ordre strict en bas de `index.html`. L'ordre est important car chaque script dépend de globales définies par les précédents :

```
1. cisotoolbox.js            Bibliothèque partagée (esc, _icon, undo/redo)
2. i18n.js                   Moteur i18n
3. i18n_core_en.js, i18n_core_fr.js   Clés communes
4. ct_schema.js              Migration du modèle de données
5. cisotoolbox_local.js      Persistance locale
6. TPRM_i18n_fr.js, TPRM_i18n_en.js   Traductions du module
7. TPRM_questions.js         Catalogue des questions par défaut
8. dora_codelists.js, dora_codelists_i18n.js   Listes de codes DORA
9. ct_refselect.js, ct_modal.js, ct_userpicker.js, ct_measure_modal.js,
   ct_nonconformity.js, ct_nonconformity_local.js, ct_table.js, ct_bulkbar.js
                             Composants partagés
10. TPRM_app.js              App principale (dépend de tous les précédents)
11. TPRM_dora_validation.js, TPRM_dora.js, TPRM_dora_export.js   Registre DORA
12. ai_common.js             Lit AI_APP_CONFIG, fournit les fonctions IA partagées
13. ct_settings.js           Panneau de réglages
```

### Patterns clés

**CT_CONFIG** -- Chaque application déclare un objet de configuration avant que `cisotoolbox.js` ne s'exécute :

```javascript
window.CT_CONFIG = {
    autosaveKey: "tprm_autosave",
    initDataVar: "TPRM_INIT_DATA",
    filePrefix: "TPRM",
    labelKey: "toolbar.subtitle",
    getSociete: function (data) { return (data.metadata && data.metadata.organization) || ""; },
    getDate: function (data) { return (data.metadata && data.metadata.created) || ""; }
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
modification de D          -- ex. _autoSaveVendorField(), updateRiskField()
    |
    v
_persist() / _persistCreate() / _persistDelete()
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

Chaque application vit dans son propre dépôt git. Les fichiers partagés sont identiques entre toutes les apps de la suite CISO Toolbox ; ils portent un en-tête « Generated file - do not edit » et sont réécrits à chaque release (voir [CONTRIBUTING.md](CONTRIBUTING.md) — ils ne doivent pas être édités ici) :

| Fichier | Rôle |
|---------|------|
| `cisotoolbox.js` | Délégation d'événements, I/O fichiers, chiffrement, undo/redo, icônes SVG (`_icon`, `CT_ICONS`), palette (`CT_COLORS`), sliders |
| `cisotoolbox_local.js` | Auto-save, ouverture/sauvegarde fichier, bannière de restauration, snapshots CRUD, `_installUndoHook`, `_renderSnapshotsPanel` |
| `cisotoolbox.css` | Styles partagés (toolbar, rail, tableaux, dialogues, `.ct-icon`, normalisation `td > input/select`, opt-in `body.ct-app-shell`) |
| `i18n.js`, `i18n_core_*.js` | Moteur de traduction (`t(clé)`, `switchLang()`, attributs `data-i18n`) et clés communes |
| `ai_common.js` | Configuration des fournisseurs IA, wrapper d'appel API, panneau de réglages |
| `ct_*.js` | Composants partagés : schéma et migration (`ct_schema`), modales (`ct_modal`, `ct_measure_modal`), multi-sélection (`ct_refselect`), personne (`ct_userpicker`), non-conformités (`ct_nonconformity*`), tableaux (`ct_table`, `ct_bulkbar`), réglages (`ct_settings`) |

---

## Sécurité

| Mesure | Détail |
|--------|--------|
| **CSP** | `script-src 'self'` -- pas de script inline, pas de `eval`, aucun CDN externe |
| **X-Frame-Options** | `DENY` -- empêche le clickjacking via iframe |
| **X-Content-Type-Options** | `nosniff` -- empêche le navigateur de deviner le Content-Type |
| **Permissions-Policy** | Désactive caméra, micro, géolocalisation, paiement, USB, capteurs |
| **Chiffrement** | AES-256-GCM avec dérivation PBKDF2 (250 000 itérations) pour les fichiers, les snapshots et les liens de partage |
| **Clés API IA** | Stockées uniquement en localStorage, jamais incluses dans les fichiers sauvegardés |
| **Mot de passe de déchiffrement** | Saisie dans un modal à champ masqué (`<input type="password">`), jamais stocké, jamais loggé |
| **Blocklist de dispatch** | `_safeDispatch` refuse d'appeler les fonctions internes/dangereuses |
| **Assainissement HTML** | Toutes les saisies utilisateur sont échappées via `esc()` avant insertion dans le DOM |
| **SRI** | Sans objet : ExcelJS est servi depuis la même origine (`js/vendor/`), plus aucun chargement tiers |
| **HTTPS** | Imposé au niveau du serveur/hébergement |
| **Pas de serveur** | Aucune donnée ne transite par un serveur du projet. Seules sortent les requêtes que vous déclenchez : assistant IA (si activé), recherche LEI GLEIF (`api.gleif.org`) dans le registre DORA, URL de logo saisie, vérification des URL de documents trouvées par la collecte IA |

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

| Fournisseur | Endpoint API |
|-------------|-------------|
| Anthropic (Claude) | `https://api.anthropic.com` |
| OpenAI (GPT) | `https://api.openai.com` |

La CSP livrée (`.htaccess.example`, `nginx-security.conf.example`) autorise en
`connect-src` exactement ces deux hôtes.

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

L'application fonctionne hors-ligne une fois chargée, avec ces exceptions :

- **Import/export Excel** charge ExcelJS depuis `js/vendor/` lors de la première utilisation (aucun accès réseau)
- **Assistant IA** nécessite une connexion Internet pour communiquer avec l'API du fournisseur
- **Recherche LEI** du registre DORA interroge `api.gleif.org`

### Instances en ligne

| Environnement | URL |
|---------------|-----|
| Production | https://vendor.cisotoolbox.org |
| Portail fournisseur (production) | https://vendor.cisotoolbox.org/portal/ |

---

## Contribuer

Ce projet est open source. Les contributions sont les bienvenues : signalement de bugs, suggestions de fonctionnalités, ajout de modèles d'évaluation, traductions, améliorations du code.

Site : **https://www.cisotoolbox.org**

---

## Licence

MIT
