/**
 * Oculus Viseme Mapper
 * Maps Azure Speech Viseme IDs (0-21) to Oculus/Avaturn viseme blendshapes
 * 
 * Now includes:
 * - Teeth mesh synchronization
 * - Underbite correction (jawForward dampening)
 */

const VisemeMapper = {
    // Azure Viseme ID to Oculus viseme name mapping
    AZURE_TO_OCULUS: {
        0: 'viseme_sil',    // Silence
        1: 'viseme_aa',     // æ, ə, ʌ
        2: 'viseme_aa',     // ɑ
        3: 'viseme_O',      // ɔ
        4: 'viseme_E',      // ɛ, ʊ
        5: 'viseme_E',      // ɝ
        6: 'viseme_I',      // j, ɪ, i
        7: 'viseme_U',      // w, ʊ
        8: 'viseme_O',      // oʊ
        9: 'viseme_aa',     // aʊ
        10: 'viseme_O',     // ɔɪ
        11: 'viseme_aa',    // aɪ
        12: 'viseme_RR',    // h
        13: 'viseme_RR',    // ɹ
        14: 'viseme_nn',    // l
        15: 'viseme_SS',    // s, z
        16: 'viseme_CH',    // ʃ, tʃ, dʒ, ʒ
        17: 'viseme_TH',    // ð
        18: 'viseme_FF',    // f, v
        19: 'viseme_DD',    // d, t, n, θ
        20: 'viseme_kk',    // k, g, ŋ
        21: 'viseme_PP',    // p, b, m
    },

    // All Oculus visemes
    OCULUS_VISEMES: [
        'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
        'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
        'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'
    ],

    // Jaw-related morph targets to sync
    JAW_TARGETS: ['jawOpen', 'jawForward', 'jawLeft', 'jawRight', 'mouthOpen'],

    // Correction settings
    corrections: {
        jawForwardDampen: 0.3,      // Reduce jawForward by 70% to fix underbite
        jawBackwardBias: 0.05,      // Slight backward bias on jaw
        teethSync: true             // Sync teeth with head
    },

    // Cache for mesh data
    meshMappings: new Map(),
    
    // Specific mesh references
    headMesh: null,
    teethMesh: null,
    tongueMesh: null,

    // Current state
    currentViseme: null,
    targetInfluences: {},

    /**
     * Initialize mapper with a loaded GLTF model
     */
    initialize(gltfScene) {
        this.meshMappings.clear();
        this.headMesh = null;
        this.teethMesh = null;
        this.tongueMesh = null;

        gltfScene.traverse((node) => {
            if (node.isMesh && node.morphTargetDictionary) {
                // Enable morph targets on material
                if (node.material) {
                    node.material.morphTargets = true;
                    node.material.morphNormals = true;
                    node.material.needsUpdate = true;
                }

                const dictionary = node.morphTargetDictionary;
                const visemeIndices = {};
                const jawIndices = {};

                // Find viseme indices
                this.OCULUS_VISEMES.forEach(visemeName => {
                    if (dictionary.hasOwnProperty(visemeName)) {
                        visemeIndices[visemeName] = dictionary[visemeName];
                    }
                });

                // Find jaw indices
                this.JAW_TARGETS.forEach(jawName => {
                    if (dictionary.hasOwnProperty(jawName)) {
                        jawIndices[jawName] = dictionary[jawName];
                    }
                });

                // Store mesh reference by name
                const nameLower = node.name.toLowerCase();
                if (nameLower.includes('head')) {
                    this.headMesh = node;
                    console.log('VisemeMapper: Found Head_Mesh');
                } else if (nameLower.includes('teeth')) {
                    this.teethMesh = node;
                    console.log('VisemeMapper: Found Teeth_Mesh');
                } else if (nameLower.includes('tongue')) {
                    this.tongueMesh = node;
                    console.log('VisemeMapper: Found Tongue_Mesh');
                }

                if (Object.keys(visemeIndices).length > 0 || Object.keys(jawIndices).length > 0) {
                    this.meshMappings.set(node, {
                        visemeIndices,
                        jawIndices,
                        influences: node.morphTargetInfluences
                    });
                    console.log(`VisemeMapper: ${node.name} - ${Object.keys(visemeIndices).length} visemes, ${Object.keys(jawIndices).length} jaw targets`);
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
     */
    applyViseme(visemeName, intensity = 1.0) {
        // Reset all visemes
        this.OCULUS_VISEMES.forEach(v => this.targetInfluences[v] = 0);
        
        // Set target viseme
        this.targetInfluences[visemeName] = intensity;

        // Apply to all meshes
        this._applyToMeshes();
        this.currentViseme = visemeName;
    },

    /**
     * Smoothly blend to a viseme
     */
    blendToViseme(visemeId, blendFactor = 0.3, intensity = 1.0) {
        const targetViseme = this.AZURE_TO_OCULUS[visemeId];
        if (!targetViseme) return;

        // Update target influences with blending
        this.OCULUS_VISEMES.forEach(v => {
            const target = (v === targetViseme) ? intensity : 0;
            this.targetInfluences[v] += (target - this.targetInfluences[v]) * blendFactor;
        });

        // Apply to all meshes
        this._applyToMeshes();
        this.currentViseme = targetViseme;
    },

    /**
     * Internal: Apply current influences to all meshes with corrections
     */
    _applyToMeshes() {
        this.meshMappings.forEach((meshData, mesh) => {
            const { visemeIndices, jawIndices, influences } = meshData;

            // Apply viseme influences
            this.OCULUS_VISEMES.forEach(v => {
                if (visemeIndices[v] !== undefined) {
                    influences[visemeIndices[v]] = this.targetInfluences[v];
                }
            });

            // Apply underbite correction: dampen jawForward
            if (jawIndices['jawForward'] !== undefined) {
                const currentValue = influences[jawIndices['jawForward']] || 0;
                influences[jawIndices['jawForward']] = currentValue * this.corrections.jawForwardDampen;
            }
        });

        // Sync teeth with head if enabled
        if (this.corrections.teethSync && this.headMesh && this.teethMesh) {
            this._syncTeethWithHead();
        }
    },

    /**
     * Sync teeth mesh morph targets with head mesh
     */
    _syncTeethWithHead() {
        const headData = this.meshMappings.get(this.headMesh);
        const teethData = this.meshMappings.get(this.teethMesh);

        if (!headData || !teethData) return;

        // Sync jaw targets
        this.JAW_TARGETS.forEach(jawName => {
            const headIdx = headData.jawIndices[jawName];
            const teethIdx = teethData.jawIndices[jawName];

            if (headIdx !== undefined && teethIdx !== undefined) {
                let value = headData.influences[headIdx];
                
                // Apply jawForward correction
                if (jawName === 'jawForward') {
                    value *= this.corrections.jawForwardDampen;
                }
                
                teethData.influences[teethIdx] = value;
            }
        });

        // Sync visemes on teeth
        this.OCULUS_VISEMES.forEach(v => {
            const headIdx = headData.visemeIndices[v];
            const teethIdx = teethData.visemeIndices[v];

            if (headIdx !== undefined && teethIdx !== undefined) {
                teethData.influences[teethIdx] = headData.influences[headIdx];
            }
        });
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
     * Smoothly return to neutral
     */
    blendToNeutral(blendFactor = 0.2) {
        this.OCULUS_VISEMES.forEach(v => {
            this.targetInfluences[v] *= (1 - blendFactor);
        });
        this._applyToMeshes();
    },

    /**
     * Adjust correction settings
     */
    setCorrectionSettings(settings) {
        Object.assign(this.corrections, settings);
        console.log('VisemeMapper corrections updated:', this.corrections);
    },

    /**
     * Get current state for debugging
     */
    getStats() {
        return {
            currentViseme: this.currentViseme,
            influences: { ...this.targetInfluences },
            corrections: { ...this.corrections },
            meshCount: this.meshMappings.size
        };
    }
};

// Make available globally
window.VisemeMapper = VisemeMapper;
