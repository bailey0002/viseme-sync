# Session Wrap: Vestis 3D Avatar Lip-Sync
**Date:** January 27, 2025

## What We Built Tonight

A 3D avatar with real-time lip-sync using Azure Speech Services and Oculus visemes.

---

## Live URL
**https://orange-meadow-0c39f6a0f.6.azurestaticapps.net**

---

## Repository
**https://github.com/bailey0002/viseme-sync**

Local: `/Volumes/STRATUM_EXT/VisemeSync`

---

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Main page with Grey Stratum "Vestis" styling |
| `viseme-mapper.js` | **NEW** - Maps Azure's 22 viseme IDs to 15 Oculus visemes |
| `azure-services-viseme.js` | **NEW** - Azure TTS with `redlips_front` SSML for viseme IDs |
| `avatar-renderer.js` | Three.js scene, model loading, enables morph targets on materials |
| `blendshape-mapper.js` | Original ARKit mapper (kept as fallback, not used) |
| `app.js` | Main app logic, uses `AzureServicesViseme` |
| `config.js` | Created by GitHub Actions from secrets (not in repo) |
| `assets/avatar.glb` | Avaturn T2 model with Oculus visemes |

---

## Azure Resources

| Resource | Value |
|----------|-------|
| Resource Group | `rg-viseme-sync` |
| Static Web App | `avatar-lipsync` |
| Region | `eastus2` |

---

## GitHub Secrets Required

```
AZURE_STATIC_WEB_APPS_API_TOKEN
AZURE_SPEECH_KEY
AZURE_SPEECH_REGION (eastus)
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_KEY
AZURE_OPENAI_DEPLOYMENT (Concordia-gpt-4o)
```

---

## Key Technical Discovery

**The Avaturn T2 model has Oculus visemes, not ARKit mouth shapes.**

- Azure's 55 ARKit blendshapes (`FacialExpression`) didn't work for mouth
- The model has `viseme_aa`, `viseme_PP`, `viseme_O`, etc. (15 Oculus visemes)
- Solution: Use Azure's Viseme IDs (0-21) via `redlips_front` SSML and map to Oculus visemes

**Critical fix:** Must enable `material.morphTargets = true` on all mesh materials after loading the model, or morph targets won't render.

---

## Viseme Mapping (Azure ID → Oculus)

```javascript
0: 'viseme_sil'    // Silence
1: 'viseme_aa'     // ae, ax, ah
2: 'viseme_aa'     // aa
3: 'viseme_O'      // ao
4: 'viseme_E'      // eh, uh
5: 'viseme_E'      // er
6: 'viseme_I'      // y, ih, iy
7: 'viseme_U'      // w, uw
8: 'viseme_O'      // ow
9: 'viseme_aa'     // aw
10: 'viseme_O'     // oy
11: 'viseme_aa'    // ay
12: 'viseme_RR'    // h
13: 'viseme_RR'    // r
14: 'viseme_nn'    // l
15: 'viseme_SS'    // s, z
16: 'viseme_CH'    // sh, ch, jh, zh
17: 'viseme_TH'    // th
18: 'viseme_FF'    // f, v
19: 'viseme_DD'    // d, t, n, th
20: 'viseme_kk'    // k, g, ng
21: 'viseme_PP'    // p, b, m
```

---

## What's Working
- ✅ Model loads and displays
- ✅ Grey Stratum styling applied
- ✅ Morph targets enabled on materials
- ✅ Oculus visemes respond (tested `viseme_aa` - mouth opens)
- ✅ Azure Viseme ID integration built
- ✅ Config injection via GitHub Actions

---

## Still To Test/Verify
- [ ] Full lip-sync during speech (needs credentials to auto-load)
- [ ] Camera angle (adjusted to 85% height, 0.8 distance)
- [ ] Model facing forward on initial load

---

## Console Test Commands

```javascript
// Check if config loaded
typeof CONFIG

// Test viseme manually (after model loads)
window.VisemeMapper.applyVisemeById(1, 1.0)  // Should open mouth (aa)
window.VisemeMapper.reset()  // Return to neutral

// Check mapped visemes
window.VisemeMapper.meshMappings
```

---

## To Resume Next Session

1. Refresh the deployed site and check if CONFIG loads (`typeof CONFIG`)
2. If credentials work, test full conversation flow
3. Fine-tune camera angle if needed
4. Verify lip-sync timing during speech

---

Good progress tonight! The hard part (figuring out Oculus visemes work, ARKit mouth shapes don't) is solved.
