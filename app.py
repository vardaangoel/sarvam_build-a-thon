"""NarrateAI: Vercel-native FastAPI backend and server-side Sarvam proxy.

The public frontend never receives the Sarvam API credential.
"""
import hmac
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, Depends
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from sarvam_api import SarvamClient, SarvamError
from text_processing import extract_file, extract_url, MAX_INPUT_CHARS

load_dotenv()
ROOT = Path(__file__).resolve().parent
app = FastAPI(title="NarrateAI API", docs_url=None, redoc_url=None)

LANGUAGES = {"en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"}


def verify_password(x_app_password: str | None = Header(default=None)):
    """Fail closed: deployments need a private access password to avoid public credit spending."""
    expected = os.environ.get("APP_ACCESS_PASSWORD", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Set APP_ACCESS_PASSWORD in server environment to enable APIs.")
    if not x_app_password or not hmac.compare_digest(x_app_password.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Incorrect app access password.")


def sarvam() -> SarvamClient:
    key = os.environ.get("SARVAM_API_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="Set SARVAM_API_KEY in server environment.")
    return SarvamClient(key)


def handle_api(fn):
    try:
        return fn()
    except (ValueError, SarvamError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class URLRequest(BaseModel):
    url: str = Field(min_length=12, max_length=2048)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    language: str = "en-IN"
    model: str = "bulbul:v4-flash"
    speaker: str | None = None
    pace: float = Field(default=1.0, ge=0.5, le=2.0)
    temperature: float = Field(default=0.6, ge=0.01, le=1.0)
    voice_id: str | None = None


class TranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1800)
    source: str = "en-IN"
    target: str = "hi-IN"


@app.get("/api/health")
def health():
    return {"ok": True, "api_key_configured": bool(os.environ.get("SARVAM_API_KEY")),
            "access_password_configured": bool(os.environ.get("APP_ACCESS_PASSWORD"))}


@app.post("/api/extract", dependencies=[Depends(verify_password)])
async def extract_document(file: UploadFile = File(...)):
    data = await file.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Document exceeds 4 MB, the safe Vercel upload limit.")
    if not file.filename:
        raise HTTPException(status_code=422, detail="Missing filename.")
    return {"text": handle_api(lambda: extract_file(file.filename, data))[:MAX_INPUT_CHARS]}


@app.post("/api/article", dependencies=[Depends(verify_password)])
def article(req: URLRequest):
    return {"text": handle_api(lambda: extract_url(req.url))[:MAX_INPUT_CHARS]}


@app.post("/api/translate", dependencies=[Depends(verify_password)])
def translate(req: TranslationRequest):
    if req.source not in LANGUAGES or req.target not in LANGUAGES:
        raise HTTPException(422, "Unsupported language code.")
    return {"text": handle_api(lambda: sarvam().translate(req.text, req.source, req.target))}


@app.post("/api/speech", dependencies=[Depends(verify_password)])
def speech(req: SpeechRequest):
    if req.language not in LANGUAGES:
        raise HTTPException(422, "Unsupported language code.")
    if req.model not in {"bulbul:v3", "bulbul:v4-flash"}:
        raise HTTPException(422, "Unsupported Bulbul model.")
    if len(req.text.strip()) < 1:
        raise HTTPException(422, "Text cannot be blank.")
    # A request generates one small WAV clip. The browser assembles long documents.
    # This keeps us well inside Vercel's 4.5MB function response cap.
    def generate():
        client = sarvam()
        if req.voice_id:
            return client.clone_speech(req.text, req.language, req.voice_id, pace=req.pace)
        return client.bulbul(req.text, req.language, req.model, req.speaker,
                             pace=req.pace, temperature=req.temperature)
    audio = handle_api(generate)
    if len(audio) > 3_900_000:
        raise HTTPException(413, "Audio clip too large. Use shorter input or faster speaking pace.")
    return Response(content=audio, media_type="audio/wav",
                    headers={"Cache-Control": "private, no-store", "Content-Disposition": "inline; filename=segment.wav"})


@app.post("/api/voices/create", dependencies=[Depends(verify_password)])
async def create_voice(file: UploadFile = File(...), name: str = Form(...),
                       language: str = Form("en-IN"), style: str = Form("conversational"),
                       consent: str = Form("false")):
    if consent != "true":
        raise HTTPException(422, "Confirm you have permission to clone this voice.")
    if language not in LANGUAGES or style not in {"conversational", "audiobooks", "entertainment", "sales"}:
        raise HTTPException(422, "Invalid language or voice style.")
    data = await file.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise HTTPException(413, "Voice clip must be under 4 MB when hosted on Vercel.")
    voice_id = handle_api(lambda: sarvam().create_voice(name, data, file.filename or "reference.wav", language, style))
    return {"voice_id": voice_id}


@app.get("/")
def index():
    return FileResponse(ROOT / "public" / "index.html")


# On Vercel, public/ assets are served by the CDN. This mount also enables local uvicorn.
app.mount("/", StaticFiles(directory=ROOT / "public"), name="public")
