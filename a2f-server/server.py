"""
Audio2Face Bridge Server
========================
Run on GPU instance (RunPod L4/T4, ~$0.40/hr)

This server:
1. Receives audio from your browser app
2. Processes it through NVIDIA Audio2Face
3. Streams back ARKit blendshape weights at 30 FPS

Installation (on RunPod):
    pip install fastapi uvicorn websockets python-multipart aiofiles numpy soundfile

For Audio2Face SDK (when available):
    pip install nvidia-audio2face  # or install from NVIDIA NGC

Usage:
    python server.py
    # Server runs on port 8000
    # Your app connects to ws://YOUR_GPU_IP:8000/ws/{session_id}
"""

import asyncio
import json
import uuid
import io
import time
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# Try to import Audio2Face SDK (may not be available yet)
try:
    # This import will change based on actual SDK release
    from audio2face import Audio2FaceInference
    A2F_AVAILABLE = True
except ImportError:
    A2F_AVAILABLE = False
    print("⚠️  Audio2Face SDK not found - running in MOCK mode")
    print("   Mock mode generates synthetic blendshape data for testing")

# ============================================================================
# Configuration
# ============================================================================

CONFIG = {
    "fps": 30,                    # Output frame rate
    "model": "james",             # A2F model: "james", "claire", or "mark"
    "emotion_strength": 0.6,      # How much emotion affects animation (0-1)
    "smoothing": 0.3,             # Temporal smoothing factor
}

# Standard ARKit blendshape names (52 shapes)
ARKIT_BLENDSHAPES = [
    # Eye
    "eyeBlinkLeft", "eyeBlinkRight",
    "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
    "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
    "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
    # Brow
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    # Cheek
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    # Nose
    "noseSneerLeft", "noseSneerRight",
    # Jaw
    "jawForward", "jawLeft", "jawRight", "jawOpen",
    # Mouth
    "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
    "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
    "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthUpperUpLeft", "mouthUpperUpRight",
    # Tongue
    "tongueOut",
]

# ============================================================================
# Data Classes
# ============================================================================

@dataclass
class BlendshapeFrame:
    """Single frame of blendshape animation"""
    frame: int
    timestamp: float  # seconds from start
    blendshapes: Dict[str, float]


@dataclass 
class ProcessingSession:
    """Tracks an audio processing session"""
    session_id: str
    created_at: float
    frames: List[BlendshapeFrame]
    is_complete: bool = False
    error: Optional[str] = None


# ============================================================================
# Audio2Face Processor
# ============================================================================

