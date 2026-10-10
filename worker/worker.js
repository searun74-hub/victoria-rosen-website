/**
 * Cloudflare Worker — שכבת ההזדהות והפרסום של דף הניהול.
 *
 * הרעיון: GitHub הוא מערכת ההרשאות. מי שהוא collaborator בריפו יכול לפרסם שירים,
 * מי שלא — לא נכנס. אין טוקן שמור בשום מקום, אין סיסמאות, ואין רשימת מורשים לתחזק.
 *
 * הזרימה:
 *   1. דף הניהול שולח את המשתמש ל-/api/login
 *   2. ה-Worker מעביר אותו ל-GitHub שיאשר
 *   3. GitHub מחזיר אותו ל-/api/callback עם קוד
 *   4. ה-Worker מחליף את הקוד בטוקן אישי של המשתמש, ובודק שיש לו הרשאת כתיבה לריפו
 *   5. ה-Worker מצפין את הטוקן לתוך "כרטיס כניסה" ומחזיר את המשתמש לדף הניהול
 *   6. כל פרסום מתבצע עם ההרשאה האישית שלו — והקומיטים נרשמים על שמו
 *
 * הגדרות ב-wrangler.toml:
 *   GITHUB_REPO       — searun74-hub/victoria-rosen-website
 *   GITHUB_BRANCH     — master
 *   GITHUB_CLIENT_ID  — ה-Client ID של אפליקציית ה-OAuth (לא סודי)
 *   ADMIN_URL         — https://rozenmusic.co.il/admin/
 *
 * סוד (נכנס בפקודה npx wrangler secret put):
 *   GITHUB_CLIENT_SECRET — ה-Client Secret של אותה אפליקציה
 */

const DATA_PATH = 'songs-data.js';
const SITEMAP_PATH = 'sitemap.xml';
const SITE = 'https://rozenmusic.co.il';
const SESSION_HOURS = 8;   // מתיישר עם תפוגת ההרשאה של GitHub (Expire user access tokens)
const SCOPE = 'public_repo';   // הריפו ציבורי, אז זו ההרשאה הצרה שמספיקה

const FILE_HEADER = `// מאגר השירים של האתר — קובץ זה נוצר ונערך אוטומטית על ידי דף הניהול (/admin/).
// אפשר לערוך אותו גם ביד, אבל חובה לשמור על מבנה JSON תקין בתוך הסוגריים המרובעים,
// אחרת דף הניהול לא יצליח לקרוא אותו (ומרכאות כפולות בלבד, בלי הערות בפנים).
const SONGS = `;

const LIMITS = {
  songs: 500,
  audioBytes: 25 * 1024 * 1024,
  coverBytes: 3 * 1024 * 1024,
  text: { title: 200, performer: 200, credits: 2000, blurb: 1000, lyricsExcerpt: 20000, priceNote: 100, tag: 60 },
  tags: 12
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request, env);

    try {
      if (path === '/login') return redirectToGitHub(request, env);
      if (path === '/callback') return handleCallback(request, env);

      const session = await requireSession(request, env);

      if (path === '/me') return reply({ login: session.login }, 200, request, env);
      if (path === '/songs' && request.method === 'GET') return reply(await getSongs(env, session), 200, request, env);
      if (path === '/songs' && request.method === 'POST') return reply(await putSongs(request, env, session), 200, request, env);
      if (path === '/upload' && request.method === 'POST') return reply(await putUpload(request, env, session), 200, request, env);

      return reply({ error: 'לא נמצא' }, 404, request, env);
    } catch (err) {
      return reply({ error: err.message || 'שגיאה בשרת' }, err.status || 500, request, env);
    }
  }
};

/* ---------- תשובות ו-CORS ---------- */

function allowedOrigins(env) {
  // דף הניהול מתארח על האתר, ה-Worker על כתובת אחרת — אז צריך להתיר לו במפורש
  const admin = new URL(env.ADMIN_URL || 'https://rozenmusic.co.il/admin/');
  return [admin.origin, 'http://localhost:8745', 'http://127.0.0.1:8745'];
}

function cors(res, request, env) {
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins(env).includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.headers.set('Access-Control-Max-Age', '86400');
  }
  return res;
}

function reply(body, status, request, env) {
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  return cors(res, request, env);
}

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ---------- base64url ---------- */

function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- כרטיס כניסה מוצפן ----------
   הטוקן של המשתמש לא נשמר בשום מסד נתונים. הוא מוצפן לתוך מחרוזת שהדפדפן שלו
   מחזיק לזמן הביקור, ורק ה-Worker יודע לפתוח אותה. */

