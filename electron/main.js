const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { checkAndUpdate, readManifest } = require('./updater');
let autoUpdater = null; try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) {}

const BUNDLED_DIR = path.join(__dirname, 'app');
let APP_DIR = BUNDLED_DIR;
const CONFIG = path.join(app.getPath('userData'), 'config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { return {}; } }
function writeConfig(c) { fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2)); }
function logLine(s) { try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), new Date().toISOString() + ' ' + s + '\n'); } catch (e) {} }
function blobSha(buf) { return crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex'); }

// content: userData/content mirrors the repo's app/ folder, seeded from the bundled copy
function seedContent() {
  const dir = path.join(app.getPath('userData'), 'content');
  const mf = readManifest(dir);
  if (!mf || mf.version !== app.getVersion()) {
    logLine('seeding app files from the bundled copy (installed ' + app.getVersion() + ', content ' + (mf ? mf.version : 'none') + ')');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const files = {};
    const walk = (src, rel) => { for (const e of fs.readdirSync(src, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) { fs.mkdirSync(path.join(dir, r), { recursive: true }); walk(path.join(src, e.name), r); } else { const b = fs.readFileSync(path.join(src, e.name)); fs.writeFileSync(path.join(dir, r), b); files[r] = blobSha(b); } } };
    walk(BUNDLED_DIR, '');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ commit: null, version: app.getVersion(), files }));
  }
  return dir;
}
let win = null, updState = { status: 'not checked', error: null };
function toast(msg) { if (win) win.webContents.executeJavaScript(`typeof __toast === 'function' && __toast(${JSON.stringify(msg)})`).catch(() => {}); }
async function updateContent(manual) {
  const cfg = readConfig(); if (!manual && cfg.autoUpdate === false) { updState = { status: 'automatic updates off', error: null }; return; }
  updState = { status: 'checking', error: null }; logLine('content check start, manifest=' + JSON.stringify((readManifest(APP_DIR) || {}).commit));
  try {
    const r = await checkAndUpdate(APP_DIR, (n, t) => { updState.status = `downloading ${n}/${t}`; if (n === 1 || n % 10 === 0 || n === t) toast(`Updating app files ${n}/${t}...`); });
    updState = { status: r.updated ? `updated ${r.changed.length} file(s)` : 'up to date', error: null }; logLine('content check done: ' + updState.status + ' commit=' + r.commit);
    if (r.updated) { toast('App files updated. They are used after the next restart.'); if (manual) dialog.showMessageBox(win, { message: 'Updated ' + r.changed.length + ' file(s). Restart the app to use them.' }); }
    else if (manual) toast('App files are up to date.');
  } catch (e) { updState = { status: 'check failed', error: e.message }; logLine('content check FAILED: ' + (e.stack || e.message)); if (manual) toast('Update check failed: ' + e.message); }
}

