# Prépa JA Badminton — juge-arbitre et arbitre

Application web **installable et utilisable hors ligne** (et application Android) pour préparer les
examens des officiels techniques de badminton de la FFBaD, en **deux parcours** :

| Parcours | Examen blanc | Contenu |
|---|---|---|
| Juge-arbitre | JALA (juge-arbitre de ligue accrédité) | RGC et annexes, BadNet, déroulement de la compétition, rapport, sanctions, interclubs… |
| Arbitre | ALA (arbitre de ligue accrédité) | Règles du jeu, instructions aux officiels techniques, annonces et terminologie, juge de service et juges de ligne |

Les questions propres aux grades supérieurs (JALC, JAFA, JAFC) restent disponibles en entraînement
juge-arbitre, mais n'entrent ni dans l'examen blanc JALA ni dans la jauge.

L'application est un site statique (HTML, CSS, JavaScript sans dépendance) hébergé sur
**GitHub Pages**. Elle fonctionne comme une application de préparation aux certifications :
questions avec correction expliquée, examens blancs chronométrés, cas pratiques, fiches et
tous les règlements officiels consultables hors ligne.

## Fonctionnalités

- **Premier lancement** : parcours (juge-arbitre ou arbitre), niveau de connaissance (je découvre,
  j'ai des bases, je révise l'examen), priorités de travail et ligue. Ces préférences restent
  uniquement sur l'appareil (localStorage) et se modifient dans les réglages.
- **Banque de plus de 2 400 questions** (QCM à une ou plusieurs réponses), chacune avec son explication,
  le lien vers l'article cité et l'extrait du texte officiel.
- **Entraînement direct** : l'accueil lance une série en un appui (*Mes priorités*, tout le programme ou
  un domaine : avant, pendant, après la compétition, RGC, BadNet, ma ligue ; pour l'arbitre : règles du
  jeu, arbitrage et annonces, juge de ligne). Aucune indication avant la réponse ; une fois répondu, la
  correction est complète : réponse attendue, explication, référence et extrait du texte officiel.
  *Mes erreurs* reprend les questions ratées.
- **Sans répétition** : chaque utilisateur parcourt la banque dans un ordre qui lui est propre ; une
  question déjà vue ne revient qu'à échéance (10 min après une erreur, puis 1, 3, 7, 16 et 35 jours).
  Le niveau « Je découvre » commence par les questions les plus simples.
- **Examens blancs** JALA et ALA : chronomètre, navigation entre questions, correction détaillée,
  résultats par thème, conditions personnalisables.
- **Questions propres à la ligue** (Île-de-France, Nouvelle-Aquitaine) : interclubs régionaux,
  autorisation des tournois, forfaits, championnats régionaux.
- **Ressources** : règlements (Guide du Badminton, Règles officielles, règlements de la ligue choisie),
  fiches, glossaire, recherche, cas pratiques, outils (classement de poule, dimensionnement d'une
  compétition, check-lists, auto-évaluation).
