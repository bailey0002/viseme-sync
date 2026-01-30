/**
 * Audio2Face Client
 * =================
 * Connects to A2F Bridge Server running on GPU instance.
 * Receives ARKit blendshape streams and applies them to Three.js avatar.
 * 
 * UPDATED: iOS Safari compatibility
 * - Added playsinline attributes for audio elements
 * - AudioContext unlock integration
 * 
 * Usage:
 *   const a2f = new Audio2FaceClient('ws://your-gpu-ip:8000');
 *   await a2f.connect();
 *   
 *   // When you have TTS audio:
 *   const audioBlob = await azureTTS.synthesize(text);
 *   a2f.processAndAnimate(audioBlob, audioElement);
 */

class Audio2FaceClient {
    constructor(serverUrl = null) {
        // Server URL (set via configure() or constructor)
        this.serverUrl = serverUrl;
        this.wsUrl = null;
        
        // Connection state
        this.isConnected = false;
        this.ws = null;
        
        // Animation state
        this.isAnimating = false;
        this.currentSession = null;
        this.frameBuffer = [];
        this.animationStartTime = null;
        this.animationFrameId = null;
        
        // Mesh references (set via setMeshes())
        this.meshMappings = new Map();
        
        // Settings
        this.settings = {
            intensity: 1.0,        // Overall animation intensity
            smoothing: 0.3,        // Blend factor for frame transitions
            useWebSocket: true,    // true=stream, false=batch
        };
        
        // Event callbacks
        this.callbacks = {};
        
        // ARKit blendshape names (must match your model)
        this.arkitShapes = [
            "eyeBlinkLeft", "eyeBlinkRight",
            "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
            "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
            "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
            "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
            "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
            "noseSneerLeft", "noseSneerRight",
            "jawForward", "jawLeft", "jawRight", "jawOpen",
            "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
            "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
            "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft", "mouthStretchRight",
            "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
            "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight",
            "mouthUpperUpLeft", "mouthUpperUpRight",
            "tongueOut",
        ];
        
        // Current blendshape values (for smoothing)
        this.currentValues = {};
        this.arkitShapes.forEach(name => this.currentValues[name] = 0);
    }
    
    /**
     * Configure server connection
     */
    configure(config) {
        if (config.serverUrl) {
            this.serverUrl = config.serverUrl.replace(/\/$/, '');
            // Derive WebSocket URL
            this.wsUrl = this.serverUrl.replace(/^http/, 'ws');
        }
        if (config.intensity !== undefined) {
            this.settings.intensity = config.intensity;
        }
        if (config.smoothing !== undefined) {
            this.settings.smoothing = config.smoothing;
        }
        if (config.useWebSocket !== undefined) {
            this.settings.useWebSocket = config.useWebSocket;
        }
    }
    
    /**
     * Register event callback
     */
    on(event, callback) {
        this.callbacks[event] = callback;
    }
    
