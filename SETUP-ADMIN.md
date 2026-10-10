# הקמת דף הניהול — מדריך הפעלה חד־פעמי

המדריך הזה מיועד לך, בעל האתר. בסוף התהליך המשתמש נכנס ל-`rozenmusic.co.il/admin/`,
לוחץ "התחברות עם GitHub", ומעלה שירים לבד.

**זמן:** כחצי שעה. **עלות:** אפס. **לא נוגעים ב-DNS ולא בדומיין.**

## איך זה עובד

```
המשתמש → rozenmusic.co.il/admin/ → "התחברות עם GitHub"
                                         ↓
                                    GitHub מאשר מי הוא
                                         ↓
                      Worker בודק: יש לו הרשאת כתיבה לריפו?
                                         ↓ כן
                               דף הניהול נפתח, הוא מפרסם
                                         ↓
                        קומיט ב-GitHub על שמו → האתר מתעדכן
```

שלוש נקודות שחשוב להבין:

1. **GitHub הוא מערכת ההרשאות.** מי שהוא collaborator בריפו יכול לפרסם, מי שלא — לא נכנס.
   אין רשימת מורשים לתחזק ואין סיסמאות.
2. **אין טוקן שמור בשום מקום.** הפרסום מתבצע עם ההרשאה האישית של המשתמש, שפגה לבד.
3. **ה-Worker יודע לעשות שלושה דברים בלבד** — לקרוא את `songs-data.js`, לכתוב אותו, ולהעלות
   קובץ ל-`audio/` או ל-`covers/`. זה נאכף בקוד שלו, לא בהגדרות.

---

## שלב 1 — הרשאה למשתמש

1. המשתמש פותח חשבון חינמי ב-https://github.com/signup ושולח לך את שם המשתמש שלו.
2. אתה: הריפו → **Settings** → **Collaborators** → **Add people** → שם המשתמש → **Add to this repository**

> במאגר אישי אין בחירת רמת הרשאה — collaborator פירושו הרשאת כתיבה, וזה מה שצריך.
> ההזמנה מגיעה למייל שלו ופגה אחרי 7 ימים. אחרי שהוא מאשר, הוא מופיע ברשימה בלי "Pending".

**לבטל גישה בעתיד:** אותו מסך, לוחצים על ה-X לידו. מיידי.

---

## שלב 2 — פריסה ראשונה של ה-Worker

צריך לפרוס פעם אחת כדי לקבל את הכתובת, שתידרש בשלב הבא.

```bash
cd worker
```

```bash
npx wrangler login
```

ייפתח דפדפן שמבקש לאשר. אשר.

```bash
npx wrangler deploy
```

בסוף תופיע שורה עם כתובת בסגנון:

```
https://rozenmusic-admin.<שם-החשבון>.workers.dev
```

**העתק אותה.** נקרא לה מכאן והלאה "כתובת ה-Worker".

---

## שלב 3 — רישום אפליקציית OAuth ב-GitHub

1. https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**
2. **Application name:** `ניהול שירים – ויקטוריה רוזן`
3. **Homepage URL:** `https://rozenmusic.co.il`
4. **Authorization callback URL:** כתובת ה-Worker משלב 2, **בתוספת** `/api/callback`
   לדוגמה: `https://rozenmusic-admin.my-account.workers.dev/api/callback`
5. **Register application**
6. במסך שנפתח: העתק את ה-**Client ID**.
7. לחץ **Generate a new client secret**, והעתק גם אותו. הוא מוצג פעם אחת בלבד.

---

## שלב 4 — חיבור ה-Worker לאפליקציה

פתח את [worker/wrangler.toml](worker/wrangler.toml) ומלא את ה-Client ID:

```toml
GITHUB_CLIENT_ID = "ה-Client ID משלב 3"
```

שמור, וחזרה לטרמינל (עדיין בתיקיית `worker`):

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
```

יבקש ערך — **הדבק את ה-Client Secret משלב 3** ולחץ Enter. הוא נשמר מוצפן אצל Cloudflare
ולא נכנס ל-git.

```bash
npx wrangler deploy
```

---

## שלב 5 — חיבור דף הניהול ל-Worker

פתח את [admin/config.js](admin/config.js) והדבק את כתובת ה-Worker **בתוספת** `/api`:

```js
window.ADMIN_API = 'https://rozenmusic-admin.my-account.workers.dev/api';
```

ואז העלה את האתר:

```bash
git add -A
```

```bash
git commit -m "חיבור דף הניהול"
```

```bash
git push
```

GitHub Pages מעלה את השינוי תוך כדקה.

---

## שלב 6 — בדיקה

1. פתח **חלון גלישה בסתר** ולך ל-`https://rozenmusic.co.il/admin/`
2. אמור להופיע מסך עם כפתור **"התחברות עם GitHub"**
3. לחץ → GitHub מבקש לאשר את האפליקציה → אשר
4. אתה חוזר לדף הניהול, ובפינה העליונה מופיע שם המשתמש שלך
5. נסה **הסתרה** על שיר ואז **הצגה** כדי להחזיר. אם שתיהן עברו — הכל מחובר.

אם משהו נתקע, `npx wrangler tail` מתיקיית `worker` מציג את הלוגים בזמן אמת.

---

## תחזוקה

| מתי | מה לעשות |
|---|---|
| להוסיף משתמש | להוסיף אותו כ-collaborator בריפו. זה הכל |
| לבטל גישה | להסיר אותו מה-collaborators. מיידי |
| לראות מי עשה מה | היסטוריית הקומיטים ב-GitHub. כל שינוי רשום על שם מי שביצע אותו |
| משהו פורסם בטעות | `git revert` על הקומיט הרלוונטי |

אין טוקן שפג ואין סיסמה שצריך להחליף — אין מה לתחזק באופן שוטף.

## מה לשלוח למשתמש

את הקישור `https://rozenmusic.co.il/admin/` ואת [admin/HOWTO.md](admin/HOWTO.md).
אין שום דבר סודי להעביר לו.
