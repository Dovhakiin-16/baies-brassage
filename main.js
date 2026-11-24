// Baies de brassage — processus principal Electron
// Ouvre la fenêtre et gère le fichier de données JSON sur le disque.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const APP_NAME = "Baies de brassage";
app.setName(APP_NAME);

// Une seule fenêtre à la fois : évite que deux instances écrivent dans le même fichier.
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const configPath = () => path.join(app.getPath("userData"), "config.json");
const defaultDataFile = () => path.join(app.getPath("documents"), APP_NAME, "baies-brassage.json");

let dataFile = null;   // chemin du fichier de données utilisé
let lastMtime = 0;     // date de modif connue, pour détecter une modif faite ailleurs
let backedUp = false;  // copie .bak faite une fois par session, avant la 1re écriture

function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; } }
function writeConfig(c) { try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(c, null, 2)); } catch {} }
function mtimeOf(f) { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }

function isValidData(o) { return o && typeof o === "object" && typeof o.racks === "object" && typeof o.devices === "object"; }

function readDataFile(f) {
  if (!fs.existsSync(f)) return { path: f, data: null };
  const raw = fs.readFileSync(f, "utf8");
  const o = JSON.parse(raw.replace(/^﻿/, ""));
  if (!isValidData(o)) throw new Error("Ce fichier n'est pas un fichier de Baies de brassage.");
  return { path: f, data: { racks: o.racks, devices: o.devices } };
}

// Écriture « atomique » : fichier temporaire puis renommage, pour ne jamais laisser un fichier à moitié écrit.
function writeDataFile(f, json) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!backedUp && fs.existsSync(f)) { try { fs.copyFileSync(f, f.replace(/\.json$/i, "") + ".bak.json"); } catch {} backedUp = true; }
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, f);
  lastMtime = mtimeOf(f);
}

function wrap(data) {
  return JSON.stringify({ format: "baies-brassage", version: 1, savedAt: new Date().toISOString(), racks: data.racks, devices: data.devices }, null, 2);
}

function useFile(f) {
  dataFile = f; backedUp = false;
  const c = readConfig(); c.dataFile = f; writeConfig(c);
}

/* ---------- échanges avec la page ---------- */
ipcMain.handle("data:load", () => {
  const c = readConfig();
  const f = c.dataFile || defaultDataFile();
  try {
    const r = readDataFile(f);
    dataFile = f; lastMtime = mtimeOf(f);
    return { ok: true, ...r };
  } catch (e) {
    // Fichier illisible : on ne l'écrase pas, on bascule sur le fichier par défaut.
    if (f !== defaultDataFile()) {
      try { const r = readDataFile(defaultDataFile()); dataFile = defaultDataFile(); lastMtime = mtimeOf(dataFile); return { ok: true, warn: `Impossible de lire ${f} : ${e.message}`, ...r }; } catch {}
    }
    dataFile = null;
    return { ok: false, path: f, error: e.message };
  }
});

