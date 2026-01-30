# Session Wrap: Multi-Avatar Support + Extended Voice Options
**Date:** January 30, 2025

## Summary of Changes

Added support for multiple avatar models with a toggle in the UI, plus expanded voice options with more male and female voices. Built on top of the iOS audio fix update.

**Update 2:** Added relaxed pose and procedural idle movement for non-animated models (Ava).

---

## Live URL
**https://orange-meadow-0c39f6a0f.6.azurestaticapps.net**

---

## Repository
**https://github.com/bailey0002/viseme-sync**

Local: `/Volumes/STRATUM_EXT/VisemeSync`

---

## New Features

### 1. Avatar Model Selector
- New "AVATAR" panel in the UI (top of settings panels)
- Toggle between Marcus (Male) and Ava (Female) models
- Loading indicator while switching models
- Auto re-initializes A2F client when model changes

### 2. Auto Voice Matching
- When switching avatars, voice automatically changes to match gender
- Male avatar → Andrew (default male voice)
- Female avatar → Ava (default female voice)
- Can still manually override voice selection

### 3. Expanded Voice Options
Now includes 14 voices organized by gender:

**Male Voices:**
- Andrew (Natural) - `en-US-AndrewMultilingualNeural`
- Brian (Clear) - `en-US-BrianMultilingualNeural`
- Guy (Deep) - `en-US-GuyNeural`
- Davis (Warm) - `en-US-DavisNeural`
- Jason (Conversational) - `en-US-JasonNeural`
- Tony (Casual) - `en-US-TonyNeural`

**Female Voices:**
- Ava (Expressive) - `en-US-AvaMultilingualNeural`
- Emma (Friendly) - `en-US-EmmaMultilingualNeural`
- Jenny (Professional) - `en-US-JennyNeural`
- Aria (Natural) - `en-US-AriaNeural`
- Sara (Cheerful) - `en-US-SaraNeural`
- Michelle (Warm) - `en-US-MichelleNeural`
- Nancy (Mature) - `en-US-NancyNeural`
- Jane (Articulate) - `en-US-JaneNeural`

### 4. Relaxed Pose for Non-Animated Models (NEW)
For models like Ava that don't have embedded idle animation:
- **Relaxed arm position** - shoulders dropped, arms at sides with slight bend
- **Natural posture** - slight forward lean, engaged head position
- **Procedural idle movement** - subtle breathing, micro-sway, head movement
- Automatically applied when model has no embedded animation

---

## iOS Fixes Already Included

This update is based on the latest codebase which includes:
- iOS audio unlock overlay ("TAP TO BEGIN")
- Safari Web Audio API fixes
- ES Module Shims for older Safari versions
- Safe area insets for notched devices
- Touch event optimizations

---

## Files Changed

| File | Changes |
|------|---------|
| `index.html` | Added AVATAR panel with model selector, expanded voice options with optgroup labels, model change handler with auto voice switching |
| `avatar-renderer.js` | Added `applyRelaxedPose()`, `startIdleMovement()`, `stopIdleMovement()` for non-animated models; improved model switching cleanup |
| `assets/avatar_female.glb` | **NEW** - Female avatar model (Ava) |

---

## Relaxed Pose Details

When a model without animation is loaded (like Ava), these adjustments are applied:

**Shoulders:**
- Dropped down and slightly forward

**Arms:**
- Relaxed at sides with slight bend at elbows
- Natural hand positioning

**Spine:**
- Very slight forward lean for approachable posture

**Head:**
- Subtle tilt suggesting engagement

**Procedural Idle Movement:**
- Breathing cycle (~4 seconds) - gentle spine movement
- Sway cycle (~8 seconds) - subtle shoulder motion  
- Head movement (~12 seconds) - micro-adjustments

---

## Model Files

| File | Description |
|------|-------------|
| `assets/avatar.glb` | Marcus (Male) - has embedded idle animation |
| `assets/avatar_female.glb` | Ava (Female) - procedural animation applied |

Both models are Avaturn T2 exports with:
- 72 morph targets on Head_Mesh (15 Oculus visemes + 52 ARKit)
- Compatible with both Azure Visemes and Audio2Face lip-sync

---

## Deploy Commands

```bash
cd /Volumes/STRATUM_EXT/VisemeSync

# Copy the updated files (download from outputs)
# - index.html
# - avatar-renderer.js
# - assets/avatar_female.glb

# Commit and push
git add .
git commit -m "Add relaxed pose and idle movement for non-animated avatars"
git push origin main
```

---

## Console Test Commands

```javascript
// Switch model programmatically
document.getElementById('model-select').value = 'assets/avatar_female.glb';
document.getElementById('model-select').dispatchEvent(new Event('change'));

// Check if idle movement is running
window.app.renderer.idleAnimationFrame  // Should be a number if running

// Manually apply relaxed pose
window.app.renderer.applyRelaxedPose();

// Check bone positions
window.app.renderer.bones.LeftArm.rotation
```

---

## Notes

- Both models use the same Oculus viseme set, so lip-sync works identically
- Ava now has procedural idle movement that mimics Marcus's embedded animation
- Expression system (blinking, micro-expressions) works on both models
- Switching models properly cleans up previous animation/idle states

---

## Next Steps

- [ ] Fine-tune idle movement parameters if needed
- [ ] Consider adding more avatar options
- [ ] Test A2F with female model
- [ ] Add avatar preview thumbnails in selector
