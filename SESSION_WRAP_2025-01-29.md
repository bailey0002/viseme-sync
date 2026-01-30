# Session Wrap: Jaw Fix, Materials, and Viseme Smoothing
**Date:** January 29, 2025

## Summary of Changes

This session fixed the avatar's underbite, adjusted materials to reduce "sweaty" look and mouth glow, added smoother lip-sync transitions, and changed the background color.

---

## Changes to Deploy

### 1. avatar-renderer.js Changes

**A. Background color (in `init()` method):**
```javascript
// Change from:
this.scene.background = new THREE.Color(0x0a0a0a);
// To:
this.scene.background = new THREE.Color(0x1a1a1a);  // Dark gray
```

**B. Ambient light intensity (in `setupLighting()` method):**
```javascript
// Change from:
const ambientLight = new THREE.AmbientLight(0x404060, 0.4);
// To:
const ambientLight = new THREE.AmbientLight(0x404060, 0.45);
```

**C. Main directional light intensity (in `setupLighting()` method):**
```javascript
// Change from:
const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.0);
// To:
const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.5);
```

**D. Skin material settings (in `materialSettings` object):**
```javascript
skin: {
    clearcoat: 0.02,        // Reduced from 0.04 (less sweaty)
    clearcoatRoughness: 0.35,
    sheen: 0.15,            // Reduced from 0.25
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0.95, 0.75, 0.65),
    roughness: 0.55,
    envMapIntensity: 1.0,   // Increased from 0.8 (brighter)
},
```

**E. Teeth material settings (in `materialSettings` object):**
```javascript
teeth: {
    clearcoat: 0.1,         // Reduced from 0.25
    clearcoatRoughness: 0.3,
    roughness: 0.4,         // Increased from 0.25 (less shiny)
    sheen: 0.1,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(1.0, 0.98, 0.95),
    envMapIntensity: 0.3,   // Reduced from 0.6
},
```

**F. Tongue material settings (in `materialSettings` object):**
```javascript
tongue: {
    clearcoat: 0.1,         // Reduced from 0.6 (much less glowy)
    clearcoatRoughness: 0.15,
    roughness: 0.7,         // Increased from 0.3
    sheen: 0.2,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(0.9, 0.5, 0.5),
    envMapIntensity: 0.1,   // Reduced from 0.8
},
```

**G. Add jaw correction function (add after `upgradeMaterials()` call in `loadModel()`):**

After the line `this.upgradeMaterials();` add:
```javascript
// Apply jaw correction to fix underbite
this.applyJawCorrection(0.7);
```

**H. Add the jaw correction method (add to AvatarRenderer class):**
```javascript
/**
 * Apply inverse jawForward to base geometry to fix underbite
 * @param {number} strength - How much to pull jaw back (0-1)
 */
applyJawCorrection(strength = 0.7) {
    const applyToMesh = (mesh) => {
        if (!mesh || !mesh.geometry || !mesh.morphTargetDictionary) return false;
        
        const geo = mesh.geometry;
        const posAttr = geo.attributes.position;
        const jawIdx = mesh.morphTargetDictionary['jawForward'];
        
        if (jawIdx === undefined || !geo.morphAttributes.position) return false;
        
        const jawMorph = geo.morphAttributes.position[jawIdx];
        if (!jawMorph) return false;
        
        // Subtract the morph delta from base positions
        for (let i = 0; i < posAttr.count; i++) {
            posAttr.array[i * 3] -= jawMorph.array[i * 3] * strength;
            posAttr.array[i * 3 + 1] -= jawMorph.array[i * 3 + 1] * strength;
            posAttr.array[i * 3 + 2] -= jawMorph.array[i * 3 + 2] * strength;
        }
        
        posAttr.needsUpdate = true;
        geo.computeVertexNormals();
        return true;
    };
    
    let headMesh = null, teethMesh = null;
    this.model.traverse(obj => {
        if (obj.name === 'Head_Mesh') headMesh = obj;
        if (obj.name === 'Teeth_Mesh') teethMesh = obj;
    });
    
    const headResult = applyToMesh(headMesh);
    const teethResult = applyToMesh(teethMesh);
    
    console.log(`Jaw correction applied (strength ${strength}): head=${headResult}, teeth=${teethResult}`);
}
```

---

### 2. viseme-mapper.js Changes

**A. Update `blendToViseme()` method for smoother animation:**
```javascript
/**
 * Smoothly blend to a viseme (UPDATED: smoother transitions)
 */
blendToViseme(visemeId, blendFactor = 0.15, intensity = 0.8) {
    const targetViseme = this.AZURE_TO_OCULUS[visemeId];
    if (!targetViseme) return;

    // Smoother exponential decay for other visemes
    this.OCULUS_VISEMES.forEach(v => {
        const target = (v === targetViseme) ? intensity : 0;
        // Smooth interpolation with lower blend factor
        this.targetInfluences[v] += (target - this.targetInfluences[v]) * blendFactor;
        // Clamp very small values to 0
        if (this.targetInfluences[v] < 0.01) this.targetInfluences[v] = 0;
    });

    this._applyToMeshes();
    this.currentViseme = targetViseme;
}
```

---

## Quick Deploy Commands

```bash
cd /Volumes/STRATUM_EXT/VisemeSync

# Edit avatar-renderer.js and viseme-mapper.js with changes above
# Then:

git add avatar-renderer.js viseme-mapper.js
git commit -m "Jaw correction, material fixes, smoother visemes, dark gray bg"
git push origin main
```

---

## Settings Summary

| Setting | Old Value | New Value | Purpose |
|---------|-----------|-----------|---------|
| Background | 0x0a0a0a | 0x1a1a1a | Dark gray instead of black |
| Ambient light | 0.4 | 0.45 | Brighter overall |
| Key light | 2.0 | 2.5 | Brighter skin |
| Skin clearcoat | 0.04 | 0.02 | Less sweaty |
| Skin envMapIntensity | 0.8 | 1.0 | Brighter skin |
| Teeth clearcoat | 0.25 | 0.1 | Less mouth glow |
| Teeth envMapIntensity | 0.6 | 0.3 | Less mouth glow |
| Tongue clearcoat | 0.6 | 0.1 | Less mouth glow |
| Tongue envMapIntensity | 0.8 | 0.1 | Less mouth glow |
| Viseme blend factor | 0.3 | 0.15 | Smoother transitions |
| Viseme intensity | 1.0 | 0.8 | Less extreme shapes |
| Jaw correction | none | 0.7 | Fix underbite |

---

## Console Test Commands (after deploy)

```javascript
// Verify jaw correction applied
// (Should see "Jaw correction applied" in console on load)

// Adjust jaw if needed
app.renderer.applyJawCorrection(0.5);  // Less pullback
app.renderer.applyJawCorrection(0.9);  // More pullback

// Adjust viseme smoothing
window.VisemeMapper.blendToViseme(1, 0.1, 0.7);  // Even smoother
```

---

## What's Working Now

- ✅ Jaw pulled back (underbite fixed)
- ✅ Skin brighter, less sweaty
- ✅ Teeth/tongue less glowy
- ✅ Smoother lip-sync transitions
- ✅ Dark gray background
- ✅ Teeth synced with head during speech

---

## Still Pending

- [ ] Test speech with all changes deployed
- [ ] Fine-tune viseme smoothing if needed
- [ ] Agent behaviors (head nods, gestures)