async function sessionKey(env) {
  if (!env.GITHUB_CLIENT_SECRET) throw fail(500, 'ה-Worker לא הוגדר במלואו (חסר GITHUB_CLIENT_SECRET)');
  const material = new TextEncoder().encode(env.GITHUB_CLIENT_SECRET + '|session-v1');
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(env, payload) {
  const key = await sessionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(iv.length + enc.length);
  out.set(iv); out.set(enc, iv.length);
  return bytesToB64url(out);
}

async function unseal(env, token) {
  const raw = b64urlToBytes(token);
  const key = await sessionKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function requireSession(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw fail(401, 'צריך להתחבר');
  let session;
  try {
    session = await unseal(env, token);
  } catch (_e) {
    throw fail(401, 'ההתחברות פגה. התחברו מחדש.');
  }
  if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) {
    throw fail(401, 'ההתחברות פגה. התחברו מחדש.');
  }
  return session;
}

/* ---------- התחברות מול GitHub ---------- */

function workerOrigin(request) {
  return new URL(request.url).origin;
}

async function redirectToGitHub(request, env) {
  if (!env.GITHUB_CLIENT_ID) throw fail(500, 'ה-Worker לא הוגדר במלואו (חסר GITHUB_CLIENT_ID)');
  const state = await seal(env, { n: bytesToB64url(crypto.getRandomValues(new Uint8Array(12))), t: Date.now() });
  const target = new URL('https://github.com/login/oauth/authorize');
  target.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  target.searchParams.set('redirect_uri', workerOrigin(request) + '/api/callback');
  target.searchParams.set('scope', SCOPE);
  target.searchParams.set('state', state);
  return Response.redirect(target.toString(), 302);
}

function backToAdmin(env, fragment) {
  const base = env.ADMIN_URL || 'https://rozenmusic.co.il/admin/';
  return Response.redirect(base + '#' + fragment, 302);
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (url.searchParams.get('error')) return backToAdmin(env, 'error=' + encodeURIComponent('ההתחברות בוטלה.'));
  if (!code || !state) return backToAdmin(env, 'error=' + encodeURIComponent('ההתחברות נכשלה. נסו שוב.'));

  // אימות ה-state, כדי שלא יוכלו לגרור את המשתמש להתחברות שהוא לא יזם
  try {
    const parsed = await unseal(env, state);
    if (!parsed.t || Date.now() - parsed.t > 10 * 60 * 1000) throw new Error('stale');
  } catch (_e) {
    return backToAdmin(env, 'error=' + encodeURIComponent('ההתחברות פגה באמצע. נסו שוב.'));
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: workerOrigin(request) + '/api/callback'
    })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenData.access_token) {
    return backToAdmin(env, 'error=' + encodeURIComponent('GitHub לא אישר את ההתחברות. נסו שוב.'));
  }

  // כאן נקבעת ההרשאה: האם למשתמש הזה יש באמת גישת כתיבה לריפו
  const repoRes = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}`, {
    headers: ghHeaders(tokenData.access_token)
  });
  if (!repoRes.ok) return backToAdmin(env, 'error=' + encodeURIComponent('לא הצלחנו לבדוק את ההרשאות מול GitHub.'));
  const repo = await repoRes.json();
  if (!repo.permissions || !repo.permissions.push) {
    return backToAdmin(env, 'error=' + encodeURIComponent(
      'החשבון הזה לא מורשה לערוך את האתר. בקשו מבעל האתר להוסיף אתכם כ-collaborator.'));
  }

  const userRes = await fetch('https://api.github.com/user', { headers: ghHeaders(tokenData.access_token) });
  const user = await userRes.json().catch(() => ({}));

  const session = await seal(env, {
    login: user.login || 'unknown',
    gh: tokenData.access_token,
    exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600
  });
  return backToAdmin(env, 't=' + session);
}

/* ---------- GitHub API ---------- */

function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'rozenmusic-admin-worker'
  };
}

async function gh(env, session, path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
    ...options,
    headers: {
      ...ghHeaders(session.gh),
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (res.status === 401) throw fail(401, 'ההתחברות פגה. התחברו מחדש.');
  if (res.status === 403) throw fail(403, 'אין לחשבון הזה הרשאה לערוך את האתר.');
  if (res.status === 409) throw fail(409, 'מישהו עדכן את השירים בו זמנית. רעננו את הדף ונסו שוב.');
  if (!res.ok) {
    const text = await res.text();
    throw fail(502, 'GitHub החזיר שגיאה (' + res.status + '): ' + text.slice(0, 300));
  }
  return res.json();
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------- קריאה וכתיבה של השירים ---------- */

async function getSongs(env, session) {
  const file = await gh(env, session, `contents/${DATA_PATH}?ref=${env.GITHUB_BRANCH}`);
  const text = base64ToUtf8(file.content);
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw fail(500, 'קובץ השירים באתר לא בפורמט שהניהול יודע לקרוא.');
  let songs;
  try {
    songs = JSON.parse(text.slice(start, end + 1));
  } catch (_e) {
    throw fail(500, 'קובץ השירים באתר לא בפורמט JSON תקין. מישהו ערך אותו ביד ושבר אותו.');
  }
  return { songs, sha: file.sha, login: session.login };
}

const FIELDS = ['slug', 'title', 'performer', 'tags', 'credits', 'blurb', 'lyricsExcerpt',
  'youtubeId', 'audioSrc', 'coverImage', 'duration', 'priceNote', 'thumbGradient', 'hidden'];

function str(v, max, name) {
  if (v == null) return '';
  if (typeof v !== 'string') throw fail(400, `השדה ${name} לא תקין`);
  if (v.length > max) throw fail(400, `השדה ${name} ארוך מדי`);
  return v;
}

function validateSongs(songs) {
  if (!Array.isArray(songs)) throw fail(400, 'מבנה הנתונים לא תקין');
  if (songs.length > LIMITS.songs) throw fail(400, 'יותר מדי שירים');

  const seen = new Set();
  return songs.map(raw => {
    if (!raw || typeof raw !== 'object') throw fail(400, 'מבנה הנתונים לא תקין');
    for (const k of Object.keys(raw)) {
      if (!FIELDS.includes(k)) throw fail(400, `שדה לא מוכר: ${k}`);
    }
    if (!/^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/.test(raw.slug || '')) throw fail(400, 'מזהה שיר לא תקין');
    if (seen.has(raw.slug)) throw fail(400, 'יש שני שירים עם אותו מזהה');
    seen.add(raw.slug);

    const title = str(raw.title, LIMITS.text.title, 'שם השיר').trim();
    if (!title) throw fail(400, 'לשיר חייב להיות שם');

    const tags = Array.isArray(raw.tags) ? raw.tags : [];
    if (tags.length > LIMITS.tags) throw fail(400, 'יותר מדי תגיות');

    if (raw.youtubeId != null && !/^[A-Za-z0-9_-]{11}$/.test(raw.youtubeId)) throw fail(400, 'מזהה יוטיוב לא תקין');
    if (raw.audioSrc != null && !/^audio\/[a-z0-9-]{1,80}\.mp3$/.test(raw.audioSrc)) throw fail(400, 'נתיב קובץ שמע לא תקין');
    if (raw.coverImage != null && !/^covers\/[a-z0-9-]{1,80}\.(jpg|png|webp|svg)$/.test(raw.coverImage)) throw fail(400, 'נתיב תמונה לא תקין');
    if (raw.thumbGradient != null && !/^from-[a-z-]{1,20}\/\d{1,3} to-[a-z-]{1,20}\/\d{1,3}$/.test(raw.thumbGradient)) {
      throw fail(400, 'הגדרת צבעים לא תקינה');
    }

    return {
      slug: raw.slug,
      title,
      performer: str(raw.performer, LIMITS.text.performer, 'מבצע'),
      tags: tags.map(t => str(t, LIMITS.text.tag, 'תגית')),
      credits: str(raw.credits, LIMITS.text.credits, 'קרדיטים'),
      blurb: str(raw.blurb, LIMITS.text.blurb, 'תיאור'),
      lyricsExcerpt: str(raw.lyricsExcerpt, LIMITS.text.lyricsExcerpt, 'מילים'),
      youtubeId: raw.youtubeId == null ? null : raw.youtubeId,
      audioSrc: raw.audioSrc == null ? null : raw.audioSrc,
      coverImage: raw.coverImage == null ? null : raw.coverImage,
      duration: raw.duration == null ? null : str(raw.duration, 20, 'אורך'),
      priceNote: str(raw.priceNote, LIMITS.text.priceNote, 'מחיר') || 'לפי פנייה',
      thumbGradient: raw.thumbGradient || 'from-primary/40 to-tertiary/40',
      hidden: !!raw.hidden
    };
  });
}

/* ---------- sitemap ----------
   נבנה מחדש בכל פרסום, אחרת שיר חדש לא נכנס אליו ושיר מוסתר נשאר בו.
   כתובות שאינן של שירים נשמרות כמו שהן, והתאריך של שיר קיים לא משתנה סתם —
   רק שיר חדש מקבל את התאריך של היום. */
function buildSitemap(current, songs) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = current.match(/<url>[\s\S]*?<\/url>/g) || [];

  const nonSong = entries.filter(e => !e.includes('song.html?slug='));
  const bySlug = new Map();
  for (const e of entries) {
    const m = e.match(/song\.html\?slug=([a-z0-9-]+)/);
    if (m) bySlug.set(m[1], e);
  }

  const songEntries = songs.filter(s => !s.hidden).map(s => bySlug.get(s.slug) ||
    `<url><loc>${SITE}/song.html?slug=${s.slug}</loc><lastmod>${today}</lastmod>` +
    `<changefreq>monthly</changefreq><priority>0.7</priority></url>`);

  const firstUrl = current.indexOf('<url>');
  const head = firstUrl === -1
    ? '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    : current.slice(0, firstUrl);

  return head + nonSong.concat(songEntries).join('\n') + '\n</urlset>\n';
}

/* קומיט אחד שנוגע בכמה קבצים, כדי שהשירים וה-sitemap לא ייפרדו לעולם */
async function commitFiles(env, session, files, message) {
  const ref = await gh(env, session, `git/ref/heads/${env.GITHUB_BRANCH}`);
  const baseSha = ref.object.sha;
  const baseCommit = await gh(env, session, `git/commits/${baseSha}`);

  const tree = await gh(env, session, 'git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }))
    })
  });

  const commit = await gh(env, session, 'git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] })
  });

  await gh(env, session, `git/refs/heads/${env.GITHUB_BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha })
  });
}

