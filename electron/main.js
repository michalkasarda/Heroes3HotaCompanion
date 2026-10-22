const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const crypto = require('crypto');
const { checkAndUpdate, readManifest } = require('./updater');
let autoUpdater = null; try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) {}
// AppImage on Ubuntu 24.04+: AppArmor blocks the SUID/userns sandbox, so run unsandboxed on Linux
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BUNDLED_DIR = path.join(__dirname, 'app');
let APP_DIR = BUNDLED_DIR;
const CONFIG = path.join(app.getPath('userData'), 'config.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css' };

function blobSha(buf) { return crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex'); }
// Content lives in userData/content, seeded from the bundled app/ on first run, then kept in sync with the repo.
function seedContent() {
  const dir = path.join(app.getPath('userData'), 'content');
  if (!readManifest(dir)) {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const files = {};
    for (const f of fs.readdirSync(BUNDLED_DIR)) { const b = fs.readFileSync(path.join(BUNDLED_DIR, f)); fs.writeFileSync(path.join(dir, f), b); files[f] = blobSha(b); }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ commit: null, files }));
  }
  return dir;
}
let updState = { status: 'not checked', error: null, checkedAt: null };
function toast(msg) { if (win) win.webContents.executeJavaScript(`typeof __toast === 'function' && __toast(${JSON.stringify(msg)})`).catch(() => {}); }
async function updateContent(manual) {
  const cfg = readConfig(); if (!manual && cfg.autoUpdate === false) { updState = { status: 'automatic updates off', error: null, checkedAt: Date.now() }; return; }
  updState = { status: 'checking', error: null, checkedAt: Date.now() };
  try {
    const r = await checkAndUpdate(APP_DIR, (n, t, p) => { updState.status = `downloading ${n}/${t}`; if (n === 1 || n % 10 === 0 || n === t) toast(`Updating map data ${n}/${t}...`); });
    updState = { status: r.updated ? `updated ${r.changed.length} file(s)` : 'up to date', error: null, checkedAt: Date.now() };
    if (r.updated) { toast('Map data updated, reloading...'); setTimeout(() => win && win.webContents.reload(), 1200); }
    else if (manual) toast('Map data is up to date.');
  } catch (e) { updState = { status: 'check failed', error: e.message, checkedAt: Date.now() }; if (manual) toast('Update check failed: ' + e.message); }
}
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { return {}; } }
function writeConfig(c) { fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2)); }

