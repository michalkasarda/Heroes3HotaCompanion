// Run the companion without Electron:  node app/lib/standalone.js [savesDir] [gameDir]
const path = require('path'); const fs = require('fs'); const os = require('os');
const { createServer, findGameDir, listSaves } = require('./server');
let savesDir = process.argv[2] || null, gameDir = process.argv[3] || null;
const home = os.homedir();
if (!savesDir) for (const d of [path.join(home, '.var/app/com.usebottles.bottles/data/bottles/bottles/Heroes3/drive_c/Heroes3Complete/Games'), path.join(home, '.wine/drive_c/Heroes3/Games')]) if (fs.existsSync(d)) { savesDir = d; break; }
if (!gameDir) gameDir = findGameDir([savesDir]);
const srv = createServer({ appDir: path.resolve(__dirname, '..'), getSavesDir: () => savesDir, setSavesDir: d => { savesDir = d; }, getGameDir: () => gameDir, listSaves, info: () => ({ electron: false, version: 'standalone' }) });
srv.listen(8765, '127.0.0.1', () => console.log('http://localhost:8765/  saves:', savesDir, ' game:', gameDir));
