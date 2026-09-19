import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true as const,
  platform: process.platform,
  getDownloadFolder: () => ipcRenderer.invoke("get-download-folder"),
  chooseDownloadFolder: () => ipcRenderer.invoke("choose-download-folder"),
  openPath: (targetPath: string) => ipcRenderer.invoke("open-path", targetPath),
});
