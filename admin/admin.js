/* ממשק הניהול של השירים.
   כל הכתיבה לאתר עוברת דרך ה-Worker ב-/api — דף זה לא מחזיק שום מפתח או סיסמה.
   הזיהוי נעשה על ידי Cloudflare Access לפני שהדף נטען בכלל. */

const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const API = IS_LOCAL ? '/api' : (window.ADMIN_API || '');
const SESSION_KEY = 'vr_admin_session';

const GRADIENTS = [
  'from-primary/40 to-tertiary/40',
  'from-secondary/40 to-primary/40',
  'from-tertiary/40 to-secondary/40',
  'from-primary/40 to-secondary/40',
  'from-secondary/40 to-tertiary/40',
  'from-tertiary/40 to-primary/40'
];

const BASE_TAGS = ['שיר לחתונה', 'שיר לילדים', 'המנון', 'פופ', 'בלדה', 'שיר לאירוע', 'קלאסי'];

const MAX_AUDIO = 25 * 1024 * 1024;
const MAX_COVER = 3 * 1024 * 1024;
const DRAFT_KEY = 'vr_admin_draft';

const state = {
  songs: [],
  sha: null,
  editingSlug: null,   // null = שיר חדש
  tags: [],
  media: 'youtube',
  audioFile: null,
  coverFile: null,
  lastWarning: null
};

/* ---------- עזרי DOM ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

function banner(kind, text) {
  const el = $('banner');
  const styles = {
    ok: 'bg-primary/40 text-on-surface',
    err: 'bg-red-100 text-red-900',
    info: 'bg-tertiary/30 text-on-surface'
  };
  const icons = { ok: 'check_circle', err: 'error', info: 'info' };
  el.className = 'mb-6 rounded-xl px-5 py-4 font-headline font-bold flex items-start gap-3 ' + styles[kind];
  el.innerHTML = '<span class="material-symbols-outlined flex-shrink-0" aria-hidden="true">' + icons[kind] +
    '</span><span>' + text + '</span>';
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function clearBanner() { hide('banner'); }

function busy(text) { $('busy-text').textContent = text; $('busy').classList.remove('hidden'); $('busy').classList.add('flex'); }
function unbusy() { $('busy').classList.add('hidden'); $('busy').classList.remove('flex'); }

function confirmDialog(title, text, yesLabel) {
  return new Promise(resolve => {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel;
    const box = $('confirm');
    box.classList.remove('hidden'); box.classList.add('flex');
    const close = answer => {
      box.classList.add('hidden'); box.classList.remove('flex');
      $('confirm-yes').onclick = null; $('confirm-no').onclick = null;
      resolve(answer);
    };
    $('confirm-yes').onclick = () => close(true);
    $('confirm-no').onclick = () => close(false);
    $('confirm-no').focus();
  });
}

/* ---------- שכבת ה-API ---------- */
function getSession() {
  try { return sessionStorage.getItem(SESSION_KEY) || ''; } catch (_e) { return ''; }
}
function setSession(v) {
  try { v ? sessionStorage.setItem(SESSION_KEY, v) : sessionStorage.removeItem(SESSION_KEY); } catch (_e) { /* ignore */ }
}

async function api(path, options) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getSession();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(API + path, Object.assign({ headers }, options));
  } catch (_e) {
    throw new Error('אין חיבור לאינטרנט, או שהשירות לא זמין כרגע. נסו שוב בעוד רגע.');
  }
  if (res.status === 401) {
    setSession('');
    showLogin('ההתחברות פגה. התחברו שוב.');
    throw new Error('ההתחברות פגה.');
  }
  if (res.status === 403) {
    throw new Error('לחשבון הזה אין הרשאה לערוך את האתר.');
  }
  let data = null;
  try { data = await res.json(); } catch (_e) { /* ignore */ }
  if (!res.ok) {
    throw new Error((data && data.error) || 'השרת החזיר שגיאה (' + res.status + '). נסו שוב.');
  }
  return data;
}

async function loadSongs() {
  const data = await api('/songs');
  state.songs = data.songs;
  state.sha = data.sha;
  return data;
}

