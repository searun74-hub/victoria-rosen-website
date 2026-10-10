"""
דף הניהול בגרסה מקומית.

מריצים:   python admin-local.py
ואז נפתח בדפדפן http://localhost:8745/admin/

מה זה עושה: מגיש את האתר מהתיקייה הזו, ומקבל מדף הניהול את השינויים —
כותב אותם ישירות לקבצים (songs-data.js, audio/, covers/), ואז עושה
commit ו-push ל-GitHub, כך שהאתר מתעדכן תוך כדקה.

להריץ בלי לדחוף ל-GitHub (רק לשמור מקומית):
    set PUSH=0 && python admin-local.py        (Windows)
    PUSH=0 python admin-local.py               (Mac/Linux)

השרת מאזין רק למחשב הזה (127.0.0.1) ואינו נגיש מהרשת.
"""

import base64
import hashlib
import http.server
import io
import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 8745))
PUSH = os.environ.get("PUSH", "1") != "0"
DATA_FILE = os.path.join(ROOT, "songs-data.js")

FILE_HEADER = (
    "// מאגר השירים של האתר — קובץ זה נוצר ונערך אוטומטית על ידי דף הניהול (/admin/).\n"
    "// אפשר לערוך אותו גם ביד, אבל חובה לשמור על מבנה JSON תקין בתוך הסוגריים המרובעים,\n"
    "// אחרת דף הניהול לא יצליח לקרוא אותו (ומרכאות כפולות בלבד, בלי הערות בפנים).\n"
    "const SONGS = "
)

FIELDS = ["slug", "title", "performer", "tags", "credits", "blurb", "lyricsExcerpt",
          "youtubeId", "audioSrc", "coverImage", "duration", "priceNote", "thumbGradient", "hidden"]

MAX_AUDIO = 25 * 1024 * 1024
MAX_COVER = 3 * 1024 * 1024

AUDIO_RE = re.compile(r"^audio/[a-z0-9-]{1,80}\.mp3$")
COVER_RE = re.compile(r"^covers/[a-z0-9-]{1,80}\.(jpg|png|webp)$")
SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$")


class Refused(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def read_songs():
    text = io.open(DATA_FILE, encoding="utf-8").read()
    start, end = text.index("["), text.rindex("]")
    return json.loads(text[start:end + 1]), hashlib.sha1(text.encode("utf-8")).hexdigest()


def validate(songs):
    """אותן בדיקות שה-Worker עושה, כדי שהקובץ לא יישבר."""
    if not isinstance(songs, list) or len(songs) > 500:
        raise Refused("מבנה הנתונים לא תקין")
    seen = set()
    clean = []
    for raw in songs:
        if not isinstance(raw, dict):
            raise Refused("מבנה הנתונים לא תקין")
        for key in raw:
            if key not in FIELDS:
                raise Refused("שדה לא מוכר: " + key)
        slug = raw.get("slug") or ""
        if not SLUG_RE.match(slug):
            raise Refused("מזהה שיר לא תקין")
        if slug in seen:
            raise Refused("יש שני שירים עם אותו מזהה")
        seen.add(slug)
        if not (raw.get("title") or "").strip():
            raise Refused("לשיר חייב להיות שם")
        if raw.get("youtubeId") is not None and not re.match(r"^[A-Za-z0-9_-]{11}$", raw["youtubeId"]):
            raise Refused("מזהה יוטיוב לא תקין")
        if raw.get("audioSrc") is not None and not AUDIO_RE.match(raw["audioSrc"]):
            raise Refused("נתיב קובץ שמע לא תקין")
        if raw.get("coverImage") is not None and not re.match(
                r"^covers/[a-z0-9-]{1,80}\.(jpg|png|webp|svg)$", raw["coverImage"]):
            raise Refused("נתיב תמונה לא תקין")
        clean.append({
            "slug": slug,
            "title": raw["title"].strip(),
            "performer": raw.get("performer") or "",
            "tags": list(raw.get("tags") or []),
            "credits": raw.get("credits") or "",
            "blurb": raw.get("blurb") or "",
            "lyricsExcerpt": raw.get("lyricsExcerpt") or "",
            "youtubeId": raw.get("youtubeId"),
            "audioSrc": raw.get("audioSrc"),
            "coverImage": raw.get("coverImage"),
            "duration": raw.get("duration"),
            "priceNote": raw.get("priceNote") or "לפי פנייה",
            "thumbGradient": raw.get("thumbGradient") or "from-primary/40 to-tertiary/40",
            "hidden": bool(raw.get("hidden")),
        })
    return clean


def write_songs(songs):
    content = FILE_HEADER + json.dumps(songs, ensure_ascii=False, indent=2) + ";\n"
    io.open(DATA_FILE, "w", encoding="utf-8", newline="\n").write(content)


def git(*args):
    return subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True, text=True, encoding="utf-8")