async function putSongs(request, env, session) {
  const body = await request.json().catch(() => { throw fail(400, 'בקשה לא תקינה'); });
  const songs = validateSongs(body.songs);

  // הגנה מפני דריסה: אם הקובץ באתר השתנה מאז שהדף נטען, לא כותבים
  const current = await gh(env, session, `contents/${DATA_PATH}?ref=${env.GITHUB_BRANCH}`);
  if (body.sha && body.sha !== current.sha) {
    throw fail(409, 'השירים באתר עודכנו מאז שפתחתם את הדף. רעננו את הדף ונסו שוב.');
  }

  const content = FILE_HEADER + JSON.stringify(songs, null, 2) + ';\n';
  const message = (str(body.message, 150, 'הודעה') || 'עדכון שירים') + '\n\nדרך דף הניהול';

  const files = [{ path: DATA_PATH, content }];

  // ה-sitemap מתעדכן יחד עם השירים. אם הוא לא נקרא, לא מפילים בגלל זה את הפרסום.
  try {
    const sm = await gh(env, session, `contents/${SITEMAP_PATH}?ref=${env.GITHUB_BRANCH}`);
    const before = base64ToUtf8(sm.content);
    const after = buildSitemap(before, songs);
    if (after !== before) files.push({ path: SITEMAP_PATH, content: after });
  } catch (_e) { /* אין sitemap או שלא ניתן לקרוא אותו */ }

  await commitFiles(env, session, files, message);

  const updated = await gh(env, session, `contents/${DATA_PATH}?ref=${env.GITHUB_BRANCH}`);
  return { ok: true, sha: updated.sha, sitemapUpdated: files.length > 1 };
}

