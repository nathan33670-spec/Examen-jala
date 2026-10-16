# Prépa JA Badminton — JALA · JALC · JAFA · JAFC

Application web **installable et utilisable hors ligne** pour préparer les examens théoriques
et pratiques de **juge-arbitre de badminton** de la FFBaD :

| Grade | Intitulé |
|---|---|
| JALA | Juge-arbitre de ligue accrédité |
| JALC | Juge-arbitre de ligue certifié |
| JAFA | Juge-arbitre fédéral accrédité |
| JAFC | Juge-arbitre fédéral certifié |

L'application est un site statique (HTML, CSS, JavaScript sans dépendance) hébergé sur
**GitHub Pages**. Elle fonctionne comme une application de préparation aux certifications :
questions avec correction expliquée, examens blancs chronométrés, cas pratiques, fiches et
tous les règlements officiels consultables hors ligne.

## Fonctionnalités

- **Banque de questions** (QCM à une ou plusieurs réponses ; les questions sur le rôle et les annonces de
  l'arbitre sont rangées à part, dans le thème « Arbitrage », hors examens blancs et hors jauge) couvrant tous les chapitres utiles du
  Guide du Badminton, chacune avec son explication et un lien vers l'article du règlement concerné.
- **Séries sans répétition** : chaque utilisateur parcourt toute la banque dans un ordre qui lui est
  propre ; une question déjà vue ne revient qu'à échéance (10 min après une erreur, puis 1, 3, 7, 16
  et 35 jours après des bonnes réponses successives). Les examens blancs font passer en dernier les
  questions déjà tombées.
- **Modes de jeu** :
  - *Série intelligente* (10, 20 ou 40 questions, filtrables par thème) ;
  - *Défi du jour* : 10 questions, les mêmes pour tous les candidats d'un grade ce jour-là ;
  - *Match en 3×15* : chaque bonne réponse marque un point, chaque erreur en donne un à
    l'adversaire ; tableau d'affichage, zone de service, intervalle à 8 points, prolongation à 14-14
    et point décisif à 20-20, 30 s par question ;
  - *Contre-la-montre* (90 s, une erreur coûte 5 s) et *Mort subite* (3 vies), avec records ;
  - *Score & service* : questions générées à l'infini (score de set valide ou non, zone de service
    en simple et en double, intervalles et changement de côté, service au set suivant), calculées
    à partir des règles 7, 8, 10, 11 et 16.2 ;
  - *Mode oral* (flashcards) pour l'oral JALC, *Mes erreurs*, *Favoris*.
- **Progression ludique** : points d'expérience et niveaux (de « Ramasseur de volants » à « Légende
  du volant »), série de jours d'entraînement, objectif quotidien, 29 badges, confettis, sons et
  vibrations désactivables. L'XP motive mais n'entre pas dans la jauge de préparation.
- **Examens blancs** par grade : chronomètre, navigation entre questions, questions marquées,
  correction détaillée, résultats par thème. Barème et seuil conformes aux conditions connues
  (voir plus bas), personnalisables si votre ligue communique d'autres modalités.
- **Partie pratique** :
  - 35 **cas pratiques** en plusieurs étapes (retards, forfaits, cartons, blessures, tenues,
    volants, interclubs, contrôle antidopage, compétitions fédérales…) avec débrief et références ;
  - exercice généré à l'infini de **classement de poule** (départage RGC 3.4.1) ;
  - outil de **dimensionnement d'une compétition** (formats de l'annexe 12, nombre de matchs,
    rotations, heure de fin, limite de 8 matchs par jour) ;
  - **check-lists** du JA (avant, jour J, après, rencontre d'interclubs) ;
  - **auto-évaluation** sur la grille officielle des critères (annexe 02 de la filière JA).
- **Jauge de préparation** calculée localement pour chaque grade (connaissances 55 %,
  examens blancs 25 %, pratique 20 %), avec conseils sur la prochaine étape.
- **Documentation intégrée** : 68 documents du Guide du Badminton 2026-2027 + les Règles
  officielles du badminton (texte lisible et cherchable hors ligne, PDF officiels téléchargeables),
  14 fiches de synthèse, un glossaire et une recherche globale.
- **Mode hors ligne** : l'application, les questions et le texte des règlements sont mis en cache
  dès la première visite ; un bouton télécharge en plus les PDF officiels (≈ 17 Mo).
- **Bot de mise à jour** : une action GitHub vérifie deux fois par semaine le Guide du Badminton
  publié par la FFBaD, intègre les nouvelles versions et signale les questions à relire.
- Aucune donnée personnelle envoyée : la progression reste sur l'appareil (export/import possible).

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

## Conditions d'examen : ce qui est officiel et ce qui est simulé

D'après le chapitre 06.02 du Guide du Badminton (filière juge-arbitrage, édition 2026/1) :

- **JALA** : contrôle de connaissances passé pendant le stage pratique, seul, en temps limité et
  sous surveillance ; **seuil de 80 % du total des points** (mémento d'évaluation JALA de la CFOT) ;
  rattrapage dans les 6 mois ; puis examen pratique sur une journée de compétition avec finales.
- **JALC** : questionnaire **oral** et partie pratique sur une compétition de deux jours.
- **JAFA** : contrôle de connaissances **avec documents** à l'issue d'une formation de 20 h, sans
  rattrapage, puis examen comme JA principal d'une compétition fédérale.
- **JAFC** : atelier de 8 h validé par un contrôle de connaissances, puis examen comme JA principal
  d'un championnat de France.

Le nombre de questions et la durée des épreuves ne sont pas publiés : l'application utilise des
valeurs d'entraînement (JALA 40 questions / 60 min, JALC 30 / 45 min, JAFA 50 / 90 min avec
documents, JAFC 40 / 60 min) et un seuil de 80 % pour tous les grades, modifiables dans l'écran
d'examen (seuil, durée, nombre de questions, pénalité pour réponse fausse, documents autorisés).
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
node --test tests/engine.test.mjs                # sélection sans répétition, score 3×15, XP et badges
python -m http.server -d docs 8765 &              # serveur local
node tests/smoke.mjs http://localhost:8765/      # parcours complet dans Chromium (Playwright)
```

Le parcours de bout en bout joue chaque mode (série, défi du jour, match, contre-la-montre, mort
subite, score & service, oral, examen blanc), vérifie qu'aucune question ne revient entre deux
séries, puis teste les cas pratiques, les règlements, le cache et le fonctionnement hors ligne.

La CI ([`ci.yml`](.github/workflows/ci.yml)) exécute ces contrôles à chaque push.

## Structure du dépôt

```text
docs/                 application publiée (GitHub Pages)
  index.html, sw.js, manifest.webmanifest, css/, js/, icons/
  data/               questions, cas, fiches, glossaire, examens, catalogue, précache
  reglements/         PDF officiels et texte extrait (générés par le bot)
content/              sources rédactionnelles (questions, cas, fiches, glossaire)
bot/                  bot de mise à jour des règlements
scripts/build_site.py compilation du contenu et du cache hors ligne
tests/                tests unitaires et de bout en bout
.github/workflows/    déploiement, bot planifié, contrôles
```

## Avertissement

Application indépendante, non éditée par la Fédération Française de Badminton. Les règlements
sont ceux publiés par la FFBaD dans le Guide du Badminton et sont reproduits à titre
d'information ; **seul le texte officiel fait foi**. Les questions, cas pratiques et fiches ont
été rédigés à partir de ces textes : signalez toute erreur par une issue.
