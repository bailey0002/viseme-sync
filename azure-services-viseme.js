/**
 * Azure Services for Viseme-based Lip Sync
 * 
 * Uses Azure Speech SDK with Viseme IDs (0-21) mapped to Oculus visemes.
 * This is more reliable than 3D BlendShapes for Avaturn T2 models.
 * 
 * Now supports Audio2Face mode where visemes are disabled and audio
 * is routed to A2F for ARKit blendshape processing.
 */

class AzureServicesViseme {
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

        // Viseme control
        this.visemeIntensity = 1.0;
        this.visemeEnabled = true;  // Can be disabled when A2F is active

        // Azure SDK objects
        this.speechConfig = null;
        this.recognizer = null;
        this.synthesizer = null;
        this.player = null;

        // Viseme timing data
        this.visemeQueue = [];
        this.currentVisemeIndex = 0;
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
     * Enable/disable viseme processing (disable when A2F is active)
     */
    setVisemeEnabled(enabled) {
        this.visemeEnabled = enabled;
        console.log('Viseme processing:', enabled ? 'enabled' : 'disabled (A2F mode)');
        
        if (!enabled) {
            // Reset any active visemes
            if (window.VisemeMapper) {
                window.VisemeMapper.reset();
            }
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

        console.log('Azure Speech services initialized for Viseme-based lip sync');
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
            console.log('Audio playback started, visemes ready:', this.visemeQueue.length);
            this.playbackStartTime = performance.now();
            this.currentVisemeIndex = 0;
            this.isSpeaking = true;
            this.emit('speaking', true);
            
            // Only process visemes if enabled (not in A2F mode)
            if (this.visemeEnabled) {
                this.processVisemes();
            }
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
     * Create synthesizer that returns audio data (for A2F mode)
     * Returns audio blob instead of playing directly
     */
    createAudioOnlySynthesizer() {
        if (this.synthesizer) {
            try { this.synthesizer.close(); } catch (e) {}
        }

        // No audio output - we'll capture the result
        this.synthesizer = new SpeechSDK.SpeechSynthesizer(this.speechConfig, null);
        
        // Still capture visemes for potential fallback
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
     * Setup synthesizer events for Viseme IDs
     */
    setupSynthesizerEvents() {
        const sessionId = this.currentSynthesisId;

        // VISEME event handler - receives Viseme IDs
        this.synthesizer.visemeReceived = (s, e) => {
            if (sessionId !== this.currentSynthesisId) return;

            const visemeId = e.visemeId;
            const audioOffsetMs = e.audioOffset / 10000;

            this.visemeQueue.push({
                visemeId: visemeId,
                audioOffset: audioOffsetMs
            });

            if (this.visemeQueue.length <= 5) {
                console.log(`Viseme received: ID=${visemeId}, offset=${audioOffsetMs.toFixed(0)}ms`);
            }
        };

        this.synthesizer.synthesisStarted = () => {
            console.log('Synthesis started...');
        };

        this.synthesizer.synthesisCompleted = () => {
            console.log(`Synthesis completed, total visemes: ${this.visemeQueue.length}`);
        };

        this.synthesizer.synthesisCanceled = (s, e) => {
            console.log('Synthesis canceled:', e.errorDetails);
            this.handleSpeechEnd();
        };
    }

    /**
     * Process visemes in sync with audio
     */
    processVisemes() {
        if (!this.isSpeaking || !this.playbackStartTime || !this.visemeEnabled) {
            return;
        }

        const elapsed = performance.now() - this.playbackStartTime;

        while (this.currentVisemeIndex < this.visemeQueue.length) {
            const viseme = this.visemeQueue[this.currentVisemeIndex];

            if (viseme.audioOffset <= elapsed) {
                // Apply this viseme with smooth blending and intensity
                if (window.VisemeMapper) {
                    window.VisemeMapper.blendToViseme(viseme.visemeId, 0.4, this.visemeIntensity);
                }

                this.emit('viseme', {
                    visemeId: viseme.visemeId,
                    index: this.currentVisemeIndex,
                    total: this.visemeQueue.length,
                    elapsed: elapsed.toFixed(0)
                });

                this.currentVisemeIndex++;
            } else {
                break;
            }
        }

        if (this.isSpeaking) {
            this.animationFrameId = requestAnimationFrame(() => this.processVisemes());
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

        // Only reset visemes if we were controlling them
        if (this.visemeEnabled) {
            this.smoothResetToNeutral();
        } else {
            this.emit('speaking', false);
        }
    }

    /**
     * Smoothly reset visemes to neutral over 300ms
     */
    smoothResetToNeutral() {
        if (!window.VisemeMapper) {
            this.emit('speaking', false);
            return;
        }

        const duration = 300;
        const startTime = performance.now();

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);

            window.VisemeMapper.blendToNeutral(0.15);

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                window.VisemeMapper.reset();
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
     * Speak text with Viseme-based lip sync
     * In A2F mode, emits audioReady event for external processing
     */
    async speak(text) {
        if (!this.speechConfig) {
            console.error('Speech not configured');
            return;
        }

        this.currentSynthesisId++;
        console.log(`Starting synthesis session #${this.currentSynthesisId}, visemeEnabled: ${this.visemeEnabled}`);

        // Clear previous data
        this.visemeQueue = [];
        this.currentVisemeIndex = 0;
        this.playbackStartTime = null;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        const ssml = this.buildSSML(text);

        // If visemes are disabled (A2F mode), synthesize to buffer and emit audioReady
        if (!this.visemeEnabled) {
            return this.speakWithAudioCapture(ssml);
        }

        // Normal viseme mode - play directly
        this.createSynthesizer();

        return new Promise((resolve, reject) => {
            this.synthesizer.speakSsmlAsync(
                ssml,
                (result) => {
                    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                        console.log('Viseme synthesis completed successfully');
                        resolve(result);
                    } else {
                        console.log('Viseme synthesis failed:', result.reason);
                        reject(new Error('Speech synthesis failed'));
                    }
                },
                (error) => {
                    console.error('Viseme synthesis error:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Synthesize to audio buffer and emit for A2F processing
     */
    async speakWithAudioCapture(ssml) {
        console.log('A2F mode: Synthesizing audio for external processing...');

        // Create synthesizer without audio output
        this.createAudioOnlySynthesizer();

        return new Promise((resolve, reject) => {
            this.synthesizer.speakSsmlAsync(
                ssml,
                (result) => {
                    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                        console.log('Audio synthesis completed, bytes:', result.audioData.byteLength);

                        // Create audio blob from result
                        const audioBlob = new Blob([result.audioData], { type: 'audio/wav' });
                        const audioUrl = URL.createObjectURL(audioBlob);
                        const audioElement = new Audio(audioUrl);

                        // Mark as speaking
                        this.isSpeaking = true;
                        this.emit('speaking', true);

                        // Handle audio end
                        audioElement.onended = () => {
                            URL.revokeObjectURL(audioUrl);
                            this.isSpeaking = false;
                            this.emit('speaking', false);
                        };

                        // Emit audioReady event for A2F client to intercept
                        this.emit('audioReady', {
                            audioBlob: audioBlob,
                            audioElement: audioElement,
                            visemeQueue: this.visemeQueue  // Fallback data
                        });

                        // Start playing (A2F client will sync animation)
                        audioElement.play().catch(err => {
                            console.error('Audio playback error:', err);
                            this.isSpeaking = false;
                            this.emit('speaking', false);
                        });

                        resolve(result);
                    } else {
                        console.log('Audio synthesis failed:', result.reason);
                        reject(new Error('Speech synthesis failed'));
                    }
                },
                (error) => {
                    console.error('Audio synthesis error:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Build SSML with Viseme ID output
     */
    buildSSML(text) {
        const { name, rate } = this.config.voice;

        const relativePercent = Math.round((rate - 1.0) * 100);
        const rateString = relativePercent >= 0 ? `+${relativePercent}%` : `${relativePercent}%`;

        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        console.log(`Building SSML: voice=${name}, rate=${rateString}`);

        return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
                xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
            <voice name="${name}">
                <mstts:viseme type="redlips_front"/>
                <prosody rate="${rateString}">${escaped}</prosody>
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
     * Set viseme intensity (mouth expressiveness)
     */
    setVisemeIntensity(intensity) {
        this.visemeIntensity = Math.max(0.3, Math.min(1.5, intensity));
        console.log('Viseme intensity set to:', this.visemeIntensity);
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
            totalVisemes: this.visemeQueue.length,
            currentViseme: this.currentVisemeIndex,
            isSpeaking: this.isSpeaking,
            isListening: this.isListening,
            visemeEnabled: this.visemeEnabled
        };
    }
}

// Make available globally
window.AzureServicesViseme = AzureServicesViseme;