def publish_to_github(message):
    """commit + push. מחזיר אזהרה כטקסט אם משהו לא עבד, או None אם הכל תקין."""
    if not PUSH:
        return "השינוי נשמר במחשב בלבד (PUSH=0). כדי שיופיע באתר צריך לדחוף ל-GitHub."
    add = git("add", "-A")
    if add.returncode != 0:
        return "השמירה הצליחה, אבל git add נכשל: " + (add.stderr or "").strip()
    commit = git("commit", "-m", message)
    if commit.returncode != 0 and "nothing to commit" not in (commit.stdout or ""):
        return "השמירה הצליחה, אבל ה-commit נכשל: " + ((commit.stderr or commit.stdout or "").strip())
    push = git("push")
    if push.returncode != 0:
        return ("השינוי נשמר ונרשם במחשב, אבל ה-push ל-GitHub נכשל: "
                + (push.stderr or "").strip() + " — הריצו git push ידנית.")
    print("[נדחף ל-GitHub]", message.splitlines()[0])
    return None


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def reply(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/songs"):
            try:
                songs, sha = read_songs()
            except Exception:
                return self.reply({"error": "קובץ השירים לא בפורמט שהניהול יודע לקרוא."}, 500)
            return self.reply({"songs": songs, "sha": sha})
        return super().do_GET()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length))
            if self.path.startswith("/api/songs"):
                return self.reply(self.save_songs(body))
            if self.path.startswith("/api/upload"):
                return self.reply(self.save_upload(body))
            return self.reply({"error": "לא נמצא"}, 404)
        except Refused as e:
            return self.reply({"error": str(e)}, e.status)
        except Exception as e:
            return self.reply({"error": "שגיאה בשרת המקומי: " + str(e)}, 500)

    def save_songs(self, body):
        songs = validate(body.get("songs"))
        _, current_sha = read_songs()
        if body.get("sha") and body["sha"] != current_sha:
            raise Refused("קובץ השירים השתנה מאז שפתחתם את הדף. רעננו ונסו שוב.", 409)
        write_songs(songs)
        message = (body.get("message") or "עדכון שירים")[:150] + "\n\nדרך דף הניהול המקומי"
        warning = publish_to_github(message)
        _, new_sha = read_songs()
        out = {"ok": True, "sha": new_sha}
        if warning:
            out["warning"] = warning
            print("[אזהרה]", warning)
        return out

    def save_upload(self, body):
        path = str(body.get("path") or "")
        is_audio = bool(AUDIO_RE.match(path))
        cover = COVER_RE.match(path)
        if not is_audio and not cover:
            raise Refused("אפשר להעלות קבצים רק לתיקיות audio ו-covers")
        try:
            data = base64.b64decode(body.get("contentBase64") or "", validate=True)
        except Exception:
            raise Refused("תוכן הקובץ לא תקין")
        if len(data) > (MAX_AUDIO if is_audio else MAX_COVER):
            raise Refused("הקובץ גדול מדי")
        if is_audio and not (data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0)):
            raise Refused("הקובץ לא נראה כמו קובץ MP3 תקין")
        if cover and not (data[:3] == b"\xff\xd8\xff" or data[:4] == b"\x89PNG" or data[:4] == b"RIFF"):
            raise Refused("הקובץ לא נראה כמו תמונה תקינה")

        target = os.path.join(ROOT, *path.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(data)
        print("[נשמר]", path, "(%.1f מגה)" % (len(data) / 1048576))
        return {"ok": True, "path": path}

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    url = "http://localhost:%d/admin/" % PORT
    print("דף הניהול המקומי פועל.")
    print("כתובת:", url)
    print("פרסום ל-GitHub:", "פעיל" if PUSH else "כבוי (PUSH=0)")
    print("לעצירה: Ctrl+C")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        Server(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nהשרת נעצר.")