async function publishSongs(message) {
  const data = await api('/songs', {
    method: 'POST',
    body: JSON.stringify({ songs: state.songs, sha: state.sha, message: message })
  });
  state.sha = data.sha;
  state.lastWarning = data.warning || null;   // מגיע מהגרסה המקומית, אם ה-push לא בוצע
}

async function uploadFile(path, file) {
  const contentBase64 = await fileToBase64(file);
  await api('/upload', {
    method: 'POST',
    body: JSON.stringify({ path: path, contentBase64: contentBase64, message: 'העלאת קובץ: ' + path })
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('לא הצלחנו לקרוא את הקובץ. נסו לבחור אותו שוב.'));
    reader.readAsDataURL(file);
  });
}

/* ---------- slug ---------- */
const HEB = {
  'ב': 'b', 'ג': 'g', 'ד': 'd', 'ז': 'z', 'ח': 'ch', 'ט': 't', 'כ': 'k', 'ך': 'k', 'ל': 'l',
  'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'f',
  'צ': 'tz', 'ץ': 'tz', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't'
};

/* עברית נכתבת בלי תנועות, אז כתובת שנגזרת ממנה אות-אות יוצאת בליל עיצורים.
   אלה כללי האצבע שמחזירים משהו קריא: shir-bdika-lchatona ולא shyr-bdykh-lchtvnh. */
