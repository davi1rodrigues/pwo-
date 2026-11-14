import { app, BrowserWindow, dialog, powerSaveBlocker, session, shell } from 'electron';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow;
let embeddedServer;
let keepAwakeId;

app.setName('pwo-intercom');
const ownsAppLock = app.requestSingleInstanceLock();
if (!ownsAppLock) app.quit();
else app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForApi(baseUrl, timeoutMs = 15_000, requireProduction = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(700) });
      if (response.ok) {
        const status = await response.json();
        if (!requireProduction || status.production) return true;
      }
    } catch {}
    await delay(250);
  }
  return false;
}

async function prepareLocalServer() {
  const configPath = app.isPackaged
    ? path.join(app.getPath('userData'), '.env')
    : path.join(process.cwd(), '.env');
  if (app.isPackaged && !fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const existingProjectConfig = path.join(app.getPath('documents'), 'pwo', '.env');
    const examplePath = path.join(app.getAppPath(), '.env.example');
    if (fs.existsSync(existingProjectConfig)) fs.copyFileSync(existingProjectConfig, configPath);
    else fs.writeFileSync(configPath, fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '', 'utf8');
  }

  dotenv.config({ path: configPath, override: false });
  const basePort = Number(app.isPackaged ? (process.env.PWO_DESKTOP_PORT || '3010') : (process.env.PORT || '3000'));
  const baseUrl = `http://127.0.0.1:${basePort}`;

  if (await waitForApi(baseUrl, 900, true)) return baseUrl;
  if (!app.isPackaged && await waitForApi('http://127.0.0.1:5173', 900)) return 'http://127.0.0.1:5173';

  const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'APP_JWT_SECRET', 'DIRECTOR_CODE', 'INTERVIEWER1_CODE', 'INTERVIEWER2_CODE', 'PRODUCER_CODE'];
  const placeholder = /your-project|replace-me|replace-with/i;
  const missing = required.filter((key) => !process.env[key] || placeholder.test(process.env[key]));
  if (missing.length || (process.env.APP_JWT_SECRET || '').length < 32) {
    const message = `A configuração do PWO precisa ser preenchida antes da primeira execução.\n\nArquivo: ${configPath}\n\nCampos ausentes: ${missing.join(', ') || 'APP_JWT_SECRET deve ter ao menos 32 caracteres.'}`;
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Configuração do PWO Intercom',
      message,
      buttons: ['Abrir pasta de configuração', 'Fechar'],
      defaultId: 0,
    });
    if (result.response === 0) await shell.openPath(path.dirname(configPath));
    return null;
  }

  process.env.PORT = String(basePort);
  process.env.HOST = '127.0.0.1';
  process.env.NODE_ENV = 'production';
  const serverModule = await import('./server/index.js');
  embeddedServer = serverModule.httpServer;
  if (!(await waitForApi(baseUrl, 15_000, true))) throw new Error(`O servidor local não respondeu em ${baseUrl}.`);
  return baseUrl;
}

function createWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    show: false,
    title: 'PWO Intercom',
    backgroundColor: '#0b1017',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl)) return { action: 'allow' };
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow.loadURL(baseUrl);
}

if (ownsAppLock) {
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const trustedPwoPage = webContents.getURL().startsWith('http://127.0.0.1:');
      callback(trustedPwoPage && permission === 'media');
    });

    try {
      const baseUrl = await prepareLocalServer();
      if (!baseUrl) { app.quit(); return; }
      keepAwakeId = powerSaveBlocker.start('prevent-app-suspension');
      await createWindow(baseUrl);
    } catch (error) {
      dialog.showErrorBox('PWO Intercom não iniciou', error?.message || 'Erro ao iniciar o servidor local.');
      app.quit();
    }
  });
}

app.on('before-quit', () => {
  if (keepAwakeId !== undefined && powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId);
  embeddedServer?.close();
});
