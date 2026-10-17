"""Merge standalone PCM WAV clips into one valid WAV with deliberate pauses."""
from __future__ import annotations

from io import BytesIO
import shutil
import subprocess
import wave

from text_processing import Pause, Speech, Event


def combine_wav(events: list[Event], audio_clips: list[bytes]) -> bytes:
    """Join audio clips in Speech event order, including silence for Pause events."""
    required = sum(isinstance(e, Speech) for e in events)
    if required != len(audio_clips):
        raise ValueError(f"Expected {required} audio clips, received {len(audio_clips)}.")
    if not audio_clips:
        raise ValueError("No audio clips to combine.")

    out_io = BytesIO()
    reference = None
    i = 0
    with wave.open(out_io, "wb") as writer:
        for event in events:
            if isinstance(event, Speech):
                try:
                    with wave.open(BytesIO(audio_clips[i]), "rb") as reader:
                        params = reader.getparams()
                        current = (params.nchannels, params.sampwidth, params.framerate, params.comptype)
                        if params.comptype != "NONE":
                            raise ValueError("API did not return uncompressed WAV audio.")
                        if reference is None:
                            reference = current
                            writer.setnchannels(params.nchannels)
                            writer.setsampwidth(params.sampwidth)
                            writer.setframerate(params.framerate)
                            writer.setcomptype(params.comptype, params.compname)
                        elif current != reference:
                            raise ValueError("Audio chunk formats differ. Try regenerating the narration.")
                        writer.writeframes(reader.readframes(params.nframes))
                except wave.Error as exc:
                    raise ValueError("Received invalid WAV audio from the speech API.") from exc
                i += 1
            elif isinstance(event, Pause):
                if reference is None:
                    continue
                ch, width, rate, _ = reference
                silence = b"\x00" * (int(rate * event.seconds) * ch * width)
                writer.writeframes(silence)
    return out_io.getvalue()


def wav_to_mp3(wav_data: bytes, bitrate: str = "160k") -> bytes | None:
    """Use locally installed ffmpeg; return None if it is unavailable."""
    if not shutil.which("ffmpeg"):
        return None
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0",
         "-f", "mp3", "-b:a", bitrate, "pipe:1"],
        input=wav_data, capture_output=True, timeout=120, check=False,
    )
    if result.returncode:
        raise RuntimeError("MP3 conversion failed: " + result.stderr.decode(errors="replace")[:250])
    return result.stdout


def get_wav_duration(wav_data: bytes) -> float:
    with wave.open(BytesIO(wav_data), "rb") as f:
        return f.getnframes() / f.getframerate()
