import os
import json
import logging
import subprocess
from app import job_control
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
try:
    import imageio_ffmpeg
except ImportError:
    imageio_ffmpeg = None

logger = logging.getLogger(__name__)

def get_ffmpeg_path() -> str:
    """Get FFmpeg binary path checking local bin, imageio-ffmpeg, or system PATH."""
    local_bin = Path(__file__).resolve().parent.parent / "bin" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if local_bin.exists():
        return str(local_bin)

    if imageio_ffmpeg is not None:
        try:
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
            if ffmpeg_exe and Path(ffmpeg_exe).exists():
                return str(ffmpeg_exe)
        except Exception as e:
            logger.warning(f"imageio_ffmpeg failed to get ffmpeg: {e}")
    
    # Fallback to system ffmpeg
    return "ffmpeg"


def get_video_metadata(video_path: str) -> dict:
    """Use FFprobe to extract metadata from video."""
    default_meta = {
        "duration": 0.0,
        "frame_rate": 24.0,
        "width": 0,
        "height": 0,
        "codec": "unknown",
        "audio_codec": "unknown",
        "audio_channels": 0,
        "audio_sample_rate": 0
    }
    
    ffprobe_exe = "ffprobe"
    try:
        ffmpeg_exe = get_ffmpeg_path()
        if ffmpeg_exe != "ffmpeg":
            ffprobe_dir = Path(ffmpeg_exe).parent
            # Basic ffprobe resolution in the same dir as ffmpeg
            ffprobe_path = ffprobe_dir / "ffprobe"
            if os.name == 'nt':
                ffprobe_path = ffprobe_path.with_suffix('.exe')
            if ffprobe_path.exists():
                ffprobe_exe = str(ffprobe_path)
    except Exception:
        ffprobe_exe = "ffprobe"

    cmd = [
        ffprobe_exe,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        video_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            
            # Duration from format
            if "format" in data and "duration" in data["format"]:
                default_meta["duration"] = float(data["format"]["duration"])
                
            # Stream info
            if "streams" in data:
                for stream in data["streams"]:
                    if stream.get("codec_type") == "video" and default_meta["codec"] == "unknown":
                        default_meta["codec"] = stream.get("codec_name", "unknown")
                        default_meta["width"] = int(stream.get("width", 0))
                        default_meta["height"] = int(stream.get("height", 0))
                        
                        # Frame rate
                        fr_str = stream.get("r_frame_rate", "24/1")
                        try:
                            if "/" in fr_str:
                                num, den = fr_str.split("/")
                                if float(den) != 0:
                                    default_meta["frame_rate"] = float(num) / float(den)
                            else:
                                default_meta["frame_rate"] = float(fr_str)
                        except Exception:
                            pass
                    
                    elif stream.get("codec_type") == "audio" and default_meta["audio_codec"] == "unknown":
                        default_meta["audio_codec"] = stream.get("codec_name", "unknown")
                        default_meta["audio_channels"] = int(stream.get("channels", 0))
                        default_meta["audio_sample_rate"] = int(stream.get("sample_rate", 0))
            default_meta["is_audio"] = (default_meta["width"] == 0 and default_meta["height"] == 0 and (default_meta["audio_channels"] > 0 or default_meta["duration"] > 0))
            return default_meta
    except Exception:
        pass
        
    # Robust fallback using ffmpeg -i directly
    meta = _parse_metadata_via_ffmpeg(video_path, default_meta)
    meta["is_audio"] = (meta.get("width", 0) == 0 and meta.get("height", 0) == 0 and (meta.get("audio_channels", 0) > 0 or meta.get("duration", 0) > 0))
    return meta


def _parse_metadata_via_ffmpeg(video_path: str, default_meta: dict) -> dict:
    """Fallback metadata parser using ffmpeg -i when ffprobe is not installed."""
    import re
    try:
        ffmpeg_exe = get_ffmpeg_path()
        res = subprocess.run([ffmpeg_exe, "-i", video_path], capture_output=True, text=True, timeout=10)
        err = res.stderr or ""
        
        # Parse duration
        dur_m = re.search(r'Duration:\s*(\d+):(\d+):([\d.]+)', err)
        if dur_m:
            h, m, s = dur_m.groups()
            default_meta["duration"] = round(int(h) * 3600 + int(m) * 60 + float(s), 3)

        # Parse resolution
        res_m = re.search(r'Stream.*Video:.*,\s*(\d{2,5})x(\d{2,5})', err)
        if res_m:
            default_meta["width"] = int(res_m.group(1))
            default_meta["height"] = int(res_m.group(2))

        # Parse FPS
        fps_m = re.search(r'([\d.]+)\s*fps', err)
        if fps_m:
            default_meta["frame_rate"] = float(fps_m.group(1))

        # Parse video codec
        codec_m = re.search(r'Video:\s*([a-zA-Z0-9_-]+)', err)
        if codec_m:
            default_meta["codec"] = codec_m.group(1)
            
        # Parse audio channels & sample rate
        audio_m = re.search(r'Audio:.*,\s*(\d+)\s*Hz,\s*([a-zA-Z0-9]+)', err)
        if audio_m:
            default_meta["audio_sample_rate"] = int(audio_m.group(1))
            ch_str = audio_m.group(2).lower()
            default_meta["audio_channels"] = 2 if "stereo" in ch_str else 1
    except Exception:
        pass
    default_meta["is_audio"] = (default_meta["width"] == 0 and default_meta["height"] == 0 and (default_meta["audio_channels"] > 0 or default_meta["duration"] > 0))
    return default_meta


def extract_audio_from_video(video_path: str, output_path: str = None, progress_cb=None) -> dict:
    """Extract or convert audio track from video/audio to 16kHz mono WAV file using FFmpeg.

    progress_cb(percent, seconds_done, seconds_total) is optional: when given, FFmpeg runs with
    `-progress` so the caller gets real, time-based progress. The FFmpeg arguments that shape the
    output are identical either way, so the resulting WAV is the same.
    """
    base_path = os.path.splitext(video_path)[0]
    ext = Path(video_path).suffix.lower()

    # If file is already a valid WAV audio file, reuse directly in 0.001s without invoking FFmpeg
    if ext == ".wav" and os.path.exists(video_path):
        try:
            import soundfile as sf
            info = sf.info(video_path)
            if info.frames > 0 and info.samplerate > 0:
                return {
                    "audio_path": str(video_path),
                    "duration": float(info.duration),
                    "sample_rate": info.samplerate,
                    "channels": info.channels
                }
        except Exception:
            pass

    if output_path is None:
        output_path = f"{base_path}_audio.wav" if ext == ".wav" else f"{base_path}.wav"

    # Reuse previously extracted audio if it exists and is valid
    if Path(output_path).exists() and Path(output_path).stat().st_size > 1000:
        duration = get_video_metadata(video_path).get("duration", 0.0)
        return {
            "audio_path": output_path,
            "duration": duration,
            "sample_rate": 16000,
            "channels": 1
        }

    # Avoid FFmpeg crashing if input and output path resolve to the same file
    if os.path.abspath(video_path) == os.path.abspath(output_path):
        output_path = f"{base_path}_16k.wav"
        
    ffmpeg_exe = get_ffmpeg_path()
    
    cmd = [
        ffmpeg_exe,
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-y",
        output_path
    ]
    
    if progress_cb is not None:
        return _extract_with_progress(video_path, output_path, cmd, progress_cb)

    try:
        result = job_control.run_subprocess(cmd, timeout=600)
        if result.returncode != 0:
            logger.error(f"FFmpeg extract audio error: {result.stderr}")
            return {
                "audio_path": None,
                "duration": 0.0,
                "sample_rate": 0,
                "channels": 0
            }
            
        if Path(output_path).exists():
            duration = get_video_metadata(video_path).get("duration", 0.0)
            return {
                "audio_path": output_path,
                "duration": duration,
                "sample_rate": 16000,
                "channels": 1
            }
            
    except Exception as e:
        logger.error(f"Exception extracting audio: {e}")
        
    return {
        "audio_path": None,
        "duration": 0.0,
        "sample_rate": 0,
        "channels": 0
    }



def _extract_with_progress(video_path: str, output_path: str, cmd: list, progress_cb, timeout_sec: int = 3600) -> dict:
    """Run the same FFmpeg extraction as extract_audio_from_video, reporting real progress.

    FFmpeg's `-progress pipe:1` stream prints `out_time_us=<microseconds of media processed>`;
    dividing by the container duration gives an honest percentage.
    """
    import time as _time

    failed = {"audio_path": None, "duration": 0.0, "sample_rate": 0, "channels": 0}
    total = float(get_video_metadata(video_path).get("duration", 0.0) or 0.0)
    progress_cmd = [cmd[0], "-progress", "pipe:1", "-nostats", "-loglevel", "error"] + cmd[1:]
    started = _time.time()
    tail = []
    try:
        proc = subprocess.Popen(progress_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        job_control.track_process(proc)
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                try:
                    micros = int(line.split("=", 1)[1])
                except ValueError:
                    continue
                done = max(0.0, micros / 1_000_000.0)
                pct = min(99.0, done / total * 100.0) if total > 0 else None
                try:
                    progress_cb(pct, done, total)
                except Exception:
                    pass
            elif "=" not in line and line:
                tail.append(line)
                tail = tail[-10:]
            if _time.time() - started > timeout_sec:
                proc.kill()
                logger.error("FFmpeg extract audio timed out")
                return failed
        proc.wait()
        if proc.returncode != 0:
            logger.error(f"FFmpeg extract audio error: {' | '.join(tail)}")
            return failed
        if Path(output_path).exists():
            return {
                "audio_path": output_path,
                "duration": total,
                "sample_rate": 16000,
                "channels": 1
            }
    except Exception as e:
        logger.error(f"Exception extracting audio: {e}")
    return failed

def detect_shot_changes(video_path: str, threshold: float = 0.3) -> List[float]:
    """Use FFmpeg scene detection filter to find shot changes (skipped on low-resource cloud)."""
    ext = Path(video_path).suffix.lower()
    if ext in get_supported_audio_extensions():
        return []

    # Skip heavy scene detection on cloud (Render / low-resource) or if disabled via env var
    is_cloud = bool(os.getenv("RENDER") or os.getenv("PORT"))
    enable_shots = os.getenv("ENABLE_SHOT_DETECTION", "false" if is_cloud else "true").lower() == "true"
    if not enable_shots:
        logger.info("Skipping FFmpeg video shot detection on cloud instance to prevent OOM/CPU throttling.")
        return []

    meta = get_video_metadata(video_path)
    duration = float(meta.get("duration", 0.0))
    if duration > 300.0:
        logger.info(f"Video is long ({duration:.1f}s) — skipping blocking shot detection to guarantee immediate stream start.")
        return []

    if meta.get("width", 0) == 0 or meta.get("codec") in ["unknown", "none"]:
        return []

    ffmpeg_exe = get_ffmpeg_path()
    
    # Scale down to 160x90 during scene detection: 10x faster and uses 95% less RAM!
    cmd = [
        ffmpeg_exe,
        "-i", video_path,
        "-filter:v", f"scale=160:90,select='gt(scene,{threshold})',showinfo",
        "-f", "null",
        "-"
    ]
    
    timestamps = []
    try:
        result = job_control.run_subprocess(cmd, timeout=600)
        
        # FFmpeg showinfo filter outputs to stderr
        for line in result.stderr.splitlines():
            if "showinfo" in line and "pts_time:" in line:
                parts = line.split()
                for p in parts:
                    if p.startswith("pts_time:"):
                        try:
                            ts = float(p.split(":")[1])
                            timestamps.append(ts)
                        except Exception:
                            pass
                            
        timestamps.sort()
        return timestamps
    except Exception as e:
        logger.error(f"Exception detecting shot changes: {e}")
        return []


def get_frame_rate(video_path: str) -> float:
    """Extract exact frame rate from video using FFprobe."""
    meta = get_video_metadata(video_path)
    fr = meta.get("frame_rate", 24.0)
    if fr <= 0:
        return 24.0
    return fr


def seconds_to_frames(seconds: float, frame_rate: float) -> int:
    """Convert seconds to frame count."""
    if seconds < 0:
        return 0
    return int(round(seconds * frame_rate))


def frames_to_seconds(frames: int, frame_rate: float) -> float:
    """Convert frame count to seconds."""
    if frames < 0:
        return 0.0
    if frame_rate <= 0:
        return 0.0
    return float(frames) / frame_rate


def generate_video_thumbnail(video_path: str, time_seconds: float, output_path: str = None) -> str:
    """Generate a thumbnail image at a specific timestamp."""
    if output_path is None:
        base_path = os.path.splitext(video_path)[0]
        output_path = f"{base_path}_thumb.jpg"
        
    ffmpeg_exe = get_ffmpeg_path()
    
    cmd = [
        ffmpeg_exe,
        "-ss", str(time_seconds),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        "-y",
        output_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and Path(output_path).exists():
            return output_path
        else:
            logger.error(f"FFmpeg thumbnail error: {result.stderr}")
    except Exception as e:
        logger.error(f"Error generating thumbnail: {e}")
        
    return ""


def get_supported_video_extensions() -> set:
    """Return set of supported video extensions."""
    return {'.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.wmv', '.flv'}


def get_supported_audio_extensions() -> set:
    """Return set of supported audio extensions."""
    return {'.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.opus'}


def get_supported_media_extensions() -> set:
    """Return union of supported video and audio extensions."""
    return get_supported_video_extensions() | get_supported_audio_extensions()


def validate_media_file(media_path: str) -> dict:
    """Check if file exists, has valid media extension, and has audio or video stream."""
    res = {
        "is_valid": False,
        "has_video": False,
        "has_audio": False,
        "is_audio_only": False,
        "error_message": "",
        "metadata": {}
    }
    
    if not Path(media_path).exists():
        res["error_message"] = "File does not exist."
        return res
        
    ext = Path(media_path).suffix.lower()
    if ext not in get_supported_media_extensions():
        res["error_message"] = f"Unsupported media format {ext}. Supported formats: {', '.join(sorted(get_supported_media_extensions()))}"
        return res
        
    meta = get_video_metadata(media_path)
    res["metadata"] = meta
    
    if meta.get("codec") != "unknown" and meta.get("width", 0) > 0:
        res["has_video"] = True
        
    if (meta.get("audio_codec") != "unknown" and meta.get("audio_channels", 0) > 0) or ext in get_supported_audio_extensions() or meta.get("duration", 0) > 0:
        res["has_audio"] = True
        
    if not res["has_video"] and not res["has_audio"]:
        res["error_message"] = "No valid video or audio stream found in media file."
        return res
        
    res["is_audio_only"] = not res["has_video"] and res["has_audio"]
    meta["is_audio"] = res["is_audio_only"]
    res["is_valid"] = True
    return res


def validate_video_file(video_path: str) -> dict:
    """Check media validity, supporting both video and audio files."""
    return validate_media_file(video_path)

