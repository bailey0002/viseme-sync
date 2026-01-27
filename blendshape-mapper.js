/**
 * BlendShape Mapper
 * Maps Azure Speech 3D BlendShapes (55 values) to Avaturn T2 model morph targets
 * 
 * Azure outputs 55 facial positions per frame at 60fps in ARKit format.
 * The Avaturn T2 model has these blendshapes distributed across multiple meshes.
 */

const BlendShapeMapper = {
    // Azure's 55 BlendShape indices in order (ARKit standard)
    // Reference: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
    AZURE_BLENDSHAPES: [
        'eyeBlinkLeft',           // 0
        'eyeLookDownLeft',        // 1
        'eyeLookInLeft',          // 2
        'eyeLookOutLeft',         // 3
        'eyeLookUpLeft',          // 4
        'eyeSquintLeft',          // 5
        'eyeWideLeft',            // 6
        'eyeBlinkRight',          // 7
        'eyeLookDownRight',       // 8
        'eyeLookInRight',         // 9
        'eyeLookOutRight',        // 10
        'eyeLookUpRight',         // 11
        'eyeSquintRight',         // 12
        'eyeWideRight',           // 13
        'jawForward',             // 14
        'jawLeft',                // 15
        'jawRight',               // 16
        'jawOpen',                // 17
        'mouthClose',             // 18
        'mouthFunnel',            // 19
        'mouthPucker',            // 20
        'mouthLeft',              // 21
        'mouthRight',             // 22
        'mouthSmileLeft',         // 23
        'mouthSmileRight',        // 24
        'mouthFrownLeft',         // 25
        'mouthFrownRight',        // 26
        'mouthDimpleLeft',        // 27
        'mouthDimpleRight',       // 28
        'mouthStretchLeft',       // 29
        'mouthStretchRight',      // 30
        'mouthRollLower',         // 31
        'mouthRollUpper',         // 32
        'mouthShrugLower',        // 33
        'mouthShrugUpper',        // 34
        'mouthPressLeft',         // 35
        'mouthPressRight',        // 36
        'mouthLowerDownLeft',     // 37
        'mouthLowerDownRight',    // 38
        'mouthUpperUpLeft',       // 39
        'mouthUpperUpRight',      // 40
        'browDownLeft',           // 41
        'browDownRight',          // 42
        'browInnerUp',            // 43
        'browOuterUpLeft',        // 44
        'browOuterUpRight',       // 45
        'cheekPuff',              // 46
        'cheekSquintLeft',        // 47
        'cheekSquintRight',       // 48
        'noseSneerLeft',          // 49
        'noseSneerRight',         // 50
        'tongueOut',              // 51
        'headRoll',               // 52 - Not typically a blendshape, handled by bone
        'leftEyeRoll',            // 53 - Not typically a blendshape, handled by bone
        'rightEyeRoll'            // 54 - Not typically a blendshape, handled by bone
    ],

    // Indices that are actually blendshapes (not bone rotations)
    VALID_BLENDSHAPE_INDICES: Array.from({length: 52}, (_, i) => i), // 0-51

    // Cache for mesh morph target mappings
    meshMappings: new Map(),

    /**
     * Initialize mapper with a loaded GLTF model
     * Scans all meshes and builds index mappings for their morph targets
     */
    initialize(gltfScene) {
        this.meshMappings.clear();
        
        gltfScene.traverse((node) => {
            if (node.isMesh && node.morphTargetDictionary) {
                const mapping = {};
                const dictionary = node.morphTargetDictionary;
                
                // For each Azure blendshape, find the corresponding index in this mesh
                this.AZURE_BLENDSHAPES.forEach((shapeName, azureIndex) => {
                    if (dictionary.hasOwnProperty(shapeName)) {
                        mapping[azureIndex] = dictionary[shapeName];
                    }
                });
                
                if (Object.keys(mapping).length > 0) {
                    this.meshMappings.set(node, {
                        mapping: mapping,
                        influences: node.morphTargetInfluences
                    });
                    console.log(`Mapped ${Object.keys(mapping).length} blendshapes for mesh: ${node.name}`);
                }
            }
        });
        
        console.log(`BlendShapeMapper initialized with ${this.meshMappings.size} meshes`);
        return this.meshMappings.size > 0;
    },

    /**
     * Apply a frame of Azure blendshape values to the model
     * @param {number[]} values - Array of 55 float values (0.0 to 1.0, may include negatives)
     * @param {number} [intensity=1.0] - Overall intensity multiplier
     */
    applyFrame(values, intensity = 1.0) {
        if (!values || values.length < 52) {
            console.warn('Invalid blendshape frame data');
            return;
        }

        this.meshMappings.forEach((meshData, mesh) => {
            const { mapping, influences } = meshData;
            
            for (const [azureIndex, meshIndex] of Object.entries(mapping)) {
                const idx = parseInt(azureIndex);
                if (idx < values.length) {
                    // Azure can output negative values - clamp to 0-1 range
                    // Apply intensity multiplier
                    let value = values[idx] * intensity;
                    value = Math.max(0, Math.min(1, value));
                    influences[meshIndex] = value;
                }
            }
        });
    },

    /**
     * Reset all blendshapes to neutral (0)
     */
    reset() {
        this.meshMappings.forEach((meshData) => {
            const { influences } = meshData;
            for (let i = 0; i < influences.length; i++) {
                influences[i] = 0;
            }
        });
    },

    /**
     * Smoothly interpolate from current values to target values
     * @param {number[]} targetValues - Target blendshape values
     * @param {number} t - Interpolation factor (0-1)
     * @param {number} [intensity=1.0] - Overall intensity multiplier
     */
    lerpToFrame(targetValues, t, intensity = 1.0) {
        if (!targetValues || targetValues.length < 52) return;

        this.meshMappings.forEach((meshData) => {
            const { mapping, influences } = meshData;
            
            for (const [azureIndex, meshIndex] of Object.entries(mapping)) {
                const idx = parseInt(azureIndex);
                if (idx < targetValues.length) {
                    let targetValue = targetValues[idx] * intensity;
                    targetValue = Math.max(0, Math.min(1, targetValue));
                    
                    // Lerp from current to target
                    const current = influences[meshIndex];
                    influences[meshIndex] = current + (targetValue - current) * t;
                }
            }
        });
    },

    /**
     * Get statistics about current blendshape state
     */
    getStats() {
        let totalActive = 0;
        let maxValue = 0;
        let activeName = '';

        this.meshMappings.forEach((meshData, mesh) => {
            const { mapping, influences } = meshData;
            
            for (const [azureIndex, meshIndex] of Object.entries(mapping)) {
                const value = influences[meshIndex];
                if (value > 0.01) {
                    totalActive++;
                    if (value > maxValue) {
                        maxValue = value;
                        activeName = this.AZURE_BLENDSHAPES[parseInt(azureIndex)];
                    }
                }
            }
        });

        return {
            activeCount: totalActive,
            maxValue: maxValue.toFixed(2),
            maxName: activeName
        };
    },

    /**
     * Debug: List all mapped blendshapes
     */
    listMappings() {
        this.meshMappings.forEach((meshData, mesh) => {
            console.log(`\nMesh: ${mesh.name}`);
            for (const [azureIndex, meshIndex] of Object.entries(meshData.mapping)) {
                console.log(`  Azure[${azureIndex}] ${this.AZURE_BLENDSHAPES[azureIndex]} -> Mesh[${meshIndex}]`);
            }
        });
    }
};

// Make available globally
window.BlendShapeMapper = BlendShapeMapper;
