import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, safeStorage, shell } from 'electron';
import { createChatGPT, CHATGPT_USAGE_URL } from '@siwc/local';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const trustedPage = new URL('renderer/index.html', import.meta.url).href;
let window;
let chat;
let activeChat;
let selectedSource;
let editing;
let settings = { mode: 'balanced', preferences: '', speak: false, float: false, model: '' };
const recordingSessions = new Map();

function reply(data) { return { ok: true, data }; }
function failure(error) { return { ok: false, error: error instanceof Error ? error.message : 'The operation failed.' }; }
function handle(name, operation) {
  ipcMain.handle('aster:' + name, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame?.url !== trustedPage) {
      return failure(new Error('Aster rejected an untrusted request.'));
    }
    try { return reply(await operation(...args)); } catch (error) { return failure(error); }
  });
}
function settingsPath() { return join(app.getPath('userData'), 'settings.json'); }
async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await mkdir(app.getPath('userData'), { recursive: true });
  const temporary = settingsPath() + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await rename(temporary, settingsPath());
  return settings;
}
async function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(await readFile(settingsPath(), 'utf8')) }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function encryptionAvailable() {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));
}
function createChat() {
  return createChatGPT({
    appName: 'Aster', appId: 'aster-personal-desktop', redirectPort: 0, sendHostId: true,
    storageDir: join(app.getPath('userData'), 'chatgpt'),
    credentialEncryption: {
      id: 'electron-safe-storage-v1',
      isAvailable: encryptionAvailable,
      encrypt: text => safeStorage.encryptString(text),
      decrypt: bytes => safeStorage.decryptString(Buffer.from(bytes))
    },
    openBrowser: async url => {
      const target = new URL(url);
      if (target.origin !== 'https://auth.openai.com') throw new Error('Unexpected sign-in address.');
      await shell.openExternal(target.href);
    }
  });
}
async function chatState() {
  if (!encryptionAvailable()) return { status: 'disconnected', sharing: false, secureStorage: false };
  const state = await chat.getSession();
  return { status: state.status, sharing: state.sharing, secureStorage: true, email: state.identity?.email };
}
function instructions(mode, visual) {
  const styles = {
    balanced: 'Be calm, precise, thoughtful, and direct.',
    inventive: 'Offer imaginative options with one concrete first experiment.',
    wild: 'Offer one practical, one bold, and one genuinely unconventional idea with honest tradeoffs.',
    teacher: 'Teach patiently from first principles using examples and a short understanding check.'
  };
  return [
    'You are Aster, a personal desktop companion. Think carefully and speak clearly.',
    styles[mode] || styles.balanced,
    settings.preferences ? 'User preferences:\n' + settings.preferences : '',
    visual ? 'Teach visually. Use a short ASCII diagram or flow, a worked example, and a three-option quiz.' : '',
    'Never claim you opened an app, edited a file, or recorded something. The desktop program handles local commands.'
  ].filter(Boolean).join('\n\n');
}

