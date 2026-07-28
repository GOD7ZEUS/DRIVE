import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Auto-update only makes sense for a real packaged install (electron-updater
// has nowhere to check against / nothing to replace in dev). Errors are just
// logged, not surfaced to the user — a failed check (e.g. no internet) should
// never interrupt using the app.
function setupAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('Auto-update check failed:', err.message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: `Drive ${info.version} has been downloaded.`,
        detail: 'Restart now to install it, or it will install automatically the next time you close the app.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err.message));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err.message));
  }, UPDATE_CHECK_INTERVAL_MS);
}

const serverDir = app.isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..', 'server');

function loadOrCreateJwtSecret() {
  const secretPath = path.join(app.getPath('userData'), 'jwt-secret.txt');
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, secret, 'utf8');
  return secret;
}

async function startServer() {
  process.env.NODE_ENV = 'production';
  process.env.DB_PATH = path.join(app.getPath('userData'), 'drive.db');
  process.env.JWT_SECRET = loadOrCreateJwtSecret();

  const appModuleUrl = pathToFileURL(path.join(serverDir, 'src', 'app.js')).href;
  const { default: expressApp } = await import(appModuleUrl);

  await new Promise((resolve) => expressApp.listen(PORT, resolve));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Drive',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