function transliterateWord(word) {
  let out = '';
  const chars = [...word];
  chars.forEach((ch, i) => {
    const first = i === 0;
    const last = i === chars.length - 1;
    if (ch === 'א') out += 'a';
    else if (ch === 'ה') out += last ? 'a' : 'h';
    else if (ch === 'ו') out += (first || chars[i + 1] === 'ו') ? 'v' : 'o';
    else if (ch === 'י') out += first ? 'y' : 'i';
    else if (HEB[ch]) out += HEB[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
  });
  return out;
}

function slugify(title) {
  const out = String(title).toLowerCase()
    .replace(/["'`׳״֑-ׇ]/g, '')   // גרשיים וניקוד
    .split(/[\s\-_,.!?:;()\[\]]+/)
    .map(transliterateWord)
    .filter(Boolean)
    .join('-')
    .replace(/([aeiou])\1+/g, '$1')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  return out || 'shir';
}

function uniqueSlug(base, ignoreSlug) {
  const taken = new Set(state.songs.filter(s => s.slug !== ignoreSlug).map(s => s.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(base + '-' + i)) i++;
  return base + '-' + i;
}

function parseYouTubeId(url) {
  const s = String(url).trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* ---------- תצוגת הרשימה ---------- */
function thumbFor(song) {
  if (song.youtubeId) return 'https://img.youtube.com/vi/' + song.youtubeId + '/mqdefault.jpg';
  if (song.coverImage) return '../' + song.coverImage;
  return null;
}

function renderList() {
  clearBanner();
  hide('view-form'); hide('loading'); show('view-list');

  const list = $('song-list');
  if (!state.songs.length) {
    list.innerHTML = '<p class="font-headline text-on-surface/60 py-8">עוד אין שירים. לחצו על "הוספת שיר חדש".</p>';
    return;
  }

  list.innerHTML = state.songs.map((song, i) => {
    const thumb = thumbFor(song);

    // התגיות של השיר עצמו, בצבע — אלה התוכן
    const tags = (song.tags || []).map(t =>
      '<span class="chip" style="background:rgba(243,166,131,.35);border-color:transparent">' + esc(t) + '</span>');

    // תוויות טכניות, מעומעמות — אלה רק מצב
    const quiet = 'style="background:transparent;color:rgba(45,52,54,.55)"';
    const badges = [];
    if (song.youtubeId) badges.push('<span class="chip" ' + quiet + '>יוטיוב</span>');
    if (song.audioSrc) badges.push('<span class="chip" ' + quiet + '>MP3</span>');
    if (!song.youtubeId && !song.audioSrc) badges.push('<span class="chip" ' + quiet + '>בלי האזנה</span>');
    if (!tags.length) badges.push('<span class="chip" ' + quiet + '>בלי תגיות</span>');
    if (song.hidden) badges.push('<span class="chip" style="background:rgba(45,52,54,.12)">מוסתר</span>');

    return '<div class="glass-card rounded-xl p-4 flex items-center gap-4 flex-wrap ' +
      (song.hidden ? 'opacity-60' : '') + '">' +
      '<div class="w-20 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br ' + esc(song.thumbGradient || GRADIENTS[0]) +
        ' flex items-center justify-center">' +
        (thumb ? '<img src="' + esc(thumb) + '" alt="" class="w-full h-full object-cover">'
               : '<span class="material-symbols-outlined text-white/90" aria-hidden="true">music_note</span>') +
      '</div>' +
      '<div class="flex-1 min-w-[10rem]">' +
        '<div class="font-headline font-bold text-lg">' + esc(song.title) + '</div>' +
        (song.performer ? '<div class="text-on-surface/60 text-sm">' + esc(song.performer) + '</div>' : '') +
        '<div class="flex flex-wrap gap-1 mt-2">' + tags.join('') + badges.join('') + '</div>' +
      '</div>' +
      '<div class="flex items-center gap-1 flex-shrink-0">' +
        '<button class="btn btn-ghost !px-2" data-act="up" data-i="' + i + '" title="העלאה למעלה" ' +
          (i === 0 ? 'disabled style="opacity:.3"' : '') + '>' +
          '<span class="material-symbols-outlined text-lg" aria-hidden="true">keyboard_arrow_up</span></button>' +
        '<button class="btn btn-ghost !px-2" data-act="down" data-i="' + i + '" title="הורדה למטה" ' +
          (i === state.songs.length - 1 ? 'disabled style="opacity:.3"' : '') + '>' +
          '<span class="material-symbols-outlined text-lg" aria-hidden="true">keyboard_arrow_down</span></button>' +
        '<button class="btn btn-ghost text-sm" data-act="edit" data-i="' + i + '">עריכה</button>' +
        '<button class="btn btn-ghost text-sm" data-act="hide" data-i="' + i + '">' +
          (song.hidden ? 'הצגה' : 'הסתרה') + '</button>' +
        '<button class="btn btn-danger text-sm" data-act="del" data-i="' + i + '">מחיקה</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

$('song-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn || btn.disabled) return;
  const i = Number(btn.dataset.i);
  const song = state.songs[i];
  const act = btn.dataset.act;

  if (act === 'edit') { openForm(song); return; }

  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= state.songs.length) return;
    const copy = state.songs.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    await commit(copy, 'שינוי סדר השירים בקטלוג', 'משנה את הסדר…');
    return;
  }

  if (act === 'hide') {
    const copy = state.songs.map(s => s.slug === song.slug ? Object.assign({}, s, { hidden: !s.hidden }) : s);
    await commit(copy,
      (song.hidden ? 'הצגת השיר ' : 'הסתרת השיר ') + song.title,
      song.hidden ? 'מחזיר את השיר לאתר…' : 'מסתיר את השיר…',
      song.hidden ? 'השיר "' + esc(song.title) + '" חזר לאתר.' : 'השיר "' + esc(song.title) + '" הוסתר. הוא לא מופיע באתר, אבל שמור כאן ואפשר להחזיר אותו בכל רגע.');
    return;
  }

  if (act === 'del') {
    const ok = await confirmDialog('למחוק את "' + song.title + '"?',
      'השיר ייעלם מהאתר ומהרשימה הזו. אם אתם רק רוצים שהוא לא יוצג לזמן מה — עדיף "הסתרה", וזה הפיך בלחיצה.',
      'מחיקה');
    if (!ok) return;
    const copy = state.songs.filter(s => s.slug !== song.slug);
    await commit(copy, 'מחיקת השיר ' + song.title, 'מוחק…', 'השיר "' + esc(song.title) + '" נמחק.');
  }
});

async function commit(newSongs, message, busyText, okText) {
  const before = state.songs;
  state.songs = newSongs;
  busy(busyText);
  try {
    await publishSongs(message);
    renderList();
    if (state.lastWarning) banner('info', esc(state.lastWarning));
    else if (okText) banner('ok', okText);
  } catch (err) {
    state.songs = before;
    renderList();
    banner('err', esc(err.message));
  } finally {
    unbusy();
  }
}

/* ---------- הטופס ---------- */
function openForm(song) {
  state.editingSlug = song ? song.slug : null;
  state.tags = song && Array.isArray(song.tags) ? song.tags.slice() : [];
  state.audioFile = null;
  state.coverFile = null;

  $('form-title').textContent = song ? 'עריכת שיר' : 'שיר חדש';
  $('publish-label').textContent = song ? 'שמירת השינויים' : 'פרסום לאתר';
  $('f-title').value = song ? song.title || '' : '';
  $('f-performer').value = song ? song.performer || '' : '';
  $('f-blurb').value = song ? song.blurb || '' : '';
  $('f-credits').value = song ? song.credits || '' : '';
  $('f-lyrics').value = song ? song.lyricsExcerpt || '' : '';
  $('f-yt').value = song && song.youtubeId ? 'https://www.youtube.com/watch?v=' + song.youtubeId : '';
  $('f-newtag').value = '';
  $('form-error').textContent = '';
  $('dz-audio-text').textContent = song && song.audioSrc
    ? 'קובץ קיים: ' + song.audioSrc.split('/').pop() + ' — לחצו כדי להחליף'
    : 'לחצו לבחירת קובץ, או גררו אותו לכאן';
  $('dz-cover-text').textContent = song && song.coverImage
    ? 'תמונה קיימת: ' + song.coverImage.split('/').pop() + ' — לחצו כדי להחליף'
    : 'לחצו לבחירת תמונה, או גררו אותה לכאן';
  hide('audio-preview');

  setMedia(song ? (song.youtubeId ? 'youtube' : (song.audioSrc ? 'audio' : 'none')) : 'youtube');

  clearBanner();
  hide('view-list'); hide('loading'); show('view-form');
  renderTags(); refreshPreview();
  window.scrollTo({ top: 0 });
  $('f-title').focus();
}

function setMedia(kind) {
  state.media = kind;
  for (const btn of $('media-tabs').querySelectorAll('button')) {
    btn.classList.toggle('on', btn.dataset.media === kind);
  }
  $('media-youtube').classList.toggle('hidden', kind !== 'youtube');
  $('media-audio').classList.toggle('hidden', kind !== 'audio');
  refreshPreview();
}

$('media-tabs').addEventListener('click', e => {
  const btn = e.target.closest('button[data-media]');
  if (btn) setMedia(btn.dataset.media);
});

function renderTags() {
  const all = new Set(BASE_TAGS);
  state.songs.forEach(s => (s.tags || []).forEach(t => all.add(t)));
  state.tags.forEach(t => all.add(t));
  $('tag-chips').innerHTML = [...all].map(t =>
    '<button type="button" class="chip ' + (state.tags.includes(t) ? 'on' : '') + '" data-tag="' + esc(t) + '">' +
    esc(t) + '</button>').join('');
}

$('tag-chips').addEventListener('click', e => {
  const btn = e.target.closest('button[data-tag]');
  if (!btn) return;
  const t = btn.dataset.tag;
  state.tags = state.tags.includes(t) ? state.tags.filter(x => x !== t) : state.tags.concat([t]);
  renderTags(); refreshPreview();
});

function addTag() {
  const t = $('f-newtag').value.trim();
  if (!t) return;
  if (!state.tags.includes(t)) state.tags.push(t);
  $('f-newtag').value = '';
  renderTags(); refreshPreview();
}
$('btn-addtag').addEventListener('click', addTag);
$('f-newtag').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });

/* קבצים */
function wireDropzone(zoneId, inputId, onPick) {
  const zone = $(zoneId), input = $(inputId);
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) onPick(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) onPick(input.files[0]); });
}

