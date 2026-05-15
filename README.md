# ✦ C411 Suite Ultra Pro ✦

> Userscript Tampermonkey pour **C411.org** — Popup TMDB Netflix-style, filtres avancés séries/films, boutons DL / Hash / AllDebrid inline, badge d'état.

![Version](https://img.shields.io/badge/version-5.4.0-dc2626?style=flat-square)
![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatible-00c853?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## ✨ Fonctionnalités

### 🎬 Popup TMDB au survol
- Jaquette HD + backdrop flou cinématique
- Synopsis, note, genres, durée, nombre de saisons
- Skeleton loader pendant le chargement
- Cache 7 jours (localStorage + persistant)
- Support films ET séries
<img width="1212" height="470" alt="image" src="https://github.com/user-attachments/assets/a57d91a8-38d1-4507-bc5c-942b0ba5d425" />

### 🔍 Filtres avancés client-side
- Recherche texte libre instantanée
- Filtre année exacte
- Qualité : 4K/UHD, 1080p, 720p, BluRay, WEB-DL, WEBRip, REMUX, HDR…
- Langue : TrueFrench, VF, VOSTFR, MULTI, VO
- Type : Film, Série, Anime, Documentaire, Spectacle, Émission TV
- **Saisons S01→S15 + Intégrale** (sélection rapide et slider de plage)
- Slider taille de fichier (min/max GB)
- Compteur de résultats en temps réel
- Presets sauvegardables
- Raccourcis clavier : `Alt+F` focus, `Alt+R` reset, `ESC` vider texte
<img width="1627" height="389" alt="image" src="https://github.com/user-attachments/assets/1a50ded6-aa8c-4ced-8171-64d0493d8108" />

### ⬇ Boutons d'action inline
Directement sous chaque ligne torrent, sans ouvrir la fiche :
- **⬇ DL** — télécharge le torrent via le bouton natif C411
- **# Hash** — copie le hash torrent dans le presse-papier
- **🟠 AD** — envoie le magnet à AllDebrid en 1 clic
<img width="397" height="77" alt="image" src="https://github.com/user-attachments/assets/a3f29567-1847-405a-8ede-31b5508f73d0" />

### 📺 Tags colorés automatiques
Sur chaque ligne : type, saison (S01, S02…), intégrale, qualité, langue

<img width="266" height="35" alt="image" src="https://github.com/user-attachments/assets/0c62b6f3-0dce-49ac-bcb4-150987bbf4ed" />

### ✦ Badge PLUS
- Indicateur visuel que le script est actif (coin haut-droit)
- Draggable, position mémorisée
- Carte de statut au survol (modules actifs, compteur live)
- S'adapte au resize de la fenêtre
<img width="1505" height="388" alt="image" src="https://github.com/user-attachments/assets/cbb5fbbf-204c-47bf-9ec1-2cf8215d19c0" />
---

## 📦 Installation

### 1. Installer Tampermonkey
| Navigateur | Lien |
|---|---|
| Chrome / Edge | [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| Firefox | [Mozilla Add-ons](https://addons.mozilla.org/fr/firefox/addon/tampermonkey/) |
| Safari | [App Store](https://apps.apple.com/app/tampermonkey/id1482490089) |

### 2. Installer le script
Cliquer sur ce lien (Tampermonkey reconnaît automatiquement l'extension `.user.js`) :

**→🚀 [Installer C411 Suite v5.4](../../raw/main/c411_suite_v54_hefied.user.js)🚀**

Ou manuellement : Tampermonkey → **Nouveau script** → coller le contenu du fichier → Sauvegarder.

---

## 🔑 Configuration des clés API

Le script nécessite 2 clés API (gratuites) à renseigner dans la section `CFG` en haut du script.

### Clé TMDB (obligatoire pour le popup)
1. Créer un compte sur [themoviedb.org](https://www.themoviedb.org/signup)
2. Aller dans **Paramètres → API → Créer une clé** (type : Developer)
3. Copier la **clé API (v3 auth)**
4. Dans le script, remplacer :
```js
TMDB_API_KEY : 'VOTRE_CLE_TMDB_ICI',
```

### Clé AllDebrid (optionnelle — pour le bouton 🟠 AD)
1. Connecté sur [alldebrid.com](https://alldebrid.com)
2. Aller dans **Mon compte → Clés API → Générer**
3. Dans le script, remplacer :
```js
ALLDEBRID_KEY : 'VOTRE_CLE_ALLDEBRID_ICI',
```

---

## ⌨️ Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Alt + F` | Focus sur la barre de recherche filtres |
| `Alt + R` | Reset de tous les filtres |
| `ESC` | Vider la recherche texte |

---

## 🛠️ Structure du script

```
CFG             → Configuration centrale (clés, délais, options)
Cache           → Double cache RAM + persistant 7 jours
TitleParser     → Nettoyage des noms de releases torrents
P               → Patterns de détection (qualité, langue, type, saison)
DOM             → Helpers structure Vue.js de C411
Scanner         → Parse chaque ligne torrent (WeakMap, sans fuite mémoire)
TMDB            → Client API TMDB (4 tentatives fallback)
AllDebrid       → Upload magnet via API v4
PopupUI         → Rendu popup (skeleton, données, erreur, lerp souris)
State           → Store réactif filtres (pub/sub)
Store           → Persistance filtres + presets (GM_setValue)
Engine          → Moteur de filtrage (RAF batching, debounce)
Deco            → Tags colorés + boutons inline sur chaque ligne
FilterUI        → Panneau glassmorphism vert C411
HoverManager    → Gestion survol TMDB (debounce, preload voisins)
Badge           → Badge PLUS flottant avec carte de statut live
Observer        → MutationObserver (pagination AJAX, Vue Router)
```

---

## 📝 Changelog

### v5.4.0
- Badge PLUS : positionnement intelligent sous la navbar (ne couvre plus le logo)
- Badge : draggable avec position mémorisée en localStorage
- Badge : suivi des bords au resize de la fenêtre
- Carte de statut : s'ouvre au-dessus ou en-dessous selon l'espace disponible

### v5.3.0
- Ajout du badge PLUS flottant avec carte de statut

### v5.2.0
- Boutons DL / Hash / AllDebrid déplacés en inline sous chaque ligne torrent
- Popup TMDB simplifié (sans barre d'actions en bas)
- Fix popup immobile quand la souris est dessus

### v5.1.0
- Fix popup TMDB : plus de mouvement quand la souris entre dans le popup

### v5.0.0
- Fusion des deux scripts (TMDB + Filtres) en un seul
- Filtres séries : saisons S01-S15, slider de plage, intégrale
- AllDebrid intégré
- Boutons DL/Hash/AllDebrid dans le popup

---

## ⚠️ Avertissement légal

Ce script est un **outil d'amélioration d'interface** (comme Dark Reader ou uBlock Origin). Il n'héberge, ne télécharge et ne distribue aucun contenu. L'utilisation de l'API TMDB et de l'API AllDebrid est soumise à leurs conditions d'utilisation respectives.

---

## 👤 Auteur

**Hefied** — script personnel, partagé pour la communauté.

---

*Made with ❤️ and a lot of coffee*
