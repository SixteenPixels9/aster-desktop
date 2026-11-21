const $ = id => document.getElementById(id);
const create = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const state = { settings: { mode: 'balanced', preferences: '', speak: false, float: false }, account: {}, models: [], history: [], messages: [], busy: false, recording: null };
let streamText = '';
let streamNode;
let timer;

async function call(method, ...args) {
  const result = await window.aster.invoke(method, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4000); }
async function run(operation) { try { return await operation(); } catch (error) { toast(error.message); } }
function showPage(name) {
  document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== name);
  document.querySelectorAll('.nav').forEach(button => button.classList.toggle('active', button.dataset.page === name));
  $('page-title').textContent = name[0].toUpperCase() + name.slice(1);
  if (name === 'recordings') run(loadRecordings);
}
function showDialog(title, ...content) { $('dialog-title').textContent = title; $('dialog-body').replaceChildren(...content); $('dialog').showModal(); }
function button(text, action, className = '') { const control = create('button', className, text); control.type = 'button'; control.onclick = () => run(action); return control; }
function row(...items) { const line = create('div'); line.style.display = 'flex'; line.style.flexWrap = 'wrap'; line.style.gap = '8px'; line.append(...items); return line; }

function renderMessages() {
  const log = $('messages'); log.replaceChildren();
  if (!state.messages.length) {
    const welcome = create('div', 'welcome');
    welcome.append(create('div', 'brand-orb', '✳'), create('h2', '', 'What are we working on?'), create('p', '', 'Give me a task, or pick something to get started.'));
    const suggestions = create('div', 'suggestions');
    for (const prompt of ['Teach me how sound waves work', 'Give me three wild ideas for a study space', 'Search the web for aurora photos']) suggestions.append(button(prompt, () => submit(prompt)));
    welcome.append(suggestions);
    if (!state.account.sharing) welcome.append(row(button('Connect ChatGPT', connectChat, 'primary'), button('Open regular ChatGPT', () => openChatGPT())));
    log.append(welcome);
  }
  for (const message of state.messages) {
    const article = create('article', 'message ' + message.role); const body = create('div');
    if (message.role === 'assistant') body.append(create('b', '', 'Aster'));
    body.append(create('p', '', message.text));
    if (message.action) body.append(button(message.action.label, message.action.run));
    article.append(body); log.append(article);
  }
  if (state.busy) {
    const article = create('article', 'message assistant'); const body = create('div'); body.append(create('b', '', 'Aster'));
    streamNode = create('p', '', streamText || 'Thinking…'); body.append(streamNode); article.append(body); log.append(article);
  }
  log.scrollTop = log.scrollHeight;
}
function add(role, text, action) { state.messages.push({ role, text, action }); renderMessages(); if (role === 'assistant' && state.settings.speak) speak(text); }
function speak(text) { const voices = speechSynthesis.getVoices().filter(voice => voice.localService); if (!voices.length) return; const speech = new SpeechSynthesisUtterance(text.slice(0, 7000)); speech.voice = voices[0]; speech.rate = .96; speechSynthesis.cancel(); speechSynthesis.speak(speech); }
function activity(kind) { $('status').textContent = kind === 'thinking' ? 'Thinking' : kind === 'recording' ? 'Recording' : 'Standby'; $('caption').textContent = kind === 'thinking' ? 'Preparing a reply' : kind === 'recording' ? 'Saving locally' : 'Ready when you are'; }