ipcMain.handle("data:save", (_e, data) => {
  if (!dataFile) return { ok: false, error: "Aucun fichier de données ouvert." };
  try {
    let conflict = null;
    const m = mtimeOf(dataFile);
    if (lastMtime && m && Math.abs(m - lastMtime) > 1) {
      // Modifié ailleurs depuis notre dernière lecture : on garde une copie de cette version avant d'écrire.
      conflict = dataFile.replace(/\.json$/i, "") + ".conflit-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      try { fs.copyFileSync(dataFile, conflict); } catch { conflict = null; }
    }
    writeDataFile(dataFile, wrap(data));
    return { ok: true, conflict };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Écriture synchrone à la fermeture, pour ne rien perdre.
ipcMain.on("data:save-sync", (e, data) => {
  try { if (dataFile) writeDataFile(dataFile, wrap(data)); e.returnValue = true; } catch { e.returnValue = false; }
});

ipcMain.handle("data:changed", () => {
  if (!dataFile) return false;
  const m = mtimeOf(dataFile);
  return !!(lastMtime && m && Math.abs(m - lastMtime) > 1);
});

ipcMain.handle("data:reload", () => {
  try { const r = readDataFile(dataFile); lastMtime = mtimeOf(dataFile); return { ok: true, ...r }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("data:choose", async (_e, mode) => {
  // mode "open" : ouvrir un fichier existant ; "new" : créer un nouveau fichier (vide ou copie des données actuelles)
  if (mode === "open") {
    const r = await dialog.showOpenDialog(win, { title: "Ouvrir un fichier de baies", defaultPath: path.dirname(dataFile || defaultDataFile()), filters: [{ name: "Baies de brassage", extensions: ["json"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try { const d = readDataFile(r.filePaths[0]); useFile(r.filePaths[0]); lastMtime = mtimeOf(dataFile); return { ok: true, ...d }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  const r = await dialog.showSaveDialog(win, { title: "Enregistrer les baies dans…", defaultPath: path.join(path.dirname(dataFile || defaultDataFile()), "baies-brassage.json"), filters: [{ name: "Baies de brassage", extensions: ["json"] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  useFile(r.filePath); lastMtime = 0;
  return { ok: true, path: r.filePath };
});

ipcMain.handle("data:reveal", () => { if (dataFile) shell.showItemInFolder(dataFile); });

ipcMain.handle("file:save", async (_e, { filename, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), filename) });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(r.filePath, data, "utf8"); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});

/* ---------- mises à jour ---------- */
// Les nouvelles versions sont des « Baies de brassage Setup X.Y.Z.exe » déposés dans un dossier
// (dossier livrables, ou partage réseau pour que tous les postes en profitent).
const SETUP_RE = /^Baies de brassage Setup (\d+)\.(\d+)\.(\d+)\.exe$/i;
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_FILE;
function cmpVer(a, b) { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; } return 0; }
const curVer = () => app.getVersion().split(".").map(n => parseInt(n, 10) || 0);

function defaultUpdateDir() {
  const guess = "C:\\Mes_Projets\\baies-brassage\\livrables";
  return fs.existsSync(guess) ? guess : app.getPath("documents");
}
async function chooseUpdateDir() {
  const c = readConfig();
  const r = await dialog.showOpenDialog(win, { title: "Dossier où sont déposées les nouvelles versions", defaultPath: c.updateDir || defaultUpdateDir(), properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  c.updateDir = r.filePaths[0]; writeConfig(c);
  return c.updateDir;
}
// Renvoie le plus récent installeur du dossier, s'il est plus récent que la version actuelle.
function findUpdate(dir) {
  let best = null;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(SETUP_RE); if (!m) continue;
    const v = [m[1], m[2], m[3]].map(Number);
    if (!best || cmpVer(v, best.v) > 0) best = { v, file: path.join(dir, f) };
  }
  return best && cmpVer(best.v, curVer()) > 0 ? { version: best.v.join("."), file: best.file } : null;
}

async function checkForUpdate() {
  if (isPortable()) {
    const r = await dialog.showMessageBox(win, { type: "info", title: "Mise à jour", message: "La version portable ne peut pas se mettre à jour elle-même.", detail: "Remplacez simplement le fichier BaiesDeBrassage-portable-….exe par la nouvelle version, ou installez l'application avec « Baies de brassage Setup ….exe » pour profiter des mises à jour automatiques.", buttons: ["OK"] });
    return r;
  }
  let dir = readConfig().updateDir;
  if (!dir || !fs.existsSync(dir)) {
    await dialog.showMessageBox(win, { type: "info", title: "Mise à jour", message: "Choisissez le dossier où sont déposées les nouvelles versions.", detail: "Par exemple le dossier « livrables » du projet, ou un partage réseau (\\\\serveur\\Logiciels\\Baies de brassage). Ce choix est mémorisé.", buttons: ["Choisir le dossier…"] });
    dir = await chooseUpdateDir(); if (!dir) return;
  }
  let up;
  try { up = findUpdate(dir); }
  catch (e) { dialog.showMessageBox(win, { type: "error", title: "Mise à jour", message: "Impossible de lire le dossier des mises à jour.", detail: `${dir}\n${e.message}` }); return; }
  if (!up) {
    const r = await dialog.showMessageBox(win, { type: "info", title: "Mise à jour", message: `Vous avez déjà la dernière version (${app.getVersion()}).`, detail: `Dossier vérifié :\n${dir}`, buttons: ["OK", "Changer de dossier…"], defaultId: 0 });
    if (r.response === 1 && await chooseUpdateDir()) return checkForUpdate();
    return;
  }
  const r = await dialog.showMessageBox(win, { type: "question", title: "Mise à jour disponible", message: `La version ${up.version} est disponible (vous avez la ${app.getVersion()}).`, detail: "L'application va se fermer, s'installer puis se relancer toute seule. Vos données sont enregistrées avant.", buttons: ["Mettre à jour maintenant", "Plus tard"], defaultId: 0, cancelId: 1 });
  if (r.response !== 0) return;
  installUpdate(up.file);
}

function installUpdate(file) {
  // Copie locale de l'installeur (évite de l'exécuter depuis un partage réseau), puis installation silencieuse.
  const tmp = path.join(app.getPath("temp"), "baies-brassage-mise-a-jour.exe");
  try { fs.copyFileSync(file, tmp); }
  catch (e) { dialog.showMessageBox(win, { type: "error", title: "Mise à jour", message: "Impossible de copier l'installeur.", detail: e.message }); return; }
  const { spawn } = require("child_process");
  // Attente de ~3 s (le temps que l'appli se ferme), puis installation silencieuse :
  // --updated /S = mise à jour silencieuse au même endroit ; --force-run = relance l'appli à la fin
  spawn("cmd.exe", ["/d", "/c", `ping -n 4 127.0.0.1 >nul & "${tmp}" --updated /S --force-run`],
    { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true }).unref();
  // La fermeture de la fenêtre déclenche l'enregistrement des données (beforeunload).
  app.quit();
}

ipcMain.handle("update:check-silent", () => {
  // Vérification discrète au démarrage : uniquement si un dossier a déjà été choisi.
  try { const dir = readConfig().updateDir; if (!dir || isPortable() || !fs.existsSync(dir)) return null; const up = findUpdate(dir); return up ? up.version : null; }
  catch { return null; }
});

/* ---------- fenêtre ---------- */
function createWindow() {
  const c = readConfig();
  const b = c.bounds || { width: 1500, height: 940 };
  win = new BrowserWindow({
    ...b, minWidth: 1000, minHeight: 640, show: false, title: APP_NAME,
    backgroundColor: "#e8ecf0",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });
  if (c.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "src", "index.html"));

  // Aucune navigation hors de l'application ; les liens externes s'ouvrent dans le navigateur.
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });

  win.on("close", () => {
    const cfg = readConfig(); cfg.maximized = win.isMaximized(); if (!win.isMaximized()) cfg.bounds = win.getBounds(); writeConfig(cfg);
  });
  win.on("focus", () => win.webContents.send("app:focus"));
}

function buildMenu() {
  const send = (act) => () => win && win.webContents.send("menu", act);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Fichier", submenu: [
      { label: "Ouvrir un fichier de baies…", accelerator: "CmdOrCtrl+O", click: send("data-open") },
      { label: "Enregistrer sous…", accelerator: "CmdOrCtrl+Shift+S", click: send("data-saveas") },
      { label: "Afficher le fichier dans l'explorateur", click: () => dataFile && shell.showItemInFolder(dataFile) },
      { type: "separator" },
      { label: "Exporter pour Excel (.csv)…", accelerator: "CmdOrCtrl+E", click: send("export-csv") },
      { type: "separator" },
      { label: "Mettre à jour la version…", click: () => checkForUpdate() },
      { label: "Dossier des mises à jour…", click: () => chooseUpdateDir() },
      { type: "separator" },
      { label: "Quitter", role: "quit" }
    ]},
    { label: "Affichage", submenu: [
      { label: "Recharger", role: "reload" },
      { type: "separator" },
      { label: "Zoom avant", role: "zoomIn" }, { label: "Zoom arrière", role: "zoomOut" }, { label: "Taille réelle", role: "resetZoom" },
      { type: "separator" },
      { label: "Plein écran", role: "togglefullscreen" },
      { label: "Outils de développement", role: "toggleDevTools" }
    ]},
    { label: "Aide", submenu: [
      { label: `À propos — ${APP_NAME} ${app.getVersion()}`, click: () => dialog.showMessageBox(win, { type: "info", title: APP_NAME, message: `${APP_NAME} ${app.getVersion()}`, detail: "Gestion des baies, panneaux de brassage, switchs et prises.\nFichier de données :\n" + (dataFile || "(aucun)") }) }
    ]}
  ]));
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { buildMenu(); createWindow(); });
app.on("window-all-closed", () => app.quit());