function humanSize(bytes) { return (bytes / 1048576).toFixed(1) + ' מגה'; }

wireDropzone('dz-audio', 'f-audio', file => {
  if (!/\.mp3$/i.test(file.name) && file.type !== 'audio/mpeg') {
    $('form-error').textContent = 'אפשר להעלות קובץ MP3 בלבד.'; return;
  }
  if (file.size > MAX_AUDIO) {
    $('form-error').textContent = 'הקובץ גדול מדי (' + humanSize(file.size) + '). המקסימום הוא 25 מגה.'; return;
  }
  $('form-error').textContent = '';
  state.audioFile = file;
  $('dz-audio-text').textContent = file.name + ' (' + humanSize(file.size) + ')';
  const player = $('audio-preview');
  player.src = URL.createObjectURL(file);
  player.classList.remove('hidden');
  refreshPreview();
});

wireDropzone('dz-cover', 'f-cover', file => {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    $('form-error').textContent = 'אפשר להעלות תמונת JPG, PNG או WEBP.'; return;
  }
  if (file.size > MAX_COVER) {
    $('form-error').textContent = 'התמונה גדולה מדי (' + humanSize(file.size) + '). המקסימום הוא 3 מגה.'; return;
  }
  $('form-error').textContent = '';
  state.coverFile = file;
  $('dz-cover-text').textContent = file.name + ' (' + humanSize(file.size) + ')';
  refreshPreview();
});

