"""Minimal Sarvam REST wrapper; Bulbul and saved-voice cloning."""
from __future__ import annotations

import base64
import mimetypes
import time
import requests

API_BASE = "https://api.sarvam.ai"
RETRY_STATUSES = {429, 500, 502, 503, 504}


class SarvamError(RuntimeError):
    pass


class SarvamClient:
    def __init__(self, api_key: str):
        if not api_key or not api_key.strip():
            raise ValueError("Enter a Sarvam API key.")
        self.session = requests.Session()
        self.session.headers.update({"api-subscription-key": api_key.strip()})

    def _request(self, method: str, path: str, **kwargs) -> dict:
        for attempt in range(3):
            try:
                response = self.session.request(method, API_BASE + path, timeout=(10, 120), **kwargs)
            except requests.RequestException as exc:
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise SarvamError("Could not reach Sarvam AI. Check your connection.") from exc
            if response.status_code in RETRY_STATUSES and attempt < 2:
                retry_after = response.headers.get("Retry-After", "")
                try:
                    delay = min(max(float(retry_after), 0), 10)
                except ValueError:
                    delay = 1.5 * (attempt + 1)
                response.close()
                time.sleep(delay)
                continue
            if not response.ok:
                try:
                    error = response.json()
                    details = error.get("message") or error.get("detail") or error.get("error") or str(error)
                except ValueError:
                    details = response.text[:400]
                raise SarvamError(f"Sarvam API HTTP {response.status_code}: {str(details)[:500]}")
            try:
                return response.json()
            except ValueError as exc:
                raise SarvamError("Sarvam returned a non-JSON response.") from exc
        raise SarvamError("Speech API retries exhausted.")

    def bulbul(self, text: str, language: str, model: str, speaker: str | None,
               pace: float = 1.0, temperature: float = 0.6) -> bytes:
        if model not in {"bulbul:v3", "bulbul:v4-flash"}:
            raise ValueError("Unsupported Bulbul model.")
        if len(text) > 2500:
            raise ValueError("Bulbul text cannot exceed 2500 characters.")
        payload = {
            "text": text, "language_code": language, "model": model,
            "pace": round(pace, 2),
            "speech_sample_rate": 24000, "output_audio_codec": "wav"
        }
        if model == "bulbul:v3":
            payload["temperature"] = round(temperature, 2)
        if speaker:
            payload["speaker"] = speaker
        data = self._request("POST", "/text-to-speech", json=payload)
        encoded = data.get("audios")
        if not isinstance(encoded, list) or not encoded:
            raise SarvamError("Sarvam returned no audio data.")
        try:
            return base64.b64decode("".join(encoded), validate=True)
        except Exception as exc:
            raise SarvamError("Could not decode Bulbul audio.") from exc

    def clone_speech(self, text: str, language: str, voice_id: str, pace: float = 1.0) -> bytes:
        if len(text) > 1000:
            raise ValueError("Cloned speech cannot exceed 1000 characters per request.")
        if not voice_id.startswith("svc-"):
            raise ValueError("Cloned voice ID must begin with svc-.")
        # requests 'files' with (None, value) emits multipart/form-data as required by the API.
        multipart = {
            "voice_id": (None, voice_id), "text": (None, text),
            "language_code": (None, language), "pace": (None, str(round(pace, 2))),
            "output_audio_codec": (None, "wav"), "speech_sample_rate": (None, "24000"),
        }
        data = self._request("POST", "/voices/clone", files=multipart)
        encoded = data.get("audio_b64") or data.get("audio")
        if not encoded:
            raise SarvamError("Sarvam returned no cloned voice audio.")
        try:
            return base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise SarvamError("Could not decode cloned voice audio.") from exc

    def create_voice(self, name: str, audio_bytes: bytes, filename: str,
                     language: str, style: str) -> str:
        if not 1 <= len(name.strip()) <= 100:
            raise ValueError("Voice name must be between 1 and 100 characters.")
        if len(audio_bytes) > 50 * 1024 * 1024:
            raise ValueError("Voice reference file exceeds 50 MB.")
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        data = self._request("POST", "/voices/create",
                             data={"name": name.strip(), "language": language, "style": style},
                             files={"file": (filename, audio_bytes, mime)})
        voice_id = (data.get("data") or {}).get("voice_id") or data.get("voice_id")
        if not voice_id:
            raise SarvamError("Voice creation response lacked a voice ID.")
        return voice_id

    def translate(self, text: str, source: str, target: str) -> str:
        if not text or len(text) > 2000:
            raise ValueError("Translation input must be 1–2000 characters.")
        if source == target:
            return text
        data = self._request("POST", "/translate", json={
            "input": text, "source_language_code": source,
            "target_language_code": target, "model": "sarvam-translate:v1",
            "mode": "formal",
        })
        result = data.get("translated_text")
        if not result:
            raise SarvamError("Translation returned no text.")
        return result
