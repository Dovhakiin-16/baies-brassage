# Baies de brassage — consignes pour Claude Code

Application de bureau Windows (Electron) de gestion physique du réseau d'une entreprise :
baies, panneaux de brassage, switchs, prises murales, postes, VLAN.

## Architecture
- `main.js` : processus principal. Seul endroit qui touche au disque (fichier JSON de données, config dans `%APPDATA%\Baies de brassage\config.json`).
- `preload.js` : expose `window.desktop` (load, save, saveSync, choose, reveal, saveFile, onMenu, onFocus). Toute nouvelle capacité disque passe par ici + un `ipcMain.handle` dans `main.js`.
- `src/index.html` : interface complète, un seul fichier, JavaScript sans framework.
  - État global `S` (`S.racks`, `S.devices`, `S.ui`). Toute modification passe par `saveRack` / `saveDev` / `delRack` / `delDev`, qui appellent `fileBackend.persist()` (écriture groupée).
  - Le code `startDb` / `makeDbBackend` / `localBackend` sert à la version web de la page ; ne pas le supprimer sans raison, il est inactif dans l'appli.

## Format des données
`{ format: "baies-brassage", version: 1, racks: {id: {...}}, devices: {id: {...}} }`.
Un port de panneau peut porter `sw: {d: <id switch>, p: <port>}` = cordon vers le switch.
Types d'équipement (`kind`) : `patch`, `switch`, `nas`, `server`, `router`, `other` (sans ports, ex. onduleur, passe-câbles `variant:"cm"`).
NAS / serveur / routeur (`EQ` dans `index.html`, test `isEq(d)`) ont `ports` + `portPrefix` ; leurs ports se relient au switch exactement comme un port de panneau (`p[k].sw`).
`isEnd(d)` = panneau ou équipement réseau = côté qui porte le lien vers le switch. Champs de port d'un équipement : `desc` (usage), `ip`, `color`, `note`.
Liaison switch ↔ switch (trunk / cascade) : le lien est stocké sur UN seul des deux ports de switch (`p[k].sw`, celui d'où la liaison a été créée). Toujours passer par `mateOfSwitch`, `linkColor`, `linkOwner` et `clearLinkAt`, qui gèrent les deux sens.
Toute évolution du format doit rester compatible avec les fichiers existants (lire l'ancien format sans erreur).

## Règles
- Sécurité Electron : garder `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` et la CSP de `index.html`. Pas de ressource chargée depuis Internet (l'appli doit marcher hors ligne).
- Ne jamais écrire le fichier de données autrement que via l'écriture atomique de `main.js` (fichier `.tmp` puis renommage).
- Interface et messages en français.
- Tester avec `npm start` ; générer les exécutables avec `npm run dist`.

## Publier une nouvelle version
1. Augmenter `version` dans `package.json` (ex. 1.0.2 → 1.0.3). Le nom de l'installeur doit rester `Baies de brassage Setup X.Y.Z.exe` : la mise à jour intégrée (`findUpdate` dans `main.js`) s'appuie dessus.
2. `npm run dist`, puis copier `dist\Baies de brassage Setup X.Y.Z.exe` (et la version portable) dans `livrables\` et dans le dossier de mises à jour s'il est différent.
3. L'installeur est en « un clic », par utilisateur (pas de droits admin) : ne pas repasser en `perMachine`, sinon la mise à jour silencieuse demanderait une élévation.