/* תצוגה מקדימה */
function currentSlug() {
  if (state.editingSlug) return state.editingSlug;
  return uniqueSlug(slugify($('f-title').value), null);
}

function refreshPreview() {
  const title = $('f-title').value.trim();
  const slug = title ? currentSlug() : '';
  $('slug-note').textContent = slug
    ? 'כתובת השיר באתר תהיה: /song.html?slug=' + slug
    : '';

  const ytId = state.media === 'youtube' ? parseYouTubeId($('f-yt').value) : null;
  const ytBox = $('yt-preview');
  if (state.media === 'youtube' && $('f-yt').value.trim()) {
    if (ytId) {
      ytBox.innerHTML = '<div class="flex items-center gap-3 font-headline text-sm">' +
        '<img src="https://img.youtube.com/vi/' + esc(ytId) + '/mqdefault.jpg" alt="" class="w-28 rounded-lg">' +
        '<span class="text-green-800 font-bold">הסרטון זוהה</span></div>';
    } else {
      ytBox.innerHTML = '<p class="font-headline text-sm text-red-700 font-bold">' +
        'לא זיהינו קישור יוטיוב תקין. העתיקו את הכתובת מסרגל הדפדפן בעמוד הסרטון.</p>';
    }
    ytBox.classList.remove('hidden');
  } else {
    ytBox.classList.add('hidden');
  }

  const gradient = gradientFor(slug);
  let media = '';
  if (ytId) {
    media = '<img src="https://img.youtube.com/vi/' + esc(ytId) + '/hqdefault.jpg" alt="" ' +
      'class="absolute inset-0 w-full h-full object-cover"><div class="absolute inset-0 bg-black/25"></div>';
  } else if (state.media === 'audio' && state.coverFile) {
    media = '<img src="' + URL.createObjectURL(state.coverFile) + '" alt="" ' +
      'class="absolute inset-0 w-full h-full object-cover"><div class="absolute inset-0 bg-black/15"></div>';
  }
  const icon = ytId ? 'smart_display' : (state.media === 'audio' ? 'play_circle' : 'music_note');

  $('card-preview').innerHTML =
    '<div class="glass-card rounded-xl overflow-hidden">' +
      '<div class="relative aspect-video bg-gradient-to-br ' + gradient + ' flex items-center justify-center overflow-hidden">' +
        media +
        '<span class="relative material-symbols-outlined text-white text-6xl drop-shadow-lg" aria-hidden="true">' + icon + '</span>' +
      '</div>' +
      '<div class="p-6">' +
        '<div class="flex flex-wrap gap-2 mb-3">' +
          state.tags.map(t => '<span class="font-headline text-xs font-bold px-3 py-1 rounded-full bg-secondary/20">' +
            esc(t) + '</span>').join('') +
        '</div>' +
        '<h3 class="font-headline text-2xl mb-2 font-bold">' + (esc(title) || '<span class="text-on-surface/30">שם השיר</span>') + '</h3>' +
        '<p class="text-on-surface/80 text-sm">' + (esc($('f-blurb').value.trim()) || '<span class="text-on-surface/30">הטקסט על השיר יופיע כאן</span>') + '</p>' +
      '</div>' +
    '</div>';
}

function gradientFor(slug) {
  const existing = state.songs.find(s => s.slug === slug);
  if (existing && existing.thumbGradient) return existing.thumbGradient;
  return GRADIENTS[state.songs.length % GRADIENTS.length];
}