class Audio2FaceProcessor:
    """
    Wrapper for Audio2Face inference.
    Falls back to mock mode if SDK not available.
    """
    
    def __init__(self):
        self.model = None
        self.fps = CONFIG["fps"]
        self.is_ready = False
        
    def initialize(self):
        """Load A2F model (call once at startup)"""
        if A2F_AVAILABLE:
            try:
                # Real SDK initialization
                # Note: Actual API may differ - adjust when SDK is released
                self.model = Audio2FaceInference(
                    model_name=CONFIG["model"],
                    emotion_strength=CONFIG["emotion_strength"]
                )
                self.model.load()
                self.is_ready = True
                print(f"✓ Audio2Face model '{CONFIG['model']}' loaded")
            except Exception as e:
                print(f"✗ Failed to load Audio2Face: {e}")
                self.is_ready = False
        else:
            # Mock mode
            self.is_ready = True
            print("✓ Running in mock mode (synthetic blendshapes)")
    
    def process_audio(self, audio_bytes: bytes, sample_rate: int = 16000) -> List[BlendshapeFrame]:
        """
        Process audio and return list of blendshape frames.
        
        Args:
            audio_bytes: Raw audio data (WAV or MP3)
            sample_rate: Audio sample rate
            
        Returns:
            List of BlendshapeFrame objects at 30 FPS
        """
        if A2F_AVAILABLE and self.model:
            return self._process_real(audio_bytes, sample_rate)
        else:
            return self._process_mock(audio_bytes, sample_rate)
    
    def _process_real(self, audio_bytes: bytes, sample_rate: int) -> List[BlendshapeFrame]:
        """Process with real Audio2Face SDK"""
        import soundfile as sf
        
        # Decode audio
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))
        
        # Resample if needed
        if sr != sample_rate:
            import librosa
            audio_data = librosa.resample(audio_data, orig_sr=sr, target_sr=sample_rate)
        
        # Run A2F inference
        # Output: numpy array of shape (num_frames, 52)
        raw_output = self.model.predict(
            audio_data,
            sample_rate=sample_rate,
            fps=self.fps
        )
        
        # Convert to BlendshapeFrame objects
        frames = []
        for i, weights in enumerate(raw_output):
            frame = BlendshapeFrame(
                frame=i,
                timestamp=i / self.fps,
                blendshapes={
                    name: float(np.clip(weights[j], 0, 1))
                    for j, name in enumerate(ARKIT_BLENDSHAPES)
                }
            )
            frames.append(frame)
        
        return frames
    
    def _process_mock(self, audio_bytes: bytes, sample_rate: int) -> List[BlendshapeFrame]:
        """
        Generate mock blendshape data for testing.
        Creates realistic-looking animation based on audio energy.
        """
        # Estimate audio duration
        # Rough estimate: 16kHz, 16-bit mono = 32 bytes/ms
        duration_sec = len(audio_bytes) / 32000
        num_frames = max(int(duration_sec * self.fps), 30)  # At least 1 second
        
        print(f"Mock processing: ~{duration_sec:.1f}s audio -> {num_frames} frames")
        
        frames = []
        for i in range(num_frames):
            t = i / self.fps
            
            # Generate speech-like mouth movements
            # Multiple frequencies simulate natural speech patterns
            jaw_open = 0.25 + 0.15 * np.sin(t * 12) + 0.1 * np.sin(t * 7.3)
            jaw_open = np.clip(jaw_open + np.random.normal(0, 0.03), 0, 0.6)
            
            mouth_close = 0.1 + 0.1 * np.sin(t * 15 + 0.5)
            mouth_funnel = 0.1 + 0.08 * np.sin(t * 8 + 1.2)
            mouth_pucker = 0.05 + 0.05 * np.sin(t * 6 + 2.1)
            
            # Lip movements
            mouth_smile_l = 0.1 + 0.05 * np.sin(t * 3)
            mouth_smile_r = 0.1 + 0.05 * np.sin(t * 3 + 0.1)
            
            # Upper/lower lip
            mouth_upper_up_l = 0.1 + 0.08 * np.sin(t * 10)
            mouth_upper_up_r = 0.1 + 0.08 * np.sin(t * 10 + 0.1)
            mouth_lower_down_l = 0.15 + 0.1 * np.sin(t * 11)
            mouth_lower_down_r = 0.15 + 0.1 * np.sin(t * 11 + 0.1)
            
            # Subtle brow movement (emotion)
            brow_inner_up = 0.1 + 0.05 * np.sin(t * 0.5)
            
            # Occasional blinks
            blink = 1.0 if (i % 90 < 3) else 0.0  # Blink every ~3 seconds
            
            blendshapes = {name: 0.0 for name in ARKIT_BLENDSHAPES}
            
            # Apply calculated values
            blendshapes["jawOpen"] = float(np.clip(jaw_open, 0, 1))
            blendshapes["mouthClose"] = float(np.clip(mouth_close, 0, 1))
            blendshapes["mouthFunnel"] = float(np.clip(mouth_funnel, 0, 1))
            blendshapes["mouthPucker"] = float(np.clip(mouth_pucker, 0, 1))
            blendshapes["mouthSmileLeft"] = float(np.clip(mouth_smile_l, 0, 1))
            blendshapes["mouthSmileRight"] = float(np.clip(mouth_smile_r, 0, 1))
            blendshapes["mouthUpperUpLeft"] = float(np.clip(mouth_upper_up_l, 0, 1))
            blendshapes["mouthUpperUpRight"] = float(np.clip(mouth_upper_up_r, 0, 1))
            blendshapes["mouthLowerDownLeft"] = float(np.clip(mouth_lower_down_l, 0, 1))
            blendshapes["mouthLowerDownRight"] = float(np.clip(mouth_lower_down_r, 0, 1))
            blendshapes["browInnerUp"] = float(np.clip(brow_inner_up, 0, 1))
            blendshapes["eyeBlinkLeft"] = blink
            blendshapes["eyeBlinkRight"] = blink
            
            frames.append(BlendshapeFrame(
                frame=i,
                timestamp=t,
                blendshapes=blendshapes
            ))
        
        return frames


# ============================================================================
# FastAPI Application
# ============================================================================

app = FastAPI(
    title="Audio2Face Bridge",
    description="Converts audio to ARKit blendshapes for 3D avatar lip-sync",
    version="1.0.0"
)

# CORS - allow browser connections
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global processor instance
processor = Audio2FaceProcessor()

# Active sessions
sessions: Dict[str, ProcessingSession] = {}

# Active WebSocket connections
connections: Dict[str, WebSocket] = {}


@app.on_event("startup")
async def startup():
    """Initialize A2F on server start"""
    processor.initialize()


@app.get("/")
async def root():
    """Health check"""
    return {
        "status": "ok",
        "a2f_available": A2F_AVAILABLE,
        "mode": "real" if A2F_AVAILABLE else "mock",
        "fps": CONFIG["fps"]
    }


@app.get("/health")
async def health():
    """Detailed health check"""
    return {
        "status": "healthy",
        "processor_ready": processor.is_ready,
        "active_sessions": len(sessions),
        "active_connections": len(connections),
        "config": CONFIG
    }


