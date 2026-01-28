# Audio2Face Integration Guide

## Overview

This guide covers upgrading VisemeSync from Azure Viseme IDs (discrete, 22 states) to NVIDIA Audio2Face (continuous ARKit blendshapes, 52 shapes at 30 FPS).

**Quality improvement:** Dramatically smoother lip-sync with emotion detection, coarticulation, and natural facial movement.

**Cost impact:** ~$4/month additional for GPU compute (10 hours R&D usage).

---

## Architecture

```
BEFORE (Azure Visemes):
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ Azure TTS   │───▶│ Viseme IDs   │───▶│ 15 Oculus   │
│             │    │ (0-21)       │    │ Visemes     │
└─────────────┘    └──────────────┘    └─────────────┘
                   Discrete snaps        Limited shapes

AFTER (Audio2Face):
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│ Azure TTS   │───▶│ A2F Server   │───▶│ WebSocket   │───▶│ 52 ARKit    │
│ (audio)     │    │ (GPU)        │    │ Stream      │    │ Blendshapes │
└─────────────┘    └──────────────┘    └─────────────┘    └─────────────┘
                   Neural inference     30 FPS             Full face
```

---

## Your T2 Model: Already Compatible ✅

Your Avaturn T2 GLB has **both** ARKit blendshapes AND Oculus visemes:

**Head_Mesh (72 morph targets):**
- ✅ All 52 ARKit blendshapes (jawOpen, mouthSmileLeft, eyeBlinkRight, etc.)
- ✅ 15 Oculus visemes (viseme_aa, viseme_PP, etc.) - current system
- ✅ Additional shapes (mouthOpen, mouthSmile, eyesClosed)

**No model changes needed.** Just wire up the new A2F client.

---

## Files Added

```
viseme-sync-main/
├── a2f-server/
│   ├── server.py          # FastAPI server for GPU instance
│   └── requirements.txt   # Python dependencies
├── audio2face-client.js   # Browser client (new)
└── ... existing files
```

---

## Setup Steps

### Step 1: GPU Server Setup (RunPod)

1. **Create RunPod Account:** https://runpod.io

2. **Launch Instance:**
   - Template: PyTorch or Ubuntu
   - GPU: L4 ($0.39/hr) or T4 ($0.20/hr)
   - Storage: 20GB minimum

3. **SSH into instance and setup:**

```bash
# Clone your repo or upload server files
cd ~
mkdir a2f-server && cd a2f-server

# Upload server.py and requirements.txt (or git clone)

# Install dependencies
pip install -r requirements.txt

# Start server
python server.py
```

4. **Note your public IP** (shown in RunPod dashboard)
   - Format: `http://xxx.xxx.xxx.xxx:8000`

5. **Test server:**
```bash
curl http://YOUR_IP:8000/health
# Should return: {"status": "healthy", ...}
```

### Step 2: Update Your App

**Option A: Dual-Mode (Recommended for Testing)**

Keep Azure visemes as fallback, add A2F as upgrade:

```html
<!-- index.html - add new script -->
<script src="audio2face-client.js"></script>
```

```javascript
// app.js - initialize both systems
class App {
    constructor() {
        // ... existing code ...
        
        // Add A2F client
        this.a2fClient = new Audio2FaceClient();
        this.useA2F = false;  // Toggle for testing
    }
    
    async init() {
        // ... existing init ...
        
        // Initialize A2F with scene
        if (this.renderer.scene) {
            this.a2fClient.initializeWithScene(this.renderer.scene);
        }
        
        // Configure A2F server (if available)
        const a2fUrl = localStorage.getItem('a2f_server_url');
        if (a2fUrl) {
            this.a2fClient.configure({ serverUrl: a2fUrl });
            const status = await this.a2fClient.checkConnection();
            if (status.connected) {
                this.useA2F = true;
                console.log('A2F server connected:', status);
            }
        }
    }
}
```

**Option B: Full Replacement**

Replace `azure-services-viseme.js` logic to use A2F for lip-sync.

See `azure-services-a2f.js` (create this based on existing + A2F client).

### Step 3: Connect to Server

Add to your UI or config:

```javascript
// Set A2F server URL
a2fClient.configure({
    serverUrl: 'http://YOUR_RUNPOD_IP:8000',
    intensity: 1.0,
    useWebSocket: true
});
```

### Step 4: Use A2F for Speech

Replace the viseme-based speech with A2F:

```javascript
async speak(text) {
    // Get audio from Azure TTS (without viseme callbacks)
    const audioBlob = await this.synthesizeAudio(text);
    
    // Create audio element for playback
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    
    // Process through A2F and animate
    await this.a2fClient.processAndAnimate(audioBlob, audio);
    
    URL.revokeObjectURL(audioUrl);
}
```

---

## Testing Without GPU

The A2F server has a **mock mode** that generates synthetic blendshapes.

1. Run server locally (no GPU needed):
```bash
cd a2f-server
pip install fastapi uvicorn numpy
python server.py
# Runs on http://localhost:8000
```

2. Configure client:
```javascript
a2fClient.configure({ serverUrl: 'http://localhost:8000' });
```

3. Test - you'll see mouth movement (synthetic, not real A2F quality)

---

## Cost Summary

| Component | Monthly Cost |
|-----------|--------------|
| Azure Speech (STT/TTS) | ~$18 |
| Azure OpenAI (GPT-4o) | ~$5 |
| **RunPod L4 (~10 hrs)** | **~$4** |
| Azure Static Web App | $0 |
| **Total** | **~$27** |

(vs. $23/month current without A2F)

---

## GPU Vendor Options

| Vendor | GPU | Price/hr | Notes |
|--------|-----|----------|-------|
| **RunPod** | L4 | $0.39 | Recommended, easy UI |
| **RunPod** | T4 | $0.20 | Budget option |
| Thunder | T4 | $0.29 | Cheapest |
| Lambda | A10 | $0.60 | More power |
| Vast.ai | 3090 | $0.15-0.25 | Variable quality |

---

## Workflow Summary

1. **User speaks** → Azure STT → text
2. **Text to GPT-4o** → response
3. **Response to Azure TTS** → audio blob
4. **Audio to A2F Server** → blendshape frames
5. **WebSocket streams** → browser applies to Three.js
6. **Audio plays** in sync with facial animation

---

## Troubleshooting

**Server not responding:**
- Check RunPod instance is running
- Check firewall allows port 8000
- Test with `curl http://IP:8000/health`

**WebSocket fails:**
- Browser may block mixed content (HTTPS page → HTTP WebSocket)
- Use `wss://` with SSL, or test on `http://localhost`

**Animation looks wrong:**
- Check `a2fClient.initializeWithScene()` was called
- Verify mesh has ARKit blendshapes (check console logs)
- Try increasing `intensity` setting

**High latency:**
- Use `useWebSocket: true` for streaming
- Check network between browser and GPU server
- Consider server location closer to you

---

## Next Steps

1. ✅ Verify T2 has ARKit blendshapes (done - confirmed)
2. 🔲 Set up RunPod account
3. 🔲 Deploy A2F server
4. 🔲 Test with mock mode locally
5. 🔲 Integrate A2F client into app
6. 🔲 Test full pipeline with GPU
7. 🔲 (Optional) Try Reallusion Character Creator for avatar upgrade