for (const id of ['f-title', 'f-performer', 'f-blurb', 'f-yt']) {
  $(id).addEventListener('input', () => { refreshPreview(); saveDraft(); });
}
for (const id of ['f-credits', 'f-lyrics']) {
  $(id).addEventListener('input', saveDraft);
}

/* טיוטה — כדי שטופס חצי מלא לא ילך לאיבוד */
function saveDraft() {
  if (state.editingSlug) return;   // עריכה של שיר קיים לא נשמרת כטיוטה
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: $('f-title').value, performer: $('f-performer').value, blurb: $('f-blurb').value,
      credits: $('f-credits').value, lyrics: $('f-lyrics').value, yt: $('f-yt').value,
      tags: state.tags, media: state.media
    }));
  } catch (_e) { /* localStorage חסום — לא נורא */ }
}
function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return (d && (d.title || d.blurb || d.lyrics)) ? d : null;
  } catch (_e) { return null; }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_e) { /* ignore */ } }

function applyDraft(d) {
  openForm(null);
  $('f-title').value = d.title || '';
  $('f-performer').value = d.performer || '';
  $('f-blurb').value = d.blurb || '';
  $('f-credits').value = d.credits || '';
  $('f-lyrics').value = d.lyrics || '';
  $('f-yt').value = d.yt || '';
  state.tags = Array.isArray(d.tags) ? d.tags : [];
  setMedia(d.media || 'youtube');
  renderTags(); refreshPreview();
}

/* ---------- פרסום ---------- */
$('song-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('form-error');
  err.textContent = '';

  const title = $('f-title').value.trim();
  const blurb = $('f-blurb').value.trim();
  if (!title) { err.textContent = 'צריך למלא שם לשיר.'; $('f-title').focus(); return; }
  if (!blurb) { err.textContent = 'צריך לכתוב משפט על השיר.'; $('f-blurb').focus(); return; }

  let youtubeId = null;
  if (state.media === 'youtube') {
    const raw = $('f-yt').value.trim();
    if (!raw) { err.textContent = 'הדביקו קישור ליוטיוב, או בחרו אפשרות אחרת למעלה.'; $('f-yt').focus(); return; }
    youtubeId = parseYouTubeId(raw);
    if (!youtubeId) { err.textContent = 'הקישור ליוטיוב לא תקין.'; $('f-yt').focus(); return; }
  }

  const existing = state.editingSlug ? state.songs.find(s => s.slug === state.editingSlug) : null;

  if (state.media === 'audio' && !state.audioFile && !(existing && existing.audioSrc)) {
    err.textContent = 'בחרו קובץ MP3, או בחרו אפשרות אחרת למעלה.'; return;
  }

  const slug = existing ? existing.slug : uniqueSlug(slugify(title), null);

  const song = {
    slug: slug,
    title: title,
    performer: $('f-performer').value.trim(),
    tags: state.tags.slice(),
    credits: $('f-credits').value.trim(),
    blurb: blurb,
    lyricsExcerpt: $('f-lyrics').value.replace(/\r\n/g, '\n'),
    youtubeId: youtubeId,
    audioSrc: null,
    coverImage: null,
    duration: existing ? existing.duration : null,
    priceNote: existing && existing.priceNote ? existing.priceNote : 'לפי פנייה',
    thumbGradient: gradientFor(slug),
    hidden: existing ? !!existing.hidden : false
  };

  if (state.media === 'audio') {
    song.audioSrc = existing && existing.audioSrc ? existing.audioSrc : 'audio/' + slug + '.mp3';
    song.coverImage = existing && existing.coverImage ? existing.coverImage : null;
    if (state.audioFile) song.audioSrc = 'audio/' + slug + '.mp3';
    if (state.coverFile) {
      const ext = state.coverFile.type === 'image/png' ? 'png' : (state.coverFile.type === 'image/webp' ? 'webp' : 'jpg');
      song.coverImage = 'covers/' + slug + '.' + ext;
    }
  }

  try {
    if (state.media === 'audio' && state.audioFile) {
      busy('מעלה את קובץ השיר… (' + humanSize(state.audioFile.size) + ')');
      await uploadFile(song.audioSrc, state.audioFile);
    }
    if (state.media === 'audio' && state.coverFile) {
      busy('מעלה את התמונה…');
      await uploadFile(song.coverImage, state.coverFile);
    }

    busy(existing ? 'שומר את השינויים…' : 'מפרסם את השיר לאתר…');
    const copy = existing
      ? state.songs.map(s => s.slug === existing.slug ? song : s)
      : state.songs.concat([song]);
    const before = state.songs;
    state.songs = copy;
    try {
      await publishSongs((existing ? 'עדכון השיר ' : 'הוספת השיר ') + title);
    } catch (e2) {
      state.songs = before;
      throw e2;
    }

    clearDraft();
    renderList();
    if (state.lastWarning) { banner('info', esc(state.lastWarning)); return; }
    banner('ok', (existing ? 'השינויים נשמרו' : 'השיר "' + esc(title) + '" עלה לאתר') +
      '. אפשר לראות אותו כאן: <a class="underline" target="_blank" href="../song.html?slug=' +
      encodeURIComponent(slug) + '">' + esc(title) + '</a> — ייתכן שייקח כמה דקות עד שיופיע.');
  } catch (e3) {
    err.textContent = e3.message;
  } finally {
    unbusy();
  }
});

