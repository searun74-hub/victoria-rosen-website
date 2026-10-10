# הקמת דף הניהול — מדריך הפעלה חד־פעמי

המדריך הזה מיועד לך, בעל האתר. אחרי שתסיים אותו, המשתמש הנוסף נכנס ל-`rozenmusic.co.il/admin/`,
מקבל קוד למייל, ומעלה שירים לבד. אתה לא צריך לעשות שום דבר נוסף.

**זמן משוער:** 30-40 דקות. **עלות:** אפס — הכל במסלולים החינמיים.

## איך זה עובד

```
המשתמש → rozenmusic.co.il/admin/ → Cloudflare Access (מי מורשה להיכנס?)
                                         ↓ עבר
                                    דף הניהול
                                         ↓ שולח בקשה ל-/api
                                    Worker (מחזיק את טוקן GitHub, יודע לגעת רק בשירים)
                                         ↓
                                    קומיט ב-GitHub → האתר מתעדכן
```

שתי נקודות שחשוב להבין:

1. **הטוקן של GitHub אף פעם לא מגיע לדפדפן של המשתמש.** הוא יושב ב-Worker.
2. **ה-Worker יודע לעשות שלושה דברים בלבד** — לקרוא את `songs-data.js`, לכתוב אותו, ולהעלות
   קובץ לתיקיות `audio/` או `covers/`. אין לו דרך לגעת בדף הבית, במספר הוואטסאפ או בכל קובץ אחר.
   זה נאכף בקוד ה-Worker עצמו, לא בהגדרות.

## שלב 1 — טוקן GitHub

1. היכנס ל-https://github.com/settings/personal-access-tokens/new
2. **Token name:** `rozenmusic-admin`
3. **Expiration:** שנה (רשום לעצמך תזכורת לחדש)
4. **Repository access:** בחר **Only select repositories** → `searun74-hub/victoria-rosen-website`
5. **Permissions** → Repository permissions → **Contents** → בחר **Read and write**.
   אל תיתן שום הרשאה אחרת.
6. צור את הטוקן והעתק אותו. הוא מוצג **פעם אחת בלבד** — שמור אותו זמנית במקום בטוח.

## שלב 2 — העברת ה-DNS ל-Cloudflare

האתר נשאר ב-GitHub Pages. Cloudflare רק יושב לפניו.

1. פתח חשבון חינמי ב-https://dash.cloudflare.com
2. **Add a site** → `rozenmusic.co.il` → בחר את המסלול **Free**
3. Cloudflare יסרוק את רשומות ה-DNS הקיימות. ודא שכל הרשומות של GitHub Pages הועתקו
   (ארבע רשומות `A` ל-`185.199.108-111.153`, ורשומת `CNAME` ל-`www`).
4. Cloudflare ייתן לך **שני שרתי שמות** (nameservers). היכנס לספק שבו קנית את הדומיין
   והחלף שם את שרתי השמות לאלה. זה השלב היחיד שמתבצע מחוץ ל-Cloudflare.
5. ההחלפה לוקחת בין כמה דקות לכמה שעות. Cloudflare ישלח מייל כשזה פעיל.
6. אחרי שזה פעיל: **SSL/TLS** → **Overview** → ודא שהמצב הוא **Full (strict)**.
7. **SSL/TLS** → **Edge Certificates** → הפעל **Always Use HTTPS**.

> בזמן ההעברה האתר ממשיך לעבוד. אין downtime.

## שלב 3 — הגדרת Cloudflare Access

כאן קובעים מי בכלל מורשה להיכנס לדף הניהול.

1. בתפריט הצד: **Zero Trust**. בפעם הראשונה הוא יבקש לבחור שם צוות (team name) —
   בחר משהו כמו `rozenmusic`. **שמור את השם הזה**, הוא נדרש בשלב הבא.
   בחר את המסלול **Free** (עד 50 משתמשים).
2. **Access** → **Applications** → **Add an application** → **Self-hosted**
3. **Application name:** `ניהול שירים`
4. **Session Duration:** 24 שעות (או פחות, לטעמך)
5. **Public hostname** — הוסף **שתי** רשומות:
   - `rozenmusic.co.il` + path `admin`
   - `rozenmusic.co.il` + path `api`

   אם הגרסה שלך לא מאפשרת שתי רשומות באותה אפליקציה, צור אפליקציה שנייה זהה עבור `api`.
   במקרה כזה יהיו לך שני ערכי AUD — ראה הערה בשלב 4.
6. **Policies** → **Add a policy**:
   - **Policy name:** `מורשים`
   - **Action:** Allow
   - **Include** → **Emails** → הזן את כתובת המייל שלך ואת של המשתמש הנוסף
7. שמור. אחרי השמירה, פתח את האפליקציה שוב והעתק את ה-**Application Audience (AUD) Tag**
   מלשונית Overview. זו מחרוזת ארוכה של אותיות ומספרים.

**לשנות מי מורשה בעתיד:** אותו מסך, עריכת ה-policy. הסרה של מייל נכנסת לתוקף מיד.
**לראות מי נכנס:** Zero Trust → **Logs** → **Access**.

## שלב 4 — פריסת ה-Worker

מתוך תיקיית הפרויקט, בטרמינל:

```bash
cd worker
npx wrangler login
```

ערוך את `worker/wrangler.toml` והסר את הסימון מהשורות של `ACCESS_TEAM` ו-`ACCESS_AUD`:

```toml
ACCESS_TEAM = "rozenmusic"
ACCESS_AUD  = "ה-AUD שהעתקת בשלב 3"
```

> אם יצרת שתי אפליקציות ב-Access, רשום את שני ערכי ה-AUD מופרדים בפסיק:
> `ACCESS_AUD = "aud1,aud2"`

עכשיו הזן את הטוקן של GitHub כסוד (הוא לא נשמר בקובץ ולא נכנס ל-git):

```bash
npx wrangler secret put GITHUB_TOKEN
```

הדבק את הטוקן כשהוא מבקש. ואז:

```bash
npx wrangler deploy
```

## שלב 5 — בדיקה

1. פתח **בחלון גלישה בסתר** את `https://rozenmusic.co.il/admin/`
2. אתה אמור לקבל מסך של Cloudflare שמבקש מייל, ואז קוד חד־פעמי.
3. אחרי הכניסה — רשימת השירים נטענת.
4. נסה להסתיר שיר ולהחזיר אותו. אם זה עבד, הכל מחובר.
5. בדיקה אחרונה וחשובה: פתח את `/admin/` מדפדפן אחר **בלי להתחבר**.
   אתה אמור להיחסם לפני שהדף נטען בכלל.

אם משהו לא עובד, `npx wrangler tail` מציג את הלוגים של ה-Worker בזמן אמת.

## תחזוקה

| מתי | מה לעשות |
|---|---|
| להוסיף או להסיר משתמש | Zero Trust → Access → Applications → עריכת ה-policy |
| הטוקן פג (שנה) | להנפיק חדש בשלב 1, ואז `npx wrangler secret put GITHUB_TOKEN` מחדש |
| לבטל גישה מיידית | מחיקת המייל מה-policy. אין צורך לגעת בטוקן |
| משהו פורסם בטעות | כל שינוי הוא קומיט ב-GitHub. `git revert` מחזיר אותו |

## מה לשלוח למשתמש

את הקישור `https://rozenmusic.co.il/admin/` ואת הקובץ [admin/HOWTO.md](admin/HOWTO.md).
אין סיסמה להעביר — הכניסה היא בקוד שנשלח למייל שלו בכל פעם.
