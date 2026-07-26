import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
