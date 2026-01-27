/**
 * Azure Services for 3D BlendShape Lip Sync
 * 
 * Uses Azure Speech SDK with FacialExpression viseme type to get
 * 55 blendshape values per frame at 60fps for high-quality lip sync.
 */

class AzureServices3D {
    constructor() {
        this.config = {
            speech: { key: '', region: '' },
            openai: { endpoint: '', key: '', deployment: '' },
            voice: { name: 'en-US-AndrewMultilingualNeural', rate: 1.0 },
            systemPrompt: 'You are a friendly assistant. Keep responses brief and conversational.'
        };

        this.isConfigured = false;
        this.isListening = false;
        this.isSpeaking = false;
        this.conversationHistory = [];

        // Azure SDK objects
        this.speechConfig = null;
        this.recognizer = null;
        this.synthesizer = null;
        this.player = null;

        // BlendShape frame data
        this.blendShapeFrames = [];      // Array of {frameIndex, shapes[55]}
        this.currentFrameIndex = 0;
        this.playbackStartTime = null;
        this.animationFrameId = null;

        // Session management
        this.currentSynthesisId = 0;

        // Event callbacks
        this.callbacks = {};
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
     * Configure Azure services
     */
    configure(config) {
        Object.assign(this.config.speech, config.speech || {});
        Object.assign(this.config.openai, config.openai || {});
        Object.assign(this.config.voice, config.voice || {});
        if (config.systemPrompt) {
            this.config.systemPrompt = config.systemPrompt;
        }

        // Validate
        const { speech, openai } = this.config;
        if (!speech.key || !speech.region) {
            this.emit('error', { message: 'Missing Speech API key or region' });
            return false;
        }
        if (!openai.endpoint || !openai.key || !openai.deployment) {
            this.emit('error', { message: 'Missing OpenAI endpoint, key, or deployment' });
            return false;
        }

        // Check SDK
        if (typeof SpeechSDK === 'undefined') {
            this.emit('error', { message: 'Azure Speech SDK not loaded' });
            return false;
        }

        try {
            this.initSpeechServices();
            this.isConfigured = true;
            this.emit('status', { status: 'connected', message: 'Connected' });
            return true;
        } catch (error) {
            console.error('Config error:', error);
            this.emit('error', { message: 'Failed to initialize: ' + error.message });
            return false;
        }
    }

    /**
     * Initialize speech services
     */
    initSpeechServices() {
        const { speech, voice } = this.config;

        this.speechConfig = SpeechSDK.SpeechConfig.fromSubscription(speech.key, speech.region);
        this.speechConfig.speechRecognitionLanguage = 'en-US';
        this.speechConfig.speechSynthesisVoiceName = voice.name;

        // Setup recognizer
        const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
        this.recognizer = new SpeechSDK.SpeechRecognizer(this.speechConfig, audioConfig);
        this.setupRecognizerEvents();

        console.log('Azure Speech services initialized for 3D BlendShapes');
    }

    /**
     * Create fresh synthesizer for each speech request
     */
    createSynthesizer() {
        // Cleanup previous
        if (this.player) {
            try { this.player.close(); } catch (e) {}
        }
        if (this.synthesizer) {
            try { this.synthesizer.close(); } catch (e) {}
        }

        // New player
        this.player = new SpeechSDK.SpeakerAudioDestination();

        this.player.onAudioStart = () => {
            console.log('Audio playback started, frames ready:', this.blendShapeFrames.length);
            this.playbackStartTime = performance.now();
            this.currentFrameIndex = 0;
            this.isSpeaking = true;
            this.emit('speaking', true);
            this.processBlendShapeFrames();
        };

        this.player.onAudioEnd = () => {
            console.log('Audio playback ended');
            this.handleSpeechEnd();
        };

        // New synthesizer
        const outputConfig = SpeechSDK.AudioConfig.fromSpeakerOutput(this.player);
        this.synthesizer = new SpeechSDK.SpeechSynthesizer(this.speechConfig, outputConfig);
        this.setupSynthesizerEvents();
    }

    /**
     * Setup recognizer events
     */
    setupRecognizerEvents() {
        this.recognizer.recognizing = (s, e) => {
            if (e.result.reason === SpeechSDK.ResultReason.RecognizingSpeech) {
                this.emit('transcript', { text: e.result.text, isFinal: false });
            }
        };

        this.recognizer.recognized = (s, e) => {
            if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
                this.emit('transcript', { text: e.result.text, isFinal: true });
            }
        };

        this.recognizer.sessionStarted = () => {
            this.isListening = true;
            this.emit('listening', true);
        };

        this.recognizer.sessionStopped = () => {
            this.isListening = false;
            this.emit('listening', false);
        };
    }

