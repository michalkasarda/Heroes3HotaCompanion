// Content updater: mirrors the repo's app/ folder from the main branch into a local directory,
// downloading only files whose git blob sha changed. No Electron dependency, plain Node.
const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = 'michalkasarda', REPO = 'Heroes3HotaCompanion', BRANCH = 'main', PREFIX = 'app/';

function get(url, binary) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'hota-companion', 'Accept': binary ? '*/*' : 'application/vnd.github+json' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location, binary).then(resolve, reject);
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    }).on('error', reject);
  });
}

function readManifest(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (e) { return null; } }

// Returns {updated: bool, changed: [paths], commit} ; throws on network failure.
async function checkAndUpdate(contentDir, onProgress) {
  const head = JSON.parse((await get(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}`)).toString());
  const commit = head.sha;
  const manifest = readManifest(contentDir) || { commit: null, files: {} };
  if (manifest.commit === commit) return { updated: false, changed: [], commit };
  const tree = JSON.parse((await get(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${commit}?recursive=1`)).toString());
  const remote = {};
  for (const e of tree.tree) if (e.type === 'blob' && e.path.startsWith(PREFIX)) remote[e.path.slice(PREFIX.length)] = e.sha;
  const changed = Object.keys(remote).filter(p => manifest.files[p] !== remote[p] || !fs.existsSync(path.join(contentDir, p)));
  const removed = Object.keys(manifest.files).filter(p => !(p in remote));
  const tmp = path.join(contentDir, '.incoming'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  let n = 0;
  for (const p of changed) {
    const data = await get(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${commit}/${PREFIX}${p}`, true);
    fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), data);
    n++; if (onProgress) onProgress(n, changed.length, p);
  }
  for (const p of changed) { const dst = path.join(contentDir, p); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.renameSync(path.join(tmp, p), dst); }
  for (const p of removed) fs.rmSync(path.join(contentDir, p), { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(contentDir, 'manifest.json'), JSON.stringify({ commit, date: head.commit.committer.date, version: manifest.version, files: remote }));
  return { updated: changed.length + removed.length > 0, changed, removed, commit };
}

module.exports = { checkAndUpdate, readManifest };