    /**
     * Emit event
     */
    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event](data);
        }
    }
    
    /**
     * Check if server is reachable
     */
    async checkConnection() {
        if (!this.serverUrl) {
            return { connected: false, error: 'No server URL configured' };
        }
        
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                timeout: 5000
            });
            
            if (response.ok) {
                const data = await response.json();
                this.isConnected = true;
                return { connected: true, ...data };
            } else {
                return { connected: false, error: `HTTP ${response.status}` };
            }
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }
    
    /**
     * Initialize with Three.js scene - finds meshes with ARKit blendshapes
     */
    initializeWithScene(gltfScene) {
        this.meshMappings.clear();
        
        gltfScene.traverse((node) => {
            if (node.isMesh && node.morphTargetDictionary) {
                // Enable morph targets on material
                if (node.material) {
                    const materials = Array.isArray(node.material) ? node.material : [node.material];
                    materials.forEach(mat => {
                        mat.morphTargets = true;
                        mat.morphNormals = true;
                        mat.needsUpdate = true;
                    });
                }
                
                // Build index map for this mesh
                const shapeIndices = {};
                const dictionary = node.morphTargetDictionary;
                
                this.arkitShapes.forEach(shapeName => {
                    if (dictionary.hasOwnProperty(shapeName)) {
                        shapeIndices[shapeName] = dictionary[shapeName];
                    }
                });
                
                if (Object.keys(shapeIndices).length > 0) {
                    this.meshMappings.set(node, {
                        indices: shapeIndices,
                        influences: node.morphTargetInfluences
                    });
                    console.log(`A2F Client: Found ${Object.keys(shapeIndices).length} ARKit shapes in ${node.name}`);
                }
            }
        });
        
        console.log(`A2F Client: Initialized with ${this.meshMappings.size} meshes`);
        return this.meshMappings.size > 0;
    }
    
    /**
     * Process audio through A2F and animate avatar
     * 
     * @param {Blob|ArrayBuffer} audioData - Audio to process
     * @param {HTMLAudioElement} audioElement - Audio element for playback sync
     * @returns {Promise<void>}
     */
    async processAndAnimate(audioData, audioElement) {
        if (!this.serverUrl) {
            throw new Error('A2F server not configured');
        }
        
        this.emit('processing', { status: 'started' });
        
        try {
            if (this.settings.useWebSocket) {
                await this._processWithWebSocket(audioData, audioElement);
            } else {
                await this._processWithBatch(audioData, audioElement);
            }
        } catch (error) {
            this.emit('error', { message: error.message });
            throw error;
        }
    }
    
    /**
     * Process using WebSocket streaming (real-time)
     */
    async _processWithWebSocket(audioData, audioElement) {
        // Step 1: Upload audio and get session ID
        const formData = new FormData();
        const blob = audioData instanceof Blob ? audioData : new Blob([audioData]);
        formData.append('audio', blob, 'speech.wav');
        
        const response = await fetch(`${this.serverUrl}/process`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
        }
        
        const { session_id, frame_count, duration_sec } = await response.json();
        console.log(`A2F: Session ${session_id}, ${frame_count} frames, ${duration_sec}s`);
        
        this.emit('processing', { 
            status: 'uploaded', 
            sessionId: session_id,
            frameCount: frame_count,
            duration: duration_sec
        });
        
        // Step 2: Connect WebSocket for frame stream
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`${this.wsUrl}/ws/${session_id}`);
            this.ws = ws;
            this.frameBuffer = [];
            
            ws.onopen = () => {
                console.log('A2F: WebSocket connected');
                
                // Ensure audio element has iOS-required attributes
                audioElement.setAttribute('playsinline', '');
                audioElement.setAttribute('webkit-playsinline', '');
                
                // Start audio playback
                audioElement.play().then(() => {
                    // Signal server to start streaming
                    ws.send(JSON.stringify({ action: 'start' }));
                    this.animationStartTime = performance.now();
                    this.isAnimating = true;
                    this._startFrameLoop();
                }).catch(err => {
                    reject(new Error('Audio playback failed: ' + err.message));
                });
            };
            
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                
                if (msg.type === 'frame') {
                    this.frameBuffer.push(msg.data);
                } else if (msg.type === 'complete') {
                    console.log('A2F: Stream complete');
                    // Don't close yet - let animation finish
                } else if (msg.type === 'error') {
                    reject(new Error(msg.message));
                }
            };
            
            ws.onerror = (error) => {
                reject(new Error('WebSocket error'));
            };
            
            ws.onclose = () => {
                console.log('A2F: WebSocket closed');
            };
            
            // Resolve when audio ends
            audioElement.onended = () => {
                this._stopAnimation();
                ws.close();
                resolve();
            };
        });
    }
    
    /**
     * Process using batch request (simpler, slight latency)
     */
    async _processWithBatch(audioData, audioElement) {
        // Upload and get all frames at once
        const formData = new FormData();
        const blob = audioData instanceof Blob ? audioData : new Blob([audioData]);
        formData.append('audio', blob, 'speech.wav');
        
        const response = await fetch(`${this.serverUrl}/process-sync`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Process failed: ${response.status}`);
        }
        
        const { fps, frame_count, frames } = await response.json();
        console.log(`A2F: Received ${frame_count} frames at ${fps} FPS`);
        
        this.frameBuffer = frames;
        
        // Ensure audio element has iOS-required attributes
        audioElement.setAttribute('playsinline', '');
        audioElement.setAttribute('webkit-playsinline', '');
        
        // Start playback and animation together
        await audioElement.play();
        this.animationStartTime = performance.now();
        this.isAnimating = true;
        this._startFrameLoop();
        
        // Wait for audio to end
        return new Promise(resolve => {
            audioElement.onended = () => {
                this._stopAnimation();
                resolve();
            };
        });
    }
    
    /**
     * Start the frame application loop
     */
    _startFrameLoop() {
        const loop = () => {
            if (!this.isAnimating) return;
            
            const elapsed = (performance.now() - this.animationStartTime) / 1000; // seconds
            
            // Find the frame for current time
            let targetFrame = null;
            for (let i = this.frameBuffer.length - 1; i >= 0; i--) {
                if (this.frameBuffer[i].timestamp <= elapsed) {
                    targetFrame = this.frameBuffer[i];
                    break;
                }
            }
            
            if (targetFrame) {
                this._applyFrame(targetFrame);
            }
            
            this.animationFrameId = requestAnimationFrame(loop);
        };
        
        loop();
    }
    
    /**
     * Apply a single frame of blendshapes to all meshes
     */
    _applyFrame(frame) {
        const blendshapes = frame.blendshapes;
        const smoothing = this.settings.smoothing;
        const intensity = this.settings.intensity;
        
        // Smooth transition to new values
        this.arkitShapes.forEach(name => {
            const target = (blendshapes[name] || 0) * intensity;
            this.currentValues[name] += (target - this.currentValues[name]) * smoothing;
        });
        
        // Apply to all meshes
        this.meshMappings.forEach((meshData) => {
            const { indices, influences } = meshData;
            
            this.arkitShapes.forEach(name => {
                if (indices[name] !== undefined) {
                    influences[indices[name]] = this.currentValues[name];
                }
            });
        });
        
        // Emit for debug
        this.emit('frame', {
            frameIndex: frame.frame,
            timestamp: frame.timestamp,
            activeShapes: Object.entries(this.currentValues)
                .filter(([_, v]) => v > 0.05)
                .length
        });
    }
    
    /**
     * Stop animation and reset to neutral
     */
    _stopAnimation() {
        this.isAnimating = false;
        
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Smooth return to neutral
        this._smoothResetToNeutral();
    }
    
    /**
     * Smoothly reset all blendshapes to zero
     */
    _smoothResetToNeutral() {
        const duration = 300; // ms
        const startTime = performance.now();
        const startValues = { ...this.currentValues };
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            const easeOut = 1 - Math.pow(1 - t, 3); // Cubic ease-out
            
            // Interpolate toward zero
            this.arkitShapes.forEach(name => {
                this.currentValues[name] = startValues[name] * (1 - easeOut);
            });
            
            // Apply to meshes
            this.meshMappings.forEach((meshData) => {
                const { indices, influences } = meshData;
                this.arkitShapes.forEach(name => {
                    if (indices[name] !== undefined) {
                        influences[indices[name]] = this.currentValues[name];
                    }
                });
            });
            
            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this.emit('speaking', false);
            }
        };
        
        requestAnimationFrame(animate);
    }
    
    /**
     * Immediately reset all blendshapes to zero
     */
    reset() {
        this.arkitShapes.forEach(name => {
            this.currentValues[name] = 0;
        });
        
        this.meshMappings.forEach((meshData) => {
            const { indices, influences } = meshData;
            this.arkitShapes.forEach(name => {
                if (indices[name] !== undefined) {
                    influences[indices[name]] = 0;
                }
            });
        });
    }
    
    /**
     * Set animation intensity
     */
    setIntensity(value) {
        this.settings.intensity = Math.max(0.1, Math.min(2.0, value));
    }
    
    /**
     * Get debug state
     */
    getDebugState() {
        return {
            connected: this.isConnected,
            animating: this.isAnimating,
            bufferedFrames: this.frameBuffer.length,
            meshCount: this.meshMappings.size,
            intensity: this.settings.intensity
        };
    }
}

// Export globally
window.Audio2FaceClient = Audio2FaceClient;
