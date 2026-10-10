/**
 * Cloudflare Worker — שכבת הפרסום של דף הניהול.
 *
 * למה הוא קיים: הטוקן של GitHub יושב כאן בצד השרת ולא מגיע אף פעם לדפדפן.
 * ה-Worker יודע לעשות שלושה דברים בלבד — לקרוא את songs-data.js, לכתוב אותו,
 * ולהעלות קובץ לתיקיות audio/ או covers/. אין לו שום דרך לגעת בשאר האתר.
 *
 * אימות: Cloudflare Access חוסם את /api/* ואת /admin/* לפני שהבקשה מגיעה לכאן,
 * וה-Worker מאמת שוב את ה-JWT שהוא מנפיק (defense in depth) — כך שגם אם מישהו
 * יעקוף את ה-route, בלי JWT חתום הוא לא יקבל כלום.
 *
 * משתני סביבה (secrets):
 *   GITHUB_TOKEN   — fine-grained PAT, מוגבל לריפו הזה, הרשאת Contents: Read and write
 *   GITHUB_REPO    — למשל searun74-hub/victoria-rosen-website
 *   GITHUB_BRANCH  — master
 *   ACCESS_TEAM    — שם ה-team ב-Cloudflare Zero Trust (החלק שלפני .cloudflareaccess.com)
 *   ACCESS_AUD     — ה-Application Audience (AUD) Tag של האפליקציה ב-Access
 */

const DATA_PATH = 'songs-data.js';

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
    const path = url.pathname.replace(/^\/api/, '');

    try {
      const identity = await verifyAccess(request, env);

      if (path === '/songs' && request.method === 'GET') return json(await getSongs(env));
      if (path === '/songs' && request.method === 'POST') return json(await putSongs(request, env, identity));
      if (path === '/upload' && request.method === 'POST') return json(await putUpload(request, env, identity));

      return json({ error: 'לא נמצא' }, 404);
    } catch (err) {
      const status = err.status || 500;
      return json({ error: err.message || 'שגיאה בשרת' }, status);
    }
  }
};

/* ---------- עזרים ---------- */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ---------- אימות Cloudflare Access ---------- */

let jwksCache = { keys: null, at: 0 };

async function getJwks(team) {
  const TTL = 60 * 60 * 1000;
  if (jwksCache.keys && Date.now() - jwksCache.at < TTL) return jwksCache.keys;
  const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) throw fail(500, 'לא הצלחנו לאמת את ההרשאה');
  const data = await res.json();
  jwksCache = { keys: data.keys || [], at: Date.now() };
  return jwksCache.keys;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyAccess(request, env) {
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) throw fail(500, 'ה-Worker לא הוגדר במלואו (ACCESS_TEAM / ACCESS_AUD)');

  const token = request.headers.get('Cf-Access-Jwt-Assertion') ||
    (request.headers.get('Cookie') || '').match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) throw fail(401, 'אין הרשאה. רעננו את הדף כדי להתחבר מחדש.');

  const parts = token.split('.');
  if (parts.length !== 3) throw fail(401, 'הרשאה לא תקינה');

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));

  const keys = await getJwks(env.ACCESS_TEAM);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw fail(401, 'ההרשאה פגה. רעננו את הדף.');

  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw fail(401, 'הרשאה לא תקינה');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw fail(401, 'ההרשאה פגה. רעננו את הדף.');
  if (payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) throw fail(401, 'הרשאה לא תקינה');
  // ACCESS_AUD יכול להכיל כמה מזהים מופרדים בפסיק, אם יש יותר מאפליקציה אחת ב-Access
  const allowed = String(env.ACCESS_AUD).split(',').map(s => s.trim()).filter(Boolean);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.some(a => allowed.includes(a))) throw fail(401, 'הרשאה לא תקינה');

  return { email: payload.email || 'unknown' };
}

/* ---------- GitHub ---------- */

async function gh(env, path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rozenmusic-admin-worker',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (res.status === 401 || res.status === 403) throw fail(500, 'הטוקן של GitHub לא תקף או שפג. צריך להנפיק טוקן חדש.');
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

async function getSongs(env) {
  const file = await gh(env, `contents/${DATA_PATH}?ref=${env.GITHUB_BRANCH}`);
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
  return { songs, sha: file.sha };
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

async function putSongs(request, env, identity) {
  const body = await request.json().catch(() => { throw fail(400, 'בקשה לא תקינה'); });
  const songs = validateSongs(body.songs);

  // הגנה מפני דריסה: אם הקובץ באתר השתנה מאז שהדף נטען, לא כותבים.
  const current = await gh(env, `contents/${DATA_PATH}?ref=${env.GITHUB_BRANCH}`);
  if (body.sha && body.sha !== current.sha) {
    throw fail(409, 'השירים באתר עודכנו מאז שפתחתם את הדף. רעננו את הדף ונסו שוב.');
  }

  const content = FILE_HEADER + JSON.stringify(songs, null, 2) + ';\n';
  const message = (str(body.message, 150, 'הודעה') || 'עדכון שירים') + `\n\nדרך דף הניהול, על ידי ${identity.email}`;

  const res = await gh(env, `contents/${DATA_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: utf8ToBase64(content),
      sha: current.sha,
      branch: env.GITHUB_BRANCH
    })
  });
  return { ok: true, sha: res.content.sha };
}

/* ---------- העלאת קבצים ---------- */

const MAGIC = {
  mp3: bytes => (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||   // ID3
                (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0),                 // MPEG frame
  jpg: bytes => bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF,
  png: bytes => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47,
  webp: bytes => bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
};

async function putUpload(request, env, identity) {
  const body = await request.json().catch(() => { throw fail(400, 'בקשה לא תקינה'); });
  const path = String(body.path || '');

  const isAudio = /^audio\/[a-z0-9-]{1,80}\.mp3$/.test(path);
  const coverMatch = path.match(/^covers\/[a-z0-9-]{1,80}\.(jpg|png|webp)$/);
  if (!isAudio && !coverMatch) throw fail(400, 'אפשר להעלות קבצים רק לתיקיות audio ו-covers');

  const b64 = String(body.contentBase64 || '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw fail(400, 'תוכן הקובץ לא תקין');

  const size = Math.floor(b64.length * 3 / 4);
  const max = isAudio ? LIMITS.audioBytes : LIMITS.coverBytes;
  if (size > max) throw fail(400, 'הקובץ גדול מדי');

  // בדיקת חתימת הקובץ, כדי שלא יוכלו להעלות משהו אחר במסווה של mp3 או תמונה
  const head = atob(b64.slice(0, 32));
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8 && i < head.length; i++) bytes[i] = head.charCodeAt(i);
  const kind = isAudio ? 'mp3' : (coverMatch[1] === 'jpeg' ? 'jpg' : coverMatch[1]);
  if (!MAGIC[kind](bytes)) throw fail(400, 'הקובץ לא נראה כמו ' + (isAudio ? 'קובץ MP3' : 'תמונה') + ' תקין');

  // קובץ קיים באותו שם מוחלף — צריך את ה-sha שלו
  let sha;
  try {
    const existing = await gh(env, `contents/${path}?ref=${env.GITHUB_BRANCH}`);
    sha = existing.sha;
  } catch (_e) { /* הקובץ לא קיים, זו העלאה חדשה */ }

  await gh(env, `contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `העלאת קובץ: ${path}\n\nדרך דף הניהול, על ידי ${identity.email}`,
      content: b64,
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {})
    })
  });

  return { ok: true, path };
}