function parseCommand(text) {
  const request = text.trim().replace(/^(?:aster[, ]+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?/i, '').replace(/[.!?]$/, '');
  if (/^(?:record|start recording)(?: my| the)? screen$/i.test(request)) return { action: 'screen' };
  if (/^(?:record|start recording)(?: my| the)? (?:microphone|audio|voice)$/i.test(request)) return { action: 'microphone' };
  if (/^stop (?:the )?(?:(?:screen|microphone|audio) )?recording$/i.test(request)) return { action: 'stop' };
  if (/^open (?:my )?recordings$/i.test(request)) return { action: 'recordings' };
  if (/^(?:edit (?:a|the) file|edit file)$/i.test(request)) return { action: 'edit' };
  if (/^(?:open (?:a|the) file|open file)$/i.test(request)) return { action: 'file' };
  const search = request.match(/^(?:search(?: the web)? for|google|look up)\s+(.+)$/i); if (search) return { action: 'web', kind: 'search', value: search[1] };
  const youtube = request.match(/^(?:search for|play)\s+(.+)\s+on youtube$/i); if (youtube) return { action: 'web', kind: 'youtube', value: youtube[1] };
  const directions = request.match(/^(?:get )?directions to\s+(.+)$/i); if (directions) return { action: 'web', kind: 'directions', value: directions[1] };
  const open = request.match(/^(?:open|launch|visit|go to)\s+(.+)$/i);
  if (open) {
    const value = open[1];
    if (/^(?:https?:\/\/|(?:[\w-]+\.)+[a-z]{2,})/i.test(value)) return { action: 'web', kind: 'website', value };
    return { action: 'app', value };
  }
  return null;
}
function visualRequest(text) { return /^(?:teach|explain|show me how|help me (?:learn|understand))/i.test(text.trim()) || state.settings.mode === 'teacher'; }
async function submit(raw) {
  const text = raw.trim(); if (!text || state.busy) return; $('prompt').value = ''; add('user', text);
  const command = parseCommand(text);
  if (command) return executeCommand(command);
  if (/^teach me (?:how )?sound waves(?: work)?$/i.test(text) && !state.account.sharing) { showPage('lessons'); add('assistant', 'I opened the built-in visual lesson on sound waves.'); return; }
  const visual = visualRequest(text);
  if (!state.account.sharing) {
    add('assistant', 'I can prepare this for regular ChatGPT. The prompt will be copied so you can paste it into the chat that opens.', { label: 'Open ChatGPT', run: () => openChatGPT((visual ? 'Teach this visually with a diagram, example, and quiz:\n\n' : '') + text) });
    return;
  }
  const model = $('model').value || state.models[0]?.slug;
  if (!model) { add('assistant', 'Connect ChatGPT again so I can load an available model.'); return; }
  state.busy = true; streamText = ''; activity('thinking'); $('send').hidden = true; $('stop-chat').hidden = false; renderMessages();
  const turn = { role: 'user', content: text };
  try {
    const result = await call('chat-send', [...state.history.slice(-14), turn], state.settings.mode, visual, model);
    state.history.push(turn, { role: 'assistant', content: result.text }); state.busy = false; streamText = ''; add('assistant', result.text);
  } catch (error) { state.busy = false; streamText = ''; add('assistant', error.message); }
  finally { streamNode = undefined; activity(); $('send').hidden = false; $('stop-chat').hidden = true; renderMessages(); }
}
async function executeCommand(command) {
  try {
    if (command.action === 'screen') return chooseScreen();
    if (command.action === 'microphone') return startRecording('microphone');
    if (command.action === 'stop') return stopRecording();
    if (command.action === 'recordings') return showPage('recordings');
    if (command.action === 'edit') return editFile();
    if (command.action === 'file') { const file = await call('open-file'); if (file) add('assistant', 'Opened ' + file.name + '.'); return; }
    if (command.action === 'app') { await call('open-app', command.value); add('assistant', 'Opened ' + command.value + '.'); return; }
    if (command.action === 'web') { await call('open-web', command.kind, command.value); add('assistant', 'Opened this in your browser.'); }
  } catch (error) { add('assistant', error.message); }
}

async function openChatGPT(prompt = '') { await call('open-chatgpt', prompt); if (prompt) toast('Prompt copied. Paste it into ChatGPT.'); }
async function connectChat() { showPage('settings'); $('account-summary').textContent = 'Finish sign-in in your browser…'; state.account = await call('chat-connect'); await loadAccount(); }
async function loadAccount() {
  state.account = await call('chat-state'); $('account-side-text').textContent = state.account.sharing ? 'Plan connected' : 'Browser mode';
  const actions = $('account-actions'); actions.replaceChildren();
  if (state.account.sharing) {
    $('account-summary').textContent = 'Your personal ChatGPT plan is connected' + (state.account.email ? ' as ' + state.account.email : '') + '.';
    actions.append(button('Disconnect', async () => { state.account = await call('chat-disconnect'); state.models = []; await loadAccount(); }));
    try { state.models = await call('chat-models'); $('model').replaceChildren(...state.models.map(item => { const option = create('option', '', item.displayName); option.value = item.slug; return option; })); $('model-wrap').hidden = !state.models.length; if (state.settings.model) $('model').value = state.settings.model; }
    catch (error) { toast(error.message); }
  } else {
    $('account-summary').textContent = state.account.secureStorage === false ? 'Unlock your operating system keyring, or use regular ChatGPT in your browser.' : 'Connect an eligible personal ChatGPT plan for replies inside Aster.';
    actions.append(button('Continue with ChatGPT', connectChat, 'primary'));
    $('model-wrap').hidden = true;
  }
  renderMessages();
}

async function editFile() {
  const file = await call('edit-file'); if (!file) return;
  const editor = create('textarea', 'editor'); editor.value = file.content;
  showDialog(file.name, editor, row(button('Save changes', async () => { await call('save-file', file.token, editor.value); $('dialog').close(); add('assistant', 'Saved ' + file.name + '.'); }, 'primary'), button('Cancel', () => $('dialog').close()))); editor.focus();
}

async function chooseScreen() {
  const sources = await call('capture-sources'); const grid = create('div', 'surface-grid');
  for (const source of sources) { const control = button('', async () => { await call('select-source', source.id); $('dialog').close(); await startRecording('screen'); }, 'surface'); const image = create('img'); image.src = source.thumbnail; image.alt = ''; control.append(image, create('span', '', source.name)); grid.append(control); }
  showDialog('Choose what to record', create('p', '', 'Select a screen or window. Aster records video without microphone audio.'), grid);
}
function recordMenu() { showDialog('Start a recording', create('p', '', 'Choose screen video or microphone audio.'), row(button('Screen or window', chooseScreen, 'primary'), button('Microphone', async () => { $('dialog').close(); await startRecording('microphone'); }))); }
async function mediaRecorder(kind) {
  const stream = kind === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }) : await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const recorder = new MediaRecorder(stream); const id = await call('record-start', kind); let writes = Promise.resolve(); let failed;
  const done = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) writes = writes.then(async () => call('record-chunk', id, await event.data.arrayBuffer())).catch(error => { failed = error; recorder.stop(); }); };
    recorder.onerror = event => { failed = event.error; recorder.stop(); };
    recorder.onstop = async () => { stream.getTracks().forEach(track => track.stop()); try { await writes; const name = await call('record-finish', id, !failed); if (failed) throw failed; resolve(name); } catch (error) { reject(error); } };
  });
  stream.getTracks().forEach(track => track.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); }); recorder.start(1500);
  return { done, stop: () => { if (recorder.state !== 'inactive') recorder.stop(); } };
}
async function startRecording(kind) {
  if (state.recording) throw new Error('Aster is already recording.'); state.recording = await mediaRecorder(kind); activity('recording'); $('record-stop').hidden = false; const started = Date.now();
  timer = setInterval(() => { const seconds = Math.floor((Date.now() - started) / 1000); $('timer').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'); }, 1000);
  add('assistant', kind === 'screen' ? 'Screen recording started.' : 'Microphone recording started.');
  state.recording.done.then(name => { if (name) add('assistant', 'Recording saved.', { label: 'Open recording', run: () => call('open-recording', name) }); }).catch(error => toast(error.message)).finally(() => { state.recording = null; clearInterval(timer); $('record-stop').hidden = true; activity(); if (!$('recordings').hidden) loadRecordings(); });
}
function stopRecording() { if (!state.recording) return toast('No recording is running.'); state.recording.stop(); }
async function loadRecordings() {
  const recordings = (await call('recordings')).sort((a, b) => b.date - a.date); const list = $('recording-list'); list.replaceChildren();
  for (const item of recordings) { const line = create('div', 'recording'); const info = create('div'); info.append(create('b', '', item.kind === 'screen' ? 'Screen recording' : 'Microphone recording'), create('small', '', new Date(item.date).toLocaleString() + ' · ' + Math.ceil(item.bytes / 1024) + ' KB')); line.append(info, button('Open', () => call('open-recording', item.name))); list.append(line); }
}

document.querySelectorAll('.nav').forEach(control => control.onclick = () => showPage(control.dataset.page));
document.querySelectorAll('[data-action]').forEach(control => control.onclick = () => run({ lesson: () => showPage('lessons'), app: () => { $('prompt').value = 'Open '; $('prompt').focus(); }, record: recordMenu, edit: editFile }[control.dataset.action]));
$('composer').onsubmit = event => { event.preventDefault(); run(() => submit($('prompt').value)); };
$('prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); run(() => submit($('prompt').value)); } };
$('new-chat').onclick = () => { state.history = []; state.messages = []; renderMessages(); $('prompt').focus(); };
$('stop-chat').onclick = () => run(() => call('chat-stop'));
$('record-stop').onclick = stopRecording;
$('float').onclick = () => run(async () => { state.settings = await call('float'); document.body.classList.toggle('floating', state.settings.float); $('float').textContent = state.settings.float ? '▣ Expand' : '▣ Float'; });
$('ask-lesson').onclick = () => { showPage('assistant'); $('prompt').value = 'Teach me '; $('prompt').focus(); };
$('open-recordings').onclick = () => run(() => call('open-recording'));
$('account-side').onclick = () => showPage('settings');
$('open-chatgpt').onclick = () => run(() => openChatGPT());
$('save-settings').onclick = () => run(async () => { state.settings = await call('settings-save', { mode: $('mode').value, preferences: $('preferences').value, speak: $('speak').checked, model: $('model').value }); toast('Settings saved.'); });
$('mode').onchange = () => run(async () => { state.settings = await call('settings-save', { mode: $('mode').value }); });
$('model').onchange = () => run(async () => { state.settings = await call('settings-save', { model: $('model').value }); });
$('dialog-close').onclick = () => $('dialog').close();
document.querySelectorAll('#quiz button').forEach(control => control.onclick = () => { const correct = control.dataset.correct === 'true'; $('quiz-answer').textContent = correct ? 'Correct. A pressure pattern travels while individual air molecules mostly vibrate locally.' : 'Try again. Look at the flow diagram.'; control.style.borderColor = correct ? '#73dfbf' : '#df738e'; });
window.aster.on('chat-delta', delta => { if (state.busy) { streamText += delta; if (streamNode) { streamNode.textContent = streamText; $('messages').scrollTop = $('messages').scrollHeight; } } });
window.aster.on('focus-input', () => { showPage('assistant'); $('prompt').focus(); });

run(async () => {
  const initial = await call('initial'); Object.assign(state, initial); $('mode').value = state.settings.mode; $('preferences').value = state.settings.preferences; $('speak').checked = state.settings.speak; document.body.classList.toggle('floating', state.settings.float); renderMessages(); await loadAccount();
});