    /**
     * Setup synthesizer events for 3D BlendShapes
     */
    setupSynthesizerEvents() {
        const sessionId = this.currentSynthesisId;

        // VISEME event handler - receives BlendShapes data
        this.synthesizer.visemeReceived = (s, e) => {
            if (sessionId !== this.currentSynthesisId) return;

            // e.animation contains the BlendShapes JSON
            if (e.animation) {
                try {
                    const animData = JSON.parse(e.animation);
                    
                    // animData.BlendShapes is array of frames, each frame is array of 55 values
                    if (animData.BlendShapes && animData.BlendShapes.length > 0) {
                        const frameIndex = animData.FrameIndex || this.blendShapeFrames.length;
                        
                        animData.BlendShapes.forEach((shapes, i) => {
                            this.blendShapeFrames.push({
                                frameIndex: frameIndex + i,
                                shapes: shapes,
                                // At 60fps, each frame is ~16.67ms
                                timeMs: (frameIndex + i) * (1000 / 60)
                            });
                        });

                        // Debug: log first batch
                        if (this.blendShapeFrames.length <= 10) {
                            console.log(`BlendShape batch received: ${animData.BlendShapes.length} frames, total: ${this.blendShapeFrames.length}`);
                        }
                    }
                } catch (err) {
                    console.error('Error parsing BlendShapes:', err);
                }
            }
        };

        this.synthesizer.synthesisStarted = () => {
            console.log('Synthesis started (generating audio and blendshapes...)');
        };

        this.synthesizer.synthesisCompleted = () => {
            console.log(`Synthesis completed, total frames: ${this.blendShapeFrames.length}`);
        };

        this.synthesizer.synthesisCanceled = (s, e) => {
            console.log('Synthesis canceled:', e.errorDetails);
            this.handleSpeechEnd();
        };
    }

    /**
     * Process blendshape frames in sync with audio
     */
    processBlendShapeFrames() {
        if (!this.isSpeaking || !this.playbackStartTime) {
            return;
        }

        const elapsed = performance.now() - this.playbackStartTime;
        
        // Find the frame that corresponds to current playback time
        while (this.currentFrameIndex < this.blendShapeFrames.length) {
            const frame = this.blendShapeFrames[this.currentFrameIndex];
            
            if (frame.timeMs <= elapsed) {
                // Apply this frame's blendshapes
                window.BlendShapeMapper.applyFrame(frame.shapes, 1.0);
                
                // Emit for debug display
                this.emit('blendshapeFrame', {
                    frameIndex: this.currentFrameIndex,
                    totalFrames: this.blendShapeFrames.length,
                    elapsed: elapsed.toFixed(0)
                });
                
                this.currentFrameIndex++;
            } else {
                // Haven't reached this frame's time yet
                break;
            }
        }

        // ALWAYS continue the animation loop while speaking
        // New frames may still be arriving from Azure
        if (this.isSpeaking) {
            this.animationFrameId = requestAnimationFrame(() => this.processBlendShapeFrames());
        }
    }

    /**
     * Handle end of speech
     */
    handleSpeechEnd() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.isSpeaking = false;
        this.playbackStartTime = null;