/* ---------- העלאת קבצים ---------- */

const MAGIC = {
  mp3: b => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0),
  jpg: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  png: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47,
  webp: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
};

async function putUpload(request, env, session) {
  const body = await request.json().catch(() => { throw fail(400, 'בקשה לא תקינה'); });
  const path = String(body.path || '');

  const isAudio = /^audio\/[a-z0-9-]{1,80}\.mp3$/.test(path);
  const coverMatch = path.match(/^covers\/[a-z0-9-]{1,80}\.(jpg|png|webp)$/);
  if (!isAudio && !coverMatch) throw fail(400, 'אפשר להעלות קבצים רק לתיקיות audio ו-covers');

  const b64 = String(body.contentBase64 || '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw fail(400, 'תוכן הקובץ לא תקין');

  const size = Math.floor(b64.length * 3 / 4);
  if (size > (isAudio ? LIMITS.audioBytes : LIMITS.coverBytes)) throw fail(400, 'הקובץ גדול מדי');

  // בדיקת חתימת הקובץ, כדי שלא יעלו משהו אחר במסווה של mp3 או תמונה
  const head = atob(b64.slice(0, 32));
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8 && i < head.length; i++) bytes[i] = head.charCodeAt(i);
  const kind = isAudio ? 'mp3' : coverMatch[1];
  if (!MAGIC[kind](bytes)) throw fail(400, 'הקובץ לא נראה כמו ' + (isAudio ? 'קובץ MP3' : 'תמונה') + ' תקין');

  let sha;
  try {
    const existing = await gh(env, session, `contents/${path}?ref=${env.GITHUB_BRANCH}`);
    sha = existing.sha;
  } catch (_e) { /* הקובץ לא קיים, זו העלאה חדשה */ }

  await gh(env, session, `contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `העלאת קובץ: ${path}\n\nדרך דף הניהול`,
      content: b64,
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {})
    })
  });

  return { ok: true, path };
}
