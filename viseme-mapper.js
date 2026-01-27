/**
 * Oculus Viseme Mapper
 * Maps Azure Speech Viseme IDs (0-21) to Oculus/Avaturn viseme blendshapes
 * 
 * This is simpler and more reliable than the 55-value ARKit approach
 * because Avaturn T2 models have Oculus visemes built in.
 */

const VisemeMapper = {
    // Azure Viseme ID to Oculus viseme name mapping
    // Reference: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
    AZURE_TO_OCULUS: {
        0: 'viseme_sil',   // Silence
        1: 'viseme_aa',    // æ, ə, ʌ (ae, ax, ah)
        2: 'viseme_aa',    // ɑ (aa)
        3: 'viseme_O',     // ɔ (ao)
        4: 'viseme_E',     // ɛ, ʊ (eh, uh)
        5: 'viseme_E',     // ɝ (er)
        6: 'viseme_I',     // j, ɪ, i (y, ih, iy)
        7: 'viseme_U',     // w, ʊ (w, uw)
        8: 'viseme_O',     // oʊ (ow)
        9: 'viseme_aa',    // aʊ (aw)
        10: 'viseme_O',    // ɔɪ (oy)
        11: 'viseme_aa',   // aɪ (ay)
        12: 'viseme_RR',   // h (h)
        13: 'viseme_RR',   // ɹ (r)
        14: 'viseme_nn',   // l (l)
        15: 'viseme_SS',   // s, z (s, z)
        16: 'viseme_CH',   // ʃ, tʃ, dʒ, ʒ (sh, ch, jh, zh)
        17: 'viseme_TH',   // ð (th)
        18: 'viseme_FF',   // f, v (f, v)
        19: 'viseme_DD',   // d, t, n, θ (d, t, n, th)
        20: 'viseme_kk',   // k, g, ŋ (k, g, ng)
        21: 'viseme_PP',   // p, b, m (p, b, m)
    },

    // All Oculus visemes for reference
    OCULUS_VISEMES: [
        'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
        'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
        'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'
    ],

    // Cache for mesh data
    meshMappings: new Map(),
    
    // Current viseme state for smooth blending
    currentViseme: null,
    targetInfluences: {},

    /**
     * Initialize mapper with a loaded GLTF model
     */
    initialize(gltfScene) {
        this.meshMappings.clear();
        
        gltfScene.traverse((node) => {
            if (node.isMesh && node.morphTargetDictionary) {
                // Enable morph targets on material
                node.material.morphTargets = true;
                node.material.morphNormals = true;
                node.material.needsUpdate = true;
                
                const visemeIndices = {};
                const dictionary = node.morphTargetDictionary;
                
                // Find indices for each Oculus viseme
                this.OCULUS_VISEMES.forEach(visemeName => {
                    if (dictionary.hasOwnProperty(visemeName)) {
                        visemeIndices[visemeName] = dictionary[visemeName];
                    }
                });
                
                if (Object.keys(visemeIndices).length > 0) {
                    this.meshMappings.set(node, {
                        visemeIndices: visemeIndices,
                        influences: node.morphTargetInfluences
                    });
                    console.log(`VisemeMapper: Found ${Object.keys(visemeIndices).length} visemes in ${node.name}`);
                }
            }
        });
        
        // Initialize target influences
        this.OCULUS_VISEMES.forEach(v => this.targetInfluences[v] = 0);
        
        console.log(`VisemeMapper initialized with ${this.meshMappings.size} meshes`);
        return this.meshMappings.size > 0;
    },

    /**
     * Apply a viseme by Azure ID (0-21)
     * @param {number} visemeId - Azure viseme ID
     * @param {number} [intensity=1.0] - Intensity multiplier
     */
    applyVisemeById(visemeId, intensity = 1.0) {
        const visemeName = this.AZURE_TO_OCULUS[visemeId];
        if (!visemeName) {
            console.warn('Unknown viseme ID:', visemeId);
            return;
        }
        
        this.applyViseme(visemeName, intensity);
    },

    /**
     * Apply a viseme by name
     * @param {string} visemeName - Oculus viseme name (e.g., 'viseme_aa')
     * @param {number} [intensity=1.0] - Intensity multiplier
     */
    applyViseme(visemeName, intensity = 1.0) {
        // Reset all visemes first
        this.OCULUS_VISEMES.forEach(v => this.targetInfluences[v] = 0);
        
        // Set target viseme
        this.targetInfluences[visemeName] = intensity;
        
        // Apply to all meshes
        this.meshMappings.forEach((meshData) => {
            const { visemeIndices, influences } = meshData;
            
            this.OCULUS_VISEMES.forEach(v => {
                if (visemeIndices[v] !== undefined) {
                    influences[visemeIndices[v]] = this.targetInfluences[v];
                }
            });
        });
        
        this.currentViseme = visemeName;
    },

    /**
     * Smoothly blend to a viseme (for smoother animation)
     * @param {number} visemeId - Azure viseme ID
     * @param {number} blendFactor - How much to blend (0-1), higher = faster
     * @param {number} [intensity=1.0] - Intensity multiplier
     */
    blendToViseme(visemeId, blendFactor = 0.3, intensity = 1.0) {
        const targetViseme = this.AZURE_TO_OCULUS[visemeId];
        if (!targetViseme) return;
        
        // Update target influences
        this.OCULUS_VISEMES.forEach(v => {
            const target = (v === targetViseme) ? intensity : 0;
            this.targetInfluences[v] += (target - this.targetInfluences[v]) * blendFactor;
        });
        
        // Apply blended values to all meshes
        this.meshMappings.forEach((meshData) => {
            const { visemeIndices, influences } = meshData;
            
            this.OCULUS_VISEMES.forEach(v => {
                if (visemeIndices[v] !== undefined) {
                    influences[visemeIndices[v]] = this.targetInfluences[v];
                }
            });
        });
        
        this.currentViseme = targetViseme;
    },

    /**
     * Reset all visemes to neutral
     */
    reset() {
        this.OCULUS_VISEMES.forEach(v => this.targetInfluences[v] = 0);
        
        this.meshMappings.forEach((meshData) => {
            const { visemeIndices, influences } = meshData;
            
            this.OCULUS_VISEMES.forEach(v => {
                if (visemeIndices[v] !== undefined) {
                    influences[visemeIndices[v]] = 0;
                }
            });
        });
        
        this.currentViseme = null;
    },

    /**
     * Smoothly return to neutral over time
     * @param {number} blendFactor - How much to blend toward neutral (0-1)
     */
    blendToNeutral(blendFactor = 0.2) {
        this.OCULUS_VISEMES.forEach(v => {
            this.targetInfluences[v] *= (1 - blendFactor);
        });
        
        this.meshMappings.forEach((meshData) => {
            const { visemeIndices, influences } = meshData;
            
            this.OCULUS_VISEMES.forEach(v => {
                if (visemeIndices[v] !== undefined) {
                    influences[visemeIndices[v]] = this.targetInfluences[v];
                }
            });
        });
    },

    /**
     * Get current state for debugging
     */
    getStats() {
        return {
            currentViseme: this.currentViseme,
            influences: { ...this.targetInfluences }
        };
    }
};

// Make available globally
window.VisemeMapper = VisemeMapper;
