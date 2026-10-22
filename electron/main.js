const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DIR = path.join(__dirname, 'app');
const CONFIG = path.join(app.getPath('userData'), 'config.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css' };

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
      if (url === '/api/info') return json(200, { electron: true, pick: true, dir: savesDir() });
      if (url === '/api/pick') { const d = await pickFolder(); return json(200, { dir: d || savesDir() }); }
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
  const port = await startServer();
  win = new BrowserWindow({ width: 1600, height: 950, minWidth: 900, minHeight: 600, backgroundColor: '#17120e', title: 'Heroes 3 HotA Companion', autoHideMenuBar: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Choose saves folder...', click: async () => { await pickFolder(); win.webContents.executeJavaScript('typeof srvRefresh === "function" && srvRefresh()'); } },
      { label: 'Reload', role: 'reload' },
      { type: 'separator' }, { role: 'quit' } ] },
    { label: 'View', submenu: [ { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' } ] },
  ]);
  Menu.setApplicationMenu(menu);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('http://127.0.0.1:' + port + '/');
});
app.on('window-all-closed', () => app.quit());
