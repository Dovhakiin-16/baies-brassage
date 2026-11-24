// Pont sécurisé entre la page et le processus principal (aucun accès direct au disque depuis la page).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  load: () => ipcRenderer.invoke("data:load"),
  save: (data) => ipcRenderer.invoke("data:save", data),
  saveSync: (data) => ipcRenderer.sendSync("data:save-sync", data),
  changed: () => ipcRenderer.invoke("data:changed"),
  reload: () => ipcRenderer.invoke("data:reload"),
  choose: (mode) => ipcRenderer.invoke("data:choose", mode),
  reveal: () => ipcRenderer.invoke("data:reveal"),
  saveFile: (filename, data) => ipcRenderer.invoke("file:save", { filename, data }),
  checkUpdate: () => ipcRenderer.invoke("update:check-silent"),
  onMenu:(fn) => ipcRenderer.on("menu", (_e, act) => fn(act)),
  onFocus: (fn) => ipcRenderer.on("app:focus", () => fn())
});