@app.post("/process")
async def process_audio(audio: UploadFile = File(...)):
    """
    Process audio file and return session ID.
    Client then connects via WebSocket to receive frames.
    
    Accepts: WAV, MP3, OGG, or raw PCM audio
    Returns: { session_id, frame_count, duration_sec }
    """
    session_id = str(uuid.uuid4())[:8]
    
    try:
        # Read audio data
        audio_bytes = await audio.read()
        
        if len(audio_bytes) < 1000:
            raise HTTPException(status_code=400, detail="Audio file too small")
        
        print(f"[{session_id}] Processing {len(audio_bytes)} bytes...")
        
        # Process through A2F
        start_time = time.time()
        frames = processor.process_audio(audio_bytes)
        process_time = time.time() - start_time
        
        print(f"[{session_id}] Generated {len(frames)} frames in {process_time:.2f}s")
        
        # Store session
        sessions[session_id] = ProcessingSession(
            session_id=session_id,
            created_at=time.time(),
            frames=frames,
            is_complete=True
        )
        
        # Calculate duration
        duration = frames[-1].timestamp if frames else 0
        
        return {
            "session_id": session_id,
            "frame_count": len(frames),
            "duration_sec": round(duration, 2),
            "fps": CONFIG["fps"],
            "process_time_sec": round(process_time, 2)
        }
        
    except Exception as e:
        print(f"[{session_id}] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/{session_id}")
async def websocket_stream(websocket: WebSocket, session_id: str):
    """
    Stream blendshape frames for a processed session.
    
    Frames are sent at real-time rate (30 FPS) to sync with audio playback.
    
    Messages sent:
        {"type": "frame", "data": {...}}  - Blendshape frame
        {"type": "complete"}               - All frames sent
        {"type": "error", "message": ...}  - Error occurred
    """
    await websocket.accept()
    connections[session_id] = websocket
    
    try:
        # Wait for session to be ready (if processing is async)
        wait_start = time.time()
        while session_id not in sessions:
            if time.time() - wait_start > 10:
                await websocket.send_json({"type": "error", "message": "Session not found"})
                return
            await asyncio.sleep(0.1)
        
        session = sessions[session_id]
        
        if session.error:
            await websocket.send_json({"type": "error", "message": session.error})
            return
        
        # Wait for client to signal "start" (sync with audio playback)
        print(f"[{session_id}] WebSocket connected, waiting for start signal...")
        
        try:
            msg = await asyncio.wait_for(websocket.receive_json(), timeout=30)
            if msg.get("action") != "start":
                await websocket.send_json({"type": "error", "message": "Expected start signal"})
                return
        except asyncio.TimeoutError:
            await websocket.send_json({"type": "error", "message": "Timeout waiting for start"})
            return
        
        print(f"[{session_id}] Starting frame stream ({len(session.frames)} frames)...")
        
        # Stream frames at real-time rate
        frame_interval = 1.0 / CONFIG["fps"]
        stream_start = time.time()
        
        for frame in session.frames:
            # Calculate when this frame should be sent
            target_time = stream_start + frame.timestamp
            now = time.time()
            
            # Wait if we're ahead of schedule
            if target_time > now:
                await asyncio.sleep(target_time - now)
            
            # Send frame
            await websocket.send_json({
                "type": "frame",
                "data": asdict(frame)
            })
        
        # Signal completion
        await websocket.send_json({"type": "complete"})
        print(f"[{session_id}] Stream complete")
        
    except WebSocketDisconnect:
        print(f"[{session_id}] Client disconnected")
    except Exception as e:
        print(f"[{session_id}] WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
    finally:
        connections.pop(session_id, None)
        # Clean up old session after a delay
        asyncio.create_task(cleanup_session(session_id, delay=60))


async def cleanup_session(session_id: str, delay: int):
    """Remove session after delay"""
    await asyncio.sleep(delay)
    sessions.pop(session_id, None)


# ============================================================================
# Alternative: Synchronous endpoint (returns all frames at once)
# ============================================================================

@app.post("/process-sync")
async def process_audio_sync(audio: UploadFile = File(...)):
    """
    Process audio and return all frames immediately.
    Use this for simpler integration (no WebSocket needed).
    
    Returns all frames in one response - client handles timing.
    """
    try:
        audio_bytes = await audio.read()
        
        if len(audio_bytes) < 1000:
            raise HTTPException(status_code=400, detail="Audio file too small")
        
        # Process
        frames = processor.process_audio(audio_bytes)
        
        return {
            "fps": CONFIG["fps"],
            "frame_count": len(frames),
            "frames": [asdict(f) for f in frames]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    print("\n" + "="*60)
    print("Audio2Face Bridge Server")
    print("="*60)
    print(f"Mode: {'Real A2F' if A2F_AVAILABLE else 'Mock (testing)'}")
    print(f"FPS: {CONFIG['fps']}")
    print(f"Model: {CONFIG['model']}")
    print("="*60 + "\n")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