function launch(executable, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, shell: false, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function openApp(name) {
  const key = name.trim().toLowerCase();
  if (['files', 'file manager', 'explorer', 'downloads'].includes(key)) {
    const location = key === 'downloads' ? app.getPath('downloads') : app.getPath('home');
    const error = await shell.openPath(location); if (error) throw new Error(error); return;
  }
  if (process.platform === 'win32') {
    const windows = {
      calculator: ['explorer.exe', ['shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App']],
      calc: ['calc.exe', []], notes: ['notepad.exe', []], notepad: ['notepad.exe', []],
      'text editor': ['notepad.exe', []], paint: ['mspaint.exe', []]
    };
    if (windows[key]) return launch(windows[key][0], windows[key][1]);
  }
  if (process.platform === 'darwin') return launch('/usr/bin/open', ['-a', name]);
  const linux = { calculator: 'gnome-calculator', calc: 'gnome-calculator', notes: 'mousepad', 'text editor': 'mousepad' };
  if (linux[key]) return launch(linux[key]);
  throw new Error(`I could not find “${name}”. Try calculator, text editor, files, or downloads.`);
}
function safeWeb(action, value) {
  let href;
  if (action === 'search') href = 'https://www.google.com/search?q=' + encodeURIComponent(value);
  else if (action === 'youtube') href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(value);
  else if (action === 'directions') href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(value);
  else if (action === 'browser') href = 'https://www.google.com/';
  else href = /^https?:\/\//i.test(value) ? value : 'https://' + value;
  const url = new URL(href);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a normal HTTP or HTTPS address.');
  return shell.openExternal(url.href);
}

async function chooseTextFile(edit) {
  const selection = await dialog.showOpenDialog(window, { title: edit ? 'Choose a text file to edit' : 'Open a file', properties: ['openFile'] });
  if (selection.canceled) return null;
  const path = selection.filePaths[0];
  if (!edit) { const error = await shell.openPath(path); if (error) throw new Error(error); return { name: basename(path) }; }
  const info = await stat(path);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Choose a text file smaller than 2 MB.');
  const content = await readFile(path, 'utf8');
  if (content.includes('\0')) throw new Error('Aster edits UTF-8 text files only.');
  editing = { path, modified: info.mtimeMs, token: randomUUID() };
  return { token: editing.token, name: basename(path), content };
}
async function saveText(token, content) {
  if (!editing || token !== editing.token) throw new Error('Reopen the file before saving.');
  if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('Text must be smaller than 2 MB.');
  const current = await stat(editing.path);
  if (current.mtimeMs !== editing.modified) throw new Error('The file changed outside Aster. Reopen it before saving.');
  const fileName = basename(editing.path);
  const temporary = join(dirname(editing.path), '.' + fileName + '.aster-' + randomUUID());
  try { await writeFile(temporary, content, { mode: current.mode }); await rename(temporary, editing.path); }
  finally { await unlink(temporary).catch(() => {}); }
  editing = undefined;
  return { name: fileName };
}

function recordingsFolder() { return join(app.getPath('videos'), 'Aster Recordings'); }
async function startRecording(kind) {
  if (!['screen', 'microphone'].includes(kind)) throw new Error('Invalid recording type.');
  await mkdir(recordingsFolder(), { recursive: true });
  const id = randomUUID();
  const name = `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}.webm`;
  const partial = join(recordingsFolder(), '.' + name + '.part');
  const file = await open(partial, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  recordingSessions.set(id, { name, partial, file, bytes: 0 });
  return id;
}
async function recordingChunk(id, chunk) {
  const session = recordingSessions.get(id);
  if (!session || !(chunk instanceof ArrayBuffer) || chunk.byteLength > 64 * 1024 * 1024) throw new Error('Invalid recording segment.');
  await session.file.writeFile(Buffer.from(chunk)); session.bytes += chunk.byteLength;
}
async function finishRecording(id, keep) {
  const session = recordingSessions.get(id); if (!session) return null;
  recordingSessions.delete(id); await session.file.close();
  try {
    if (!keep || !session.bytes) return null;
    await rename(session.partial, join(recordingsFolder(), session.name)); return session.name;
  } finally { await unlink(session.partial).catch(() => {}); }
}

function wire() {
  handle('initial', async () => ({ settings, account: await chatState(), platform: process.platform }));
  handle('chat-state', chatState);
  handle('chat-connect', async () => { if (!encryptionAvailable()) throw new Error('Unlock your system keyring first.'); await chat.signIn({ reconsent: true }); return chatState(); });
  handle('chat-disconnect', async () => { await chat.disconnect(); return chatState(); });
  handle('chat-models', () => chat.listModels());
  handle('chat-send', async (history, mode, visual, model) => {
    if (activeChat) throw new Error('Aster is already replying.');
    if (!Array.isArray(history) || !history.length || history.length > 16) throw new Error('Invalid conversation.');
    activeChat = new AbortController();
    try {
      return await chat.streamResponse({ model, input: history, instructions: instructions(mode, visual), signal: AbortSignal.any([activeChat.signal, AbortSignal.timeout(120000)]), onDelta: delta => window.webContents.send('aster:chat-delta', delta) });
    } finally { activeChat = undefined; }
  });
  handle('chat-stop', () => activeChat?.abort());
  handle('open-chatgpt', async prompt => { if (prompt) clipboard.writeText(prompt); await shell.openExternal('https://chatgpt.com/'); });
  handle('open-web', safeWeb);
  handle('open-app', openApp);
  handle('open-file', () => chooseTextFile(false));
  handle('edit-file', () => chooseTextFile(true));
  handle('save-file', saveText);
  handle('capture-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 300, height: 170 } });
    selectedSource = sources;
    return sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
  });
  handle('select-source', id => { const source = selectedSource?.find(item => item.id === id); if (!source) throw new Error('Choose a source again.'); selectedSource = source; });
  handle('record-start', startRecording);
  handle('record-chunk', recordingChunk);
  handle('record-finish', finishRecording);
  handle('recordings', async () => {
    await mkdir(recordingsFolder(), { recursive: true });
    const { readdir } = await import('node:fs/promises');
    const names = (await readdir(recordingsFolder())).filter(name => /^(screen|microphone)-.*\.webm$/.test(name));
    return Promise.all(names.map(async name => { const info = await stat(join(recordingsFolder(), name)); return { name, bytes: info.size, date: info.mtimeMs, kind: name.split('-')[0] }; }));
  });
  handle('open-recording', async name => { const target = name ? join(recordingsFolder(), basename(name)) : recordingsFolder(); const error = await shell.openPath(target); if (error) throw new Error(error); });
  handle('settings-save', saveSettings);
  handle('float', async () => { const value = await saveSettings({ float: !settings.float }); window.setAlwaysOnTop(value.float); window.setSize(value.float ? 450 : 1180, value.float ? 650 : 820); return value; });
}

async function createWindow() {
  window = new BrowserWindow({ width: 1180, height: 820, minWidth: 850, minHeight: 620, backgroundColor: '#08111f', title: 'Aster', autoHideMenuBar: true,
    webPreferences: { preload: join(root, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const session = window.webContents.session;
  const trusted = contents => contents === window.webContents && contents.getURL() === trustedPage;
  session.setPermissionRequestHandler((contents, permission, callback) => callback(trusted(contents) && ['media', 'display-capture'].includes(permission)));
  session.setDisplayMediaRequestHandler((request, callback) => {
    if (request.frame !== window.webContents.mainFrame || !selectedSource || Array.isArray(selectedSource)) return callback({});
    const source = selectedSource; selectedSource = undefined; callback({ video: source });
  });
  await window.loadFile(join(root, 'renderer', 'index.html'));
  if (settings.float) window.setAlwaysOnTop(true);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    await loadSettings(); chat = createChat(); wire(); await createWindow();
    globalShortcut.register('CommandOrControl+Shift+Space', () => { window.show(); window.focus(); window.webContents.send('aster:focus-input'); });
  }).catch(error => { dialog.showErrorBox('Aster could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