function defaultSaveDirs() {
  const home = os.homedir();
  const c = [];
  if (process.platform === 'win32') {
    for (const base of ['C:\\Games\\Heroes 3 HotA', 'C:\\GOG Games\\HoMM 3 Complete', 'C:\\Program Files (x86)\\GOG Galaxy\\Games\\HoMM 3 Complete', 'C:\\Program Files (x86)\\3DO\\Heroes3', 'C:\\Heroes3', 'D:\\Games\\Heroes 3 HotA', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Heroes of Might & Magic III - HD Edition'])
      c.push(path.join(base, 'Games'));
    c.push(path.join(home, 'Documents', 'My Games', 'Heroes of Might & Magic III - HD Edition', 'Saves'));
  } else {
    c.push(path.join(home, '.var/app/com.usebottles.bottles/data/bottles/bottles/Heroes3/drive_c/Heroes3Complete/Games'));
    c.push(path.join(home, '.wine/drive_c/Heroes3/Games'));
    c.push(path.join(home, '.wine/drive_c/Games/Heroes 3 HotA/Games'));
    c.push(path.join(home, '.local/share/vcmi/Saves'));
  }
  return c;
}

function savesDir() {
  const cfg = readConfig();
  if (cfg.dir && fs.existsSync(cfg.dir)) return cfg.dir;
  for (const d of defaultSaveDirs()) if (fs.existsSync(d)) return d;
  return null;
}

function listSaves(dir) {
  const out = [];
  const walk = (d, rel, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(p, path.join(rel, e.name), depth + 1);
      else if (/\.gm[12]$/i.test(e.name) || /\.cgm$/i.test(e.name)) { const st = fs.statSync(p); out.push({ name: path.join(rel, e.name).split(path.sep).join('/'), mtime: st.mtimeMs / 1000, size: st.size }); }
    }
  };
  walk(dir, '', 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// Scan likely roots for folders that contain .GM1 saves (depth-limited), newest first.
function findSaveFolders() {
  const home = os.homedir(); const roots = [];
  if (process.platform === 'win32') {
    for (const d of ['C', 'D', 'E', 'F']) { for (const sub of ['Games', 'GOG Games', 'Program Files (x86)', 'Program Files', 'Heroes3', 'HoMM3', 'Steam']) roots.push(d + ':\\' + sub); }
    roots.push(path.join(home, 'AppData', 'Local', 'VirtualStore'), path.join(home, 'Documents'), path.join(home, 'Documents', 'My Games'), path.join(home, 'Saved Games'), path.join(home, 'Games'), path.join(home, 'Desktop'), path.join(home, 'Downloads'));
  } else {
    roots.push(path.join(home, '.var', 'app'), path.join(home, '.wine', 'drive_c'), path.join(home, 'Games'), path.join(home, '.local', 'share'), path.join(home, 'Documents'));
  }
  const found = new Map(); const deadline = Date.now() + 20000;
  const walk = (d, depth) => {
    if (depth > 9 || Date.now() > deadline) return;
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    let n = 0, newest = 0;
    for (const e of ents) {
      if (e.isFile() && /\.gm[12]$/i.test(e.name)) { n++; try { newest = Math.max(newest, fs.statSync(path.join(d, e.name)).mtimeMs); } catch (x) {} }
    }
    if (n) found.set(d, { dir: d, count: n, newest });
    for (const e of ents) if (e.isDirectory() && !e.isSymbolicLink() && !/^(node_modules|\.git|Windows|System32|\$Recycle\.Bin)$/i.test(e.name)) walk(path.join(d, e.name), depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // collapse map subfolders into their parent Games folder when both exist
  const out = [...found.values()].filter(f => !found.has(path.dirname(f.dir)) || /games$/i.test(path.basename(f.dir)));
  for (const f of found.values()) { const p = path.dirname(f.dir); if (found.has(p)) { const q = found.get(p); q.count += f.count; q.newest = Math.max(q.newest, f.newest); } }
  return out.sort((a, b) => b.newest - a.newest);
}
let win = null;
async function pickFolder() {
  const r = await dialog.showOpenDialog(win, { title: 'Choose the Heroes 3 Games folder (where .GM1 saves are)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const cfg = readConfig(); cfg.dir = r.filePaths[0]; writeConfig(cfg); return cfg.dir;
}

function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer(async (req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const json = (code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length }); res.end(b); };
      if (url === '/api/info') { const mf = readManifest(APP_DIR) || {}; return json(200, { electron: true, pick: true, dir: savesDir(), version: app.getVersion(), content: { commit: mf.commit, date: mf.date }, update: updState }); }
      if (url === '/api/pick') { const d = await pickFolder(); return json(200, { dir: d || savesDir() }); }
      if (url === '/api/find') return json(200, { folders: findSaveFolders() });
      if (url.startsWith('/api/use/')) { const d = url.slice('/api/use/'.length); if (!fs.existsSync(d)) return json(404, { error: 'missing' }); const cfg = readConfig(); cfg.dir = d; writeConfig(cfg); return json(200, { dir: d }); }
      if (url === '/api/saves') { const d = savesDir(); return json(200, { dir: d || '', saves: d ? listSaves(d) : [] }); }
      if (url.startsWith('/api/save/')) {
        const d = savesDir(); if (!d) return json(404, { error: 'no folder' });
        const p = path.normalize(path.join(d, url.slice('/api/save/'.length)));
        if (!p.startsWith(path.normalize(d)) || !fs.existsSync(p)) return json(404, { error: 'not found' });
        const data = fs.readFileSync(p); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length }); return res.end(data);
      }
      let f = path.normalize(path.join(APP_DIR, url === '/' ? 'index.html' : url));
      if (!f.startsWith(APP_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

app.whenReady().then(async () => {
  try { APP_DIR = seedContent(); } catch (e) { APP_DIR = BUNDLED_DIR; }
  const port = await startServer();
  win = new BrowserWindow({ width: 1600, height: 950, minWidth: 900, minHeight: 600, backgroundColor: '#17120e', title: 'Heroes 3 HotA Companion', autoHideMenuBar: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Choose saves folder...', click: async () => { await pickFolder(); win.webContents.executeJavaScript('typeof srvRefresh === "function" && srvRefresh()'); } },
      { label: 'Reload', role: 'reload' },
      { type: 'separator' },
      { label: 'Check for map data updates now', click: () => updateContent(true) },
      { label: 'Update map data automatically', type: 'checkbox', checked: readConfig().autoUpdate !== false, click: mi => { const c = readConfig(); c.autoUpdate = mi.checked; writeConfig(c); } },
      { label: 'Check for app update (new installer)', click: () => { if (!autoUpdater) return toast('Updater not available in this build.'); autoUpdater.checkForUpdatesAndNotify().catch(e => toast('App update check failed: ' + e.message)); } },
      { label: 'Reset map data to bundled files', click: () => { fs.rmSync(path.join(app.getPath('userData'), 'content'), { recursive: true, force: true }); APP_DIR = seedContent(); win.webContents.reload(); } },
      { type: 'separator' }, { role: 'quit' } ] },
    { label: 'View', submenu: [ { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' } ] },
  ]);
  Menu.setApplicationMenu(menu);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('http://127.0.0.1:' + port + '/');
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => updateContent(false), 1500);
    if (autoUpdater && app.isPackaged) { autoUpdater.autoDownload = true; autoUpdater.on('update-downloaded', info => toast(`App update ${info.version} downloaded, installs when you quit.`)); autoUpdater.checkForUpdatesAndNotify().catch(() => {}); }
  });
});
app.on('window-all-closed', () => app.quit());