// saves / game folder detection
function defaultSaveDirs() {
  const home = os.homedir(); const c = [];
  if (process.platform === 'win32') { for (const base of ['C:\\Games\\Heroes 3 HotA', 'C:\\GOG Games\\HoMM 3 Complete', 'C:\\Program Files (x86)\\GOG Galaxy\\Games\\HoMM 3 Complete', 'C:\\Program Files (x86)\\3DO\\Heroes3', 'C:\\Heroes3', 'D:\\Games\\Heroes 3 HotA']) c.push(path.join(base, 'Games')); }
  else { c.push(path.join(home, '.var/app/com.usebottles.bottles/data/bottles/bottles/Heroes3/drive_c/Heroes3Complete/Games'), path.join(home, '.wine/drive_c/Heroes3/Games'), path.join(home, '.wine/drive_c/Games/Heroes 3 HotA/Games')); }
  return c;
}
function savesDir() { const cfg = readConfig(); if (cfg.dir && fs.existsSync(cfg.dir)) return cfg.dir; for (const d of defaultSaveDirs()) if (fs.existsSync(d)) return d; return null; }
function gameDir() { const cfg = readConfig(); if (cfg.gameDir && fs.existsSync(path.join(cfg.gameDir, 'Data'))) return cfg.gameDir; const s = savesDir(); return require(path.join(APP_DIR, 'lib', 'server.js')).findGameDir([s]); }
function findSaveFolders() {
  const home = os.homedir(); const roots = [];
  if (process.platform === 'win32') { for (const d of ['C', 'D', 'E', 'F']) for (const sub of ['Games', 'GOG Games', 'Program Files (x86)', 'Program Files', 'Heroes3', 'HoMM3', 'Steam']) roots.push(d + ':\\' + sub); roots.push(path.join(home, 'AppData', 'Local', 'VirtualStore'), path.join(home, 'Documents'), path.join(home, 'Saved Games'), path.join(home, 'Games'), path.join(home, 'Desktop'), path.join(home, 'Downloads')); }
  else roots.push(path.join(home, '.var', 'app'), path.join(home, '.wine', 'drive_c'), path.join(home, 'Games'), path.join(home, '.local', 'share'), path.join(home, 'Documents'));
  const found = new Map(); const deadline = Date.now() + 20000;
  const walk = (d, depth) => { if (depth > 9 || Date.now() > deadline) return; let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } let n = 0, newest = 0; for (const e of ents) if (e.isFile() && /\.gm[12]$/i.test(e.name)) { n++; try { newest = Math.max(newest, fs.statSync(path.join(d, e.name)).mtimeMs); } catch (x) {} } if (n) found.set(d, { dir: d, count: n, newest }); for (const e of ents) if (e.isDirectory() && !e.isSymbolicLink() && !/^(node_modules|\.git|Windows|System32|\$Recycle\.Bin)$/i.test(e.name)) walk(path.join(d, e.name), depth + 1); };
  for (const r of roots) walk(r, 0);
  const out = [...found.values()].filter(f => !found.has(path.dirname(f.dir)) || /games$/i.test(path.basename(f.dir)));
  for (const f of found.values()) { const p = path.dirname(f.dir); if (found.has(p)) { const q = found.get(p); q.count += f.count; q.newest = Math.max(q.newest, f.newest); } }
  return out.sort((a, b) => b.newest - a.newest);
}
async function pickFolder(kind) {
  const r = await dialog.showOpenDialog(win, { title: kind === 'game' ? 'Choose the Heroes 3 HotA install folder (contains h3hota.exe and Data)' : 'Choose the Heroes 3 Games folder (where .GM1 saves are)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const cfg = readConfig(); if (kind === 'game') cfg.gameDir = r.filePaths[0]; else cfg.dir = r.filePaths[0]; writeConfig(cfg); return r.filePaths[0];
}

function fatal(e) { logLine('FATAL ' + (e && e.stack || e)); dialog.showErrorBox('Heroes 3 HotA Companion could not start', String(e && e.stack || e) + '\n\nLog: ' + path.join(app.getPath('userData'), 'update.log')); app.exit(1); }
process.on('uncaughtException', fatal); process.on('unhandledRejection', fatal);
app.whenReady().then(async () => {
  try { APP_DIR = seedContent(); } catch (e) { logLine('seeding failed, using bundled files: ' + e.message); APP_DIR = BUNDLED_DIR; }
  let serverMod;
  try { serverMod = require(path.join(APP_DIR, 'lib', 'server.js')); }
  catch (e) { logLine('app files unusable, using bundled copy: ' + e.message); APP_DIR = BUNDLED_DIR; serverMod = require(path.join(APP_DIR, 'lib', 'server.js')); }
  const { createServer, listSaves } = serverMod;
  const srv = createServer({
    appDir: APP_DIR, getSavesDir: savesDir, setSavesDir: d => { const c = readConfig(); c.dir = d; writeConfig(c); }, getGameDir: gameDir, listSaves,
    getExtraMapDirs: () => { const c = readConfig(); return c.mapDirs || []; }, onPick: pickFolder, onFind: findSaveFolders,
    info: () => { const mf = readManifest(APP_DIR) || {}; return { electron: true, version: app.getVersion(), content: { commit: mf.commit, date: mf.date }, update: updState }; },
  });
  const port = await new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
  win = new BrowserWindow({ width: 1600, height: 950, minWidth: 900, minHeight: 600, backgroundColor: '#17120e', title: 'Heroes 3 HotA Companion', webPreferences: { contextIsolation: true, nodeIntegration: false } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Start screen (choose map / save)', click: () => win.loadURL('http://127.0.0.1:' + port + '/start.html') },
      { label: 'Choose saves folder...', click: async () => { await pickFolder('saves'); win.webContents.reload(); } },
      { label: 'Choose Heroes 3 game folder...', click: async () => { await pickFolder('game'); win.webContents.reload(); } },
      { label: 'Reload', role: 'reload' }, { type: 'separator' },
      { label: 'Check for app file updates now', click: () => updateContent(true) },
      { label: 'Update app files automatically', type: 'checkbox', checked: readConfig().autoUpdate !== false, click: mi => { const c = readConfig(); c.autoUpdate = mi.checked; writeConfig(c); } },
      { label: 'Check for new installer', click: () => { if (!autoUpdater) return toast('Updater not available in this build.'); autoUpdater.checkForUpdatesAndNotify().catch(e => toast('App update check failed: ' + e.message)); } },
      { label: 'Toggle developer tools', accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
      { label: 'Open logs and settings folder', click: () => shell.openPath(app.getPath('userData')) },
      { label: 'Reset app files to bundled version', click: () => { fs.rmSync(path.join(app.getPath('userData'), 'content'), { recursive: true, force: true }); app.relaunch(); app.quit(); } },
      { type: 'separator' }, { role: 'quit' } ] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
  ]));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('http://127.0.0.1:' + port + '/');
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => updateContent(false), 2000);
    if (autoUpdater && app.isPackaged) {
      autoUpdater.autoDownload = true;
      autoUpdater.on('update-available', i => { logLine('app update available ' + i.version); toast(`New installer ${i.version} found, downloading...`); });
      autoUpdater.on('update-not-available', i => logLine('app update: none (latest ' + i.version + ')'));
      autoUpdater.on('update-downloaded', i => { logLine('app update downloaded ' + i.version); toast(`Installer ${i.version} downloaded, installs when you quit.`); });
      autoUpdater.on('error', e => logLine('app update error: ' + (e.stack || e.message)));
      autoUpdater.checkForUpdatesAndNotify().catch(e => logLine('app update check failed: ' + e.message));
    }
  });
});
app.on('window-all-closed', () => app.quit());