$('btn-cancel').addEventListener('click', backToList);
$('btn-back').addEventListener('click', backToList);
async function backToList() {
  const dirty = !state.editingSlug && ($('f-title').value.trim() || $('f-blurb').value.trim() || $('f-lyrics').value.trim());
  if (dirty) {
    const ok = await confirmDialog('לצאת בלי לפרסם?',
      'מה שמילאתם יישמר כטיוטה בדפדפן הזה, ותוכלו לחזור אליו.', 'יציאה');
    if (!ok) return;
  }
  renderList();
}

$('btn-new').addEventListener('click', () => {
  const d = readDraft();
  if (d) { applyDraft(d); banner('info', 'שחזרנו טיוטה שהתחלתם קודם. אם לא צריך אותה, פשוט מוחקים את התוכן ומתחילים מחדש.'); }
  else openForm(null);
});

/* ---------- כניסה ויציאה ---------- */

function showLogin(message) {
  hide('loading'); hide('view-list'); hide('view-form');
  show('view-login');
  $('who').classList.add('hidden');
  $('btn-logout').classList.add('hidden');
  const note = $('login-note');
  if (!API) {
    note.textContent = 'דף הניהול עוד לא חובר לשרת הפרסום. צריך למלא את הכתובת בקובץ admin/config.js.';
    $('btn-login').disabled = true;
  } else {
    note.textContent = message || '';
  }
}

$('btn-login').addEventListener('click', () => { location.href = API + '/login'; });

$('btn-logout').addEventListener('click', () => {
  setSession('');
  location.hash = '';
  showLogin('יצאתם. אפשר להתחבר שוב בכל רגע.');
});

/* הכרטיס חוזר מה-Worker בתוך ה-# של הכתובת. קוראים אותו, שומרים, ומנקים את השורה. */
function takeTokenFromUrl() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const token = params.get('t');
  const error = params.get('error');
  history.replaceState(null, '', location.pathname + location.search);
  if (token) { setSession(token); return null; }
  return error || null;
}

/* ---------- עלייה ---------- */
if (IS_LOCAL) {
  const tag = $('mode-tag');
  if (tag) { tag.textContent = 'מצב מקומי'; tag.classList.remove('hidden'); }
}

(async function init() {
  const loginError = takeTokenFromUrl();

  if (!IS_LOCAL && (loginError || !getSession())) {
    showLogin(loginError || '');
    return;
  }

  try {
    const data = await loadSongs();
    renderList();
    if (!IS_LOCAL) {
      $('btn-logout').classList.remove('hidden');
      if (data && data.login) {
        $('who').textContent = '@' + data.login;
        $('who').classList.remove('hidden');
      }
    }
    const d = readDraft();
    if (d) banner('info', 'יש לכם טיוטה שלא פורסמה ("' + esc(d.title || 'בלי שם') + '"). היא תחכה בלחיצה על "הוספת שיר חדש".');
  } catch (err) {
    if (!getSession() && !IS_LOCAL) return;   // showLogin כבר טיפל בזה
    hide('loading');
    show('view-list');
    $('song-list').innerHTML = '';
    banner('err', esc(err.message));
  }
})();