- **Jauge de préparation** calculée localement (connaissances, examens blancs, pratique).
- **Hors ligne et mises à jour** : l'application, les questions et les règlements sont en cache dès la
  première visite (ou embarqués dans l'appli Android). Dès qu'une connexion est disponible, l'application
  vérifie en arrière-plan si une nouvelle version des questions est publiée (au démarrage, au retour sur
  l'application, au retour du réseau), la conserve sur l'appareil et l'utilise aussitôt, même si
  l'ancienne version est en cache. L'appli Android interroge pour cela le site publié.
- **Bot de mise à jour** des règlements (Guide du Badminton et règlements de ligue).
- Aucune donnée personnelle envoyée : tout reste sur l'appareil (export/import possible).

## Mettre l'application en ligne sur GitHub Pages

L'application se trouve dans le dossier [`docs/`](docs/). Deux possibilités :

**Option A — avec GitHub Actions (recommandée, nécessaire pour le bot)**

1. Fusionner ce travail dans la branche principale (`main`).
2. Dans le dépôt : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. Le workflow [`Déploiement GitHub Pages`](.github/workflows/deploy-pages.yml) publie le site à
   chaque modification de `docs/` (ou manuellement : **Actions → Déploiement GitHub Pages → Run workflow**).
4. L'adresse est `https://<votre-compte>.github.io/<nom-du-dépôt>/`.

**Option B — sans Actions** : **Settings → Pages → Deploy from a branch**, branche `main`,
dossier `/docs`.

## Installer l'application sur un téléphone et l'utiliser hors ligne

1. Ouvrir l'adresse du site une première fois avec une connexion (le contenu de base se met
   en cache automatiquement).
2. **Android (Chrome, Edge, Samsung Internet)** : menu ⋮ → « Installer l'application » ou bouton
   « Installer » de la page **Mode hors-ligne**.
   **iPhone / iPad (Safari)** : bouton Partager → « Sur l'écran d'accueil ».
3. Dans l'application : **Réglages → Gérer le mode hors-ligne → Télécharger le pack complet**
   pour stocker aussi les PDF officiels. Le stockage persistant est demandé au navigateur.
4. Quand une nouvelle version (questions ou règlements) est publiée, un bandeau propose
   « Mettre à jour » à la prochaine ouverture avec du réseau.

## Application Android (APK et Play Store)

Le dossier `android/` est un projet [Capacitor](https://capacitorjs.com) qui embarque l'application web (`docs/`) : l'appli Android fonctionne entièrement hors ligne, sans dépendre du site.

**Publier une version** : changer le numéro dans `android/VERSION` (par exemple `1.1.0`) et pousser, pousser un tag `vX.Y.Z`, ou lancer le workflow **Application Android** depuis l'onglet *Actions*. Le workflow vérifie le contenu, construit l'APK et l'AAB, puis crée la release GitHub avec les deux fichiers :

- `prepa-ja-X.Y.Z.apk` : à installer directement sur un téléphone ;
- `prepa-ja-X.Y.Z.aab` : à déposer dans la Play Console (le Play Store n'accepte que le format AAB).

Le code de version Android est calculé à partir du tag (`1.2.3` → `10203`) : chaque nouvelle version envoyée au Play Store doit avoir un numéro supérieur.

**Clé de signature Play Store (une seule fois)** : créer une clé d'envoi et la garder précieusement (elle ne doit jamais être perdue ni publiée).

```
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.jks     # sous macOS : base64 -i upload.jks | tr -d "\n"
```

Puis, dans *Settings > Secrets and variables > Actions* du dépôt, ajouter les secrets `ANDROID_KEYSTORE_BASE64` (sortie de la commande base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`) et `ANDROID_KEY_PASSWORD`. Sans ces secrets, le workflow signe avec une clé de test jetable : l'APK s'installe, mais l'AAB est refusé par le Play Store. Dans la Play Console, activer la *signature des applications par Google Play* et déclarer cette clé comme clé d'importation.

**Fiche Play Store** : textes, réponses aux questionnaires de la Play Console, icône 512 × 512, bannière 1024 × 500 et 8 captures d'écran dans [`store/`](store/fiche-play-store.md) (visuels régénérés par `node scripts/store_assets.mjs`).

**Règles de confidentialité** : page `docs/confidentialite.html`, publiée à l'adresse https://nathan33670-spec.github.io/Examen-jala/confidentialite.html (à indiquer dans la Play Console) et accessible depuis les réglages de l'application.

**Construire en local** (JDK 21 et SDK Android requis) : `npm ci && npx cap sync android && cd android && ./gradlew assembleRelease bundleRelease`. Les icônes Android se régénèrent avec `python scripts/android_assets.py`. Identifiant de l'application : `fr.corsicajack.prepajala` (dans `capacitor.config.json` et `android/app/build.gradle`) ; il devient définitif dès la première publication sur le Play Store.

## Sécurité et performances

- **Politique de sécurité du contenu (CSP)** : seuls les scripts de l'application s'exécutent (aucun script
  en ligne, aucune URL `javascript:`), les connexions sont limitées à l'application et au site publié (mises
  à jour des questions de l'appli Android), pas de formulaire ni d'objet externe.
- **Données locales** : tout ce qui est lu depuis le stockage de l'appareil ou un fichier importé est
  normalisé (clés connues, types et bornes contrôlés, identifiants vérifiés, `__proto__` ignoré) ; un fichier
  forgé ne peut ni casser l'application ni injecter de contenu (test de bout en bout dédié).
- **Mises à jour des questions** : fichier téléchargé contrôlé (taille, structure de chaque question,
  réponses valides, images locales uniquement), refusé s'il est plus petit que la banque embarquée (pas de
  retour en arrière) ; seul un petit `data/version.json` est téléchargé tant que rien n'a changé.
- **Liens** : liens externes en `https://` uniquement, ouverts avec `rel="noopener"`.
- **Service worker** : mise en cache limitée aux fichiers de l'application ; installation du cache hors
  ligne après le premier affichage pour ne pas ralentir le démarrage.
- **Android** : trafic non chiffré interdit, débogage de la WebView désactivé, partage de fichiers réduit
  au cache de l'application, aucune autre permission qu'Internet.
- **GitHub** : actions épinglées par empreinte de commit, permissions minimales, valeurs saisies passées
  par variables d'environnement (pas d'injection de commande), mises à jour de sécurité proposées par
  Dependabot (`.github/dependabot.yml`).

## Le bot de mise à jour des règlements

Le Guide du Badminton est publié sur [gdb.ffbad.org](https://gdb.ffbad.org), qui expose une API
publique (`/api/seasons`, `/api/tree/<saison>`). Le script
[`bot/update_regulations.py`](bot/update_regulations.py) :

1. détermine la saison en cours (la saison FFBaD commence le 1er septembre) et récupère aussi les
   documents déjà publiés pour la saison suivante (rubrique « À venir » de l'application) ;
2. télécharge les chapitres utiles aux juges-arbitres (liste configurable dans
   [`bot/sources.json`](bot/sources.json) ; `"all": true` pour tout le Guide) ainsi que les
   **Règles officielles du badminton**, dont le lien est découvert dans le chapitre 03.00 ;
3. détecte les nouvelles versions (empreinte SHA-256), extrait le texte (avec `pdftotext`) et met à
   jour `docs/reglements/`, `docs/data/catalog.json` et l'historique `docs/data/updates.json` ;
4. reconstruit le cache hors ligne (`scripts/build_site.py`), ce qui déclenche le bandeau de mise à
   jour chez les utilisateurs ;
5. produit un rapport listant les **questions qui citent un document modifié**.

Le workflow [`Mise à jour des règlements`](.github/workflows/update-regulations.yml) l'exécute le
lundi et le jeudi. En mode `commit` (par défaut), il publie directement, relance le déploiement
et ouvre une issue « questions à relire » ; en mode `pr` (lancement manuel), il ouvre une pull
request à valider.

Réglages GitHub nécessaires :
- **Settings → Actions → General → Workflow permissions : Read and write permissions** ;
- pour le mode `pr` : cocher **Allow GitHub Actions to create and approve pull requests**.

GitHub suspend les tâches planifiées d'un dépôt sans activité pendant 60 jours : si cela arrive,
réactivez le workflow depuis l'onglet **Actions**.

Lancement manuel en local :

```bash
pip install -r bot/requirements.txt        # pypdf ; installer aussi poppler-utils (pdftotext)
python bot/update_regulations.py --report rapport.md
```

### Règlements de ligue

Le choix « Ma ligue » (premier lancement ou réglages) affiche les règlements de cette ligue dans la bibliothèque et ajoute ses questions à l'entraînement (catégorie « Ma ligue »). Les règlements de ligue sont déclarés dans `bot/sources.json` (entrées `extra` avec `"ligue": "<code>"` et une adresse `url` fixe, à mettre à jour à chaque saison) ; `python bot/update_regulations.py --only-ligues` les télécharge sans toucher au Guide du Badminton. Une question qui cite un document de ligue (`R: LIFB.ICRS 6.12`) n'est proposée qu'aux licenciés de cette ligue ; on peut aussi marquer une question à la main avec `G: <code>`. Ligues intégrées aujourd'hui : Île-de-France (LIFB) et Nouvelle-Aquitaine (LNAQ).

## Conditions d'examen : ce qui est officiel et ce qui est simulé

- **JALA** (chapitre 06.02 du Guide du Badminton, édition 2026/1) : contrôle de connaissances passé
  pendant le stage pratique, seul, en temps limité et sous surveillance ; **seuil de 80 %** (mémento
  d'évaluation JALA de la CFOT) ; rattrapage dans les 6 mois ; puis examen pratique sur une journée de
  compétition avec finales.
- **ALA** (annexe 01 du chapitre 06.01) : certification théorique et pratique d'une journée par la
  commission de ligue des officiels techniques, après la formation FormaBad.

Le nombre de questions et la durée des épreuves ne sont pas publiés : l'application utilise des
valeurs d'entraînement (JALA 40 questions / 60 min, ALA 30 / 45 min, seuil 80 %), modifiables dans
l'écran d'examen (seuil, durée, nombre de questions, pénalité pour réponse fausse, documents autorisés).
Une question à réponses multiples n'est juste que si toutes les bonnes réponses, et elles seules,
sont cochées.

Depuis le **1er septembre 2026**, la FFBaD applique le **système de score en 3×15** (sets de
15 points, prolongation à 14-14, plafond à 21, pauses et changement de côté à 8 points) ; les
questions et fiches en tiennent compte.

## Ajouter ou corriger du contenu

Le contenu est rédigé en texte simple dans [`content/`](content/) puis compilé :

```bash
python scripts/doc_text.py 03.01                      # texte d'un règlement (pour rédiger)
python scripts/check_questions.py content/questions/03-rgc.txt   # contrôle d'un lot de questions
python scripts/build_site.py          # génère docs/data/*.json et met à jour le cache hors ligne
python scripts/build_site.py --check  # vérifie que tout est à jour (utilisé par la CI)
```

`check_questions.py` signale les erreurs de format, les identifiants en double, les articles
introuvables dans le texte du règlement cité et les questions trop proches d'une question existante.

Format d'une question (`content/questions/*.txt`) :

```text
@theme rgc            # thème par défaut du fichier
@doc 03.01            # document de référence par défaut
@levels JALA JALC JAFA JAFC

Q rgc-024 | D: 1 | R: 03.01 2.16 | L: JALA JALC
Sauf décision exceptionnelle du juge-arbitre, entre quelles heures un match peut-il débuter ?
- Entre 7h00 et 22h00
+ Entre 8h00 et 23h00
- Entre 8h30 et 21h00
> RGC 2.16 : aucun match ne doit débuter avant 8h00, ni après 23h00.
```

`+` marque une bonne réponse (plusieurs `+` = question à réponses multiples), `>` l'explication,
`D:` la difficulté (1 à 3), `R:` le document (identifiant du catalogue : `03.01`, `07.04`,
`REGLES`…) et l'article, `L:` les grades concernés. Les identifiants (`rgc-024`) doivent rester
stables : ils servent au suivi de progression.

Les cas pratiques (`content/cases/*.txt`) suivent la structure
`=== id | L: … | T: thème | titre`, puis `CONTEXTE`, une ou plusieurs `ÉTAPE` (mêmes conventions
que les questions), `DÉBRIEF` et `RÉF: doc article ; doc article`. Les fiches sont des fragments
HTML (`content/fiches/*.html`) et le glossaire un fichier `Terme :: définition`.

## Tests

```bash
python -m unittest discover -s tests -v          # bot, cohérence du contenu
node --test tests/engine.test.mjs                # sélection sans répétition, examens blancs, activité
python -m http.server -d docs 8765 &              # serveur local
node tests/smoke.mjs http://localhost:8765/      # parcours complet dans Chromium (Playwright)
```

Le parcours de bout en bout teste le premier lancement et les préférences, les séries (aucune
correction avant la réponse, correction complète après, pas de répétition entre deux séries), les
erreurs, les domaines et la ligue, le parcours arbitre, l'examen blanc, la mise à jour des questions
malgré le cache, l'import d'un fichier forgé, les cas pratiques, les règlements, le cache et le
fonctionnement hors ligne.

La CI ([`ci.yml`](.github/workflows/ci.yml)) exécute ces contrôles à chaque push.

## Structure du dépôt

```text
docs/                 application publiée (GitHub Pages)
  index.html, sw.js, manifest.webmanifest, css/, js/, icons/
  data/               questions, cas, fiches, glossaire, examens, catalogue, précache
  reglements/         PDF officiels et texte extrait (générés par le bot)
content/              sources rédactionnelles (questions, cas, fiches, glossaire)
android/              application Android (Capacitor) ; version dans android/VERSION
bot/                  bot de mise à jour des règlements (Guide du Badminton et ligues)
scripts/              compilation (build_site.py), contrôle des questions (check_questions.py),
                      lecture des textes (doc_text.py), écrans illustrés (make_screens.py),
                      icônes Android (android_assets.py)
tests/                tests unitaires et de bout en bout
.github/workflows/    déploiement, bot planifié, contrôles
```

## Avertissement

Application indépendante, non éditée par la Fédération Française de Badminton. Les règlements
sont ceux publiés par la FFBaD dans le Guide du Badminton et sont reproduits à titre
d'information ; **seul le texte officiel fait foi**. Les questions, cas pratiques et fiches ont
été rédigés à partir de ces textes : signalez toute erreur par une issue.
