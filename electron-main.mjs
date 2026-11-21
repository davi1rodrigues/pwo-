import { app, BrowserWindow, dialog, powerSaveBlocker, session } from 'electron';

// Every workstation joins the same hosted API. No LiveKit secrets belong here.
const serverUrl = 'https://pwo-esr1.onrender.com';
let mainWindow;
let keepAwakeId;
app.setName('pwo-intercom');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show(); mainWindow?.focus();
  });
  app.whenReady().then(async () => {
    const trusted = url => { try { return new URL(url).origin === serverUrl; } catch { return false; } };
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(trusted(contents.getURL()) && trusted(details.requestingUrl || contents.getURL()) && permission === 'media');
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) =>
      Boolean(contents && trusted(contents.getURL()) && trusted(origin) && permission === 'media'));
    mainWindow = new BrowserWindow({
      width: 1280, height: 900, minWidth: 800, minHeight: 600, show: false,
      title: 'PWO Intercom', backgroundColor: '#0b1017',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.webContents.on('did-fail-load', async (_event, code, _description, _url, mainFrame) => {
      if (!mainFrame || code === -3) return;
      const result = await dialog.showMessageBox({ type: 'warning', title: 'PWO Intercom',
        message: 'Não foi possível abrir o PWO. Confira a internet e tente novamente.',
        buttons: ['Tentar novamente', 'Fechar'], defaultId: 0 });
      if (result.response === 0) mainWindow?.loadURL(serverUrl).catch(() => {}); else app.quit();
    });
    keepAwakeId = powerSaveBlocker.start('prevent-app-suspension');
    await mainWindow.loadURL(serverUrl).catch(() => {});
  });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (keepAwakeId !== undefined && powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId); });
