/**
 * Azure Services for Viseme-based Lip Sync
 * 
 * Uses Azure Speech SDK with Viseme IDs (0-21) mapped to Oculus visemes.
 * This is more reliable than 3D BlendShapes for Avaturn T2 models.
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

        // Azure SDK objects
        this.speechConfig = null;
        this.recognizer = null;
        this.synthesizer = null;
        this.player = null;

        // Viseme timing data
        this.visemeQueue = [];      // Array of {visemeId, audioOffset}
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
            this.processVisemes();
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
     * Setup synthesizer events for Viseme IDs
     */
    setupSynthesizerEvents() {
        const sessionId = this.currentSynthesisId;

        // VISEME event handler - receives Viseme IDs
        this.synthesizer.visemeReceived = (s, e) => {
            if (sessionId !== this.currentSynthesisId) return;

            // e.visemeId is the viseme (0-21)
            // e.audioOffset is timing in 100-nanosecond units
            const visemeId = e.visemeId;
            const audioOffsetMs = e.audioOffset / 10000; // Convert to milliseconds

            this.visemeQueue.push({
                visemeId: visemeId,
                audioOffset: audioOffsetMs
            });

            // Debug: log first few visemes
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
        if (!this.isSpeaking || !this.playbackStartTime) {
            return;
        }

        const elapsed = performance.now() - this.playbackStartTime;
        
        // Find visemes that should be applied now
        while (this.currentVisemeIndex < this.visemeQueue.length) {
            const viseme = this.visemeQueue[this.currentVisemeIndex];
            
            if (viseme.audioOffset <= elapsed) {
                // Apply this viseme with smooth blending
                window.VisemeMapper.blendToViseme(viseme.visemeId, 0.4, 1.0);
                
                // Emit for debug display
                this.emit('viseme', {
                    visemeId: viseme.visemeId,
                    index: this.currentVisemeIndex,
                    total: this.visemeQueue.length,
                    elapsed: elapsed.toFixed(0)
                });
                
                this.currentVisemeIndex++;
            } else {
                // Haven't reached this viseme's time yet
                break;
            }
        }

        // Continue animation loop while speaking
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

        // Smoothly return to neutral
        this.smoothResetToNeutral();
    }

    /**
     * Smoothly reset visemes to neutral over 300ms
     */
    smoothResetToNeutral() {
        const duration = 300;
        const startTime = performance.now();
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            
            // Blend toward neutral
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
     */
    async speak(text) {
        if (!this.speechConfig) {
            console.error('Speech not configured');
            return;
        }

        // Increment session to invalidate old callbacks
        this.currentSynthesisId++;
        console.log(`Starting viseme synthesis session #${this.currentSynthesisId}`);

        // Clear previous data
        this.visemeQueue = [];
        this.currentVisemeIndex = 0;
        this.playbackStartTime = null;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Create fresh synthesizer
        this.createSynthesizer();

        // Build SSML with viseme support
        const ssml = this.buildSSML(text);
        console.log('Starting viseme synthesis...');

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
     * Build SSML with Viseme ID output (not FacialExpression)
     */
    buildSSML(text) {
        const { name, rate } = this.config.voice;
        const ratePercent = Math.round(rate * 100);

        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        console.log(`Building SSML: voice=${name}, rate=${ratePercent}%`);

        // Use redlips_front for Viseme IDs (0-21)
        return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
            <voice name="${name}">
                <mstts:viseme type="redlips_front"/>
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
            totalVisemes: this.visemeQueue.length,
            currentViseme: this.currentVisemeIndex,
            isSpeaking: this.isSpeaking,
            isListening: this.isListening
        };
    }
}

// Make available globally
window.AzureServicesViseme = AzureServicesViseme;