        // Smoothly return to neutral
        this.smoothResetToNeutral();
    }

    /**
     * Smoothly reset blendshapes to neutral over 200ms
     */
    smoothResetToNeutral() {
        const duration = 200;
        const startTime = performance.now();
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            
            // Ease out
            const eased = 1 - Math.pow(1 - t, 3);
            
            // Lerp all values toward 0
            BlendShapeMapper.lerpToFrame(new Array(55).fill(0), eased);
            
            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                BlendShapeMapper.reset();
                this.emit('speaking', false);
            }
        };
        
        requestAnimationFrame(animate);
    }

    /**
     * Start listening for speech
     */
    async startListening() {
        if (!this.isConfigured || this.isListening) return false;
        try {
            await this.recognizer.startContinuousRecognitionAsync();
            return true;
        } catch (error) {
            this.emit('error', { message: 'Microphone error: ' + error.message });
            return false;
        }
    }

    /**
     * Stop listening
     */
    async stopListening() {
        if (!this.isListening) return;
        try {
            await this.recognizer.stopContinuousRecognitionAsync();
        } catch (error) {
            console.error('Stop listening error:', error);
        }
    }

    /**
     * Process message through OpenAI and speak response
     */
    async processMessage(userText) {
        if (!this.isConfigured) {
            this.emit('error', { message: 'Not configured' });
            return null;
        }

        this.conversationHistory.push({ role: 'user', content: userText });
        this.emit('thinking', true);

        try {
            const response = await this.callOpenAI();
            this.conversationHistory.push({ role: 'assistant', content: response });
            this.emit('response', response);
            this.emit('thinking', false);

            await this.speak(response);
            return response;
        } catch (error) {
            this.emit('thinking', false);
            this.emit('error', { message: error.message });
            return null;
        }
    }

    /**
     * Call Azure OpenAI
     */
    async callOpenAI() {
        const { endpoint, key, deployment } = this.config.openai;
        const cleanEndpoint = endpoint.replace(/\/+$/, '');
        const url = `${cleanEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-08-01-preview`;

        const messages = [
            { role: 'system', content: this.config.systemPrompt },
            ...this.conversationHistory.slice(-10)
        ];

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': key
            },
            body: JSON.stringify({
                messages,
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    /**
     * Speak text with 3D BlendShapes
     */
    async speak(text) {
        if (!this.speechConfig) {
            console.error('Speech not configured');
            return;
        }

        // Increment session to invalidate old callbacks
        this.currentSynthesisId++;
        console.log(`Starting 3D synthesis session #${this.currentSynthesisId}`);

        // Clear previous data
        this.blendShapeFrames = [];
        this.currentFrameIndex = 0;
        this.playbackStartTime = null;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Create fresh synthesizer
        this.createSynthesizer();

        // Build SSML with FacialExpression (3D BlendShapes) viseme type
        const ssml = this.buildSSML(text);
        console.log('Starting 3D blendshape synthesis...');

        return new Promise((resolve, reject) => {
            this.synthesizer.speakSsmlAsync(
                ssml,
                (result) => {
                    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                        console.log('3D synthesis completed successfully');
                        resolve(result);
                    } else {
                        console.log('3D synthesis failed:', result.reason);
                        reject(new Error('Speech synthesis failed'));
                    }
                },
                (error) => {
                    console.error('3D synthesis error:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Build SSML with FacialExpression viseme type for 3D BlendShapes
     */
    buildSSML(text) {
        const { name, rate } = this.config.voice;
        const ratePercent = Math.round(rate * 100);

        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        console.log(`Building 3D SSML: voice=${name}, rate=${ratePercent}%`);

        // KEY CHANGE: type="FacialExpression" for 3D BlendShapes (55 values at 60fps)
        // This is different from "redlips_front" which gives Viseme IDs
        return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
            <voice name="${name}">
                <mstts:viseme type="FacialExpression"/>
                <prosody rate="${ratePercent}%">${escaped}</prosody>
            </voice>
        </speak>`;
    }

    /**
     * Update voice settings
     */
    updateVoiceSettings(voiceName, rate) {
        this.config.voice.name = voiceName;
        this.config.voice.rate = rate;
        if (this.speechConfig) {
            this.speechConfig.speechSynthesisVoiceName = voiceName;
        }
    }

    /**
     * Clear conversation history
     */
    clearHistory() {
        this.conversationHistory = [];
    }

    /**
     * Get current state for debugging
     */
    getDebugState() {
        return {
            totalFrames: this.blendShapeFrames.length,
            currentFrame: this.currentFrameIndex,
            isSpeaking: this.isSpeaking,
            isListening: this.isListening
        };
    }
}

// Make available globally
window.AzureServices3D = AzureServices3D;
