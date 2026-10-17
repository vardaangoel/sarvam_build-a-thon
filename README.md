# NarrateAI — Sarvam Bulbul Content Reader (Vercel Edition)

A lightweight FastAPI + HTML/CSS/JavaScript reader designed for Vercel Functions. Uses Sarvam's Bulbul v4 Flash and v3 text-to-speech models, text translation, and saved voice cloning.

## Features

- Paste scripts, articles, newsletters and stories; or import PDF, DOCX, TXT, Markdown, HTML and public article URLs.
- Eleven target narration languages; voice presets (news, fiction, education, conversational); controls for pace and paragraph pauses.
- Split long documents into short API requests and merge clean 16-bit PCM WAV speech clips **in the browser**.
- Quick-preview audio, full audio playback and downloadable WAV.
- Optional paragraph-by-paragraph translation before narration.
- Optional speaker-owned reference voice cloning (subject to Sarvam eligibility and your API plan).
- Access password that protects Sarvam API credits. The key stays on the server.

## Vercel deployment (recommended)

1. Create a new project at [Vercel](https://vercel.com/new) using this code in a GitHub repository (import repository and select **FastAPI** framework), **or** use the Vercel CLI commands below.
2. Under **Settings → Environment Variables** set two server-side, **non-public** values:
   - `SARVAM_API_KEY`: obtain in your [Sarvam dashboard](https://dashboard.sarvam.ai)
   - `APP_ACCESS_PASSWORD`: choose a long, randomly generated password. Do not use the Sarvam API key as this password.
3. Apply the env variables to **Production** (and Preview if needed), then redeploy.
4. Visit the generated `*.vercel.app` URL. Enter your **APP_ACCESS_PASSWORD** inside the app and narrate a short sample to check your API connectivity.

**Never put the Sarvam key in `NEXT_PUBLIC_`, `VITE_`, or browser-visible config.** Do not commit `.env` files.

### Deploy from your computer, without GitHub

Extract this folder and open a terminal in the directory containing `app.py`. You need Node.js and a Vercel account:

```bash
npx vercel login
npx vercel --prod
```

Choose to create a new project when prompted. Once created, configure `SARVAM_API_KEY` and `APP_ACCESS_PASSWORD` in its Vercel dashboard, then run `npx vercel --prod` again to publish with the new settings.

**Note:** This repository contains native FastAPI (`app.py`) and `public/` assets, so Vercel's framework detection should work without any special `vercel.json` routing file. Vercel's Python runtime supports native FastAPI deployments.

## Run locally

```bash
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Create `.env` in the project root:

```dotenv
SARVAM_API_KEY=your_real_sarvam_key
APP_ACCESS_PASSWORD=choose_a_private_password
```

Run `uvicorn app:app --reload` and visit http://localhost:8000.

## API routes

- `GET /api/health`: only tells you if the two server-side settings are present.
- `POST /api/extract`: document upload (form-data, `file`).
- `POST /api/article`: `{"url":"https://..."}`.
- `POST /api/translate`: `{"text":"...","source":"en-IN","target":"hi-IN"}`.
- `POST /api/speech`: `{"text":"...","language":"en-IN","model":"bulbul:v4-flash","pace":1.0}`; returns WAV bytes.
- `POST /api/voices/create`: create a Sarvam cloned voice using a reference clip with explicit permission.

All POST endpoints require a header `x-app-password` equal to `APP_ACCESS_PASSWORD`.

## Important deployment limits

- Uploads: keep under **4 MB** to fit under Vercel's 4.5 MB function request limit.
- Generated clips are assembled on the client; this prevents large serverless responses.
- Generate long documents in chapters; the UI caps each piece at 25,000 characters, and each speech request contains fewer than 500 characters.
- An optional voice ID overrides the regular speaker selection. Voice cloning availability depends on your Sarvam account/plan.
- No OCR for scanned images/PDFs. Use searchable PDFs or paste OCR-extracted text.
- The “emphasis” cue `[em]word[/em]` uses punctuation; it is **not** guaranteed SSML-level emphasis control.
- This is a private password-protected single-user prototype, **not** a multi-tenant commercial authentication system. Users with the password can spend your Sarvam credits. Consider identity-based auth, quotas and rate limits before public release.

## Tests

```bash
python -m pytest -q
node tests/frontend_smoke.cjs
```

The automated tests use mocked speech responses; live Sarvam integration requires a valid API key.

## Developer links

- [Sarvam AI docs](https://docs.sarvam.ai)
- [Bulbul model guide](https://docs.sarvam.ai/api/getting-started/models/bulbul)
- [Vercel FastAPI docs](https://vercel.com/docs/frameworks/backend/fastapi)
