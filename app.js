/**
 * Main Application
 * Connects UI, Azure services, and 3D avatar rendering
 * Auto-connects if config.js has valid credentials
 */

// Wait for other modules to load
const { AvatarRenderer } = window;
const { AzureServices3D } = window;
const { BlendShapeMapper } = window;

class App {
    constructor() {
        this.renderer = null;
        this.azure = null;
        this.isRecording = false;

        // DOM elements
        this.elements = {
            canvas: document.getElementById('avatar-canvas'),
            loadingOverlay: document.getElementById('loading-overlay'),
            statusIndicator: document.getElementById('status-indicator'),
            statusText: document.getElementById('status-text'),
            configSection: document.getElementById('config-section'),
            connectBtn: document.getElementById('connect-btn'),
            speechKey: document.getElementById('speech-key'),
            speechRegion: document.getElementById('speech-region'),
            openaiEndpoint: document.getElementById('openai-endpoint'),
            openaiKey: document.getElementById('openai-key'),
            openaiDeployment: document.getElementById('openai-deployment'),
            voiceSelect: document.getElementById('voice-select'),
            speedSlider: document.getElementById('speed-slider'),
            speedValue: document.getElementById('speed-value'),
            intensitySlider: document.getElementById('intensity-slider'),
            intensityValue: document.getElementById('intensity-value'),
            chatMessages: document.getElementById('chat-messages'),
            userInput: document.getElementById('user-input'),
            micBtn: document.getElementById('mic-btn'),
            sendBtn: document.getElementById('send-btn'),
            debugFrames: document.getElementById('debug-frames'),
            debugCurrent: document.getElementById('debug-current'),
            debugActive: document.getElementById('debug-active'),
            debugFps: document.getElementById('debug-fps')
        };

        this.init();
    }

    async init() {
        // Initialize 3D renderer
        this.renderer = new AvatarRenderer(this.elements.canvas);

        // Load the avatar model
        try {
            await this.renderer.loadModel('assets/avatar.glb');
            this.elements.loadingOverlay.classList.add('hidden');
        } catch (error) {
            this.elements.loadingOverlay.querySelector('p').textContent = 
                'Failed to load avatar: ' + error.message;
            console.error('Failed to load avatar:', error);
            return;
        }

        // Initialize Azure services (using Viseme-based lip sync)
        this.azure = new AzureServicesViseme();
        this.setupAzureCallbacks();

        // Setup UI event listeners
        this.setupEventListeners();

        // Check for pre-configured credentials (from config.js)
        if (this.hasValidConfig()) {
            this.autoConnect();
        } else {
            // Show config section if no valid config
            this.elements.configSection.setAttribute('open', '');
            this.addSystemMessage('Please configure your Azure credentials to get started.');
        }

        // Start debug update loop
        this.updateDebugInfo();
    }

    /**
     * Check if CONFIG global has valid-looking credentials
     */
    hasValidConfig() {
        if (typeof CONFIG === 'undefined') {
            console.log('No CONFIG found');
            return false;
        }

        const { speech, openai } = CONFIG;
        
        // Check that values exist and aren't placeholders
        const hasValidSpeech = speech?.key && 
                               speech?.region && 
                               !speech.key.includes('YOUR_') &&
                               !speech.key.includes('PLACEHOLDER');
        
        const hasValidOpenAI = openai?.endpoint && 
                               openai?.key && 
                               openai?.deployment &&
                               !openai.key.includes('YOUR_') &&
                               !openai.key.includes('PLACEHOLDER');

        console.log('Config validation:', { hasValidSpeech, hasValidOpenAI });
        return hasValidSpeech && hasValidOpenAI;
    }

    /**
     * Auto-connect using CONFIG credentials
     */
    async autoConnect() {
        this.setStatus('connecting', 'Connecting...');
        this.addSystemMessage('Connecting to Azure services...');

        const config = {
            speech: {
                key: CONFIG.speech.key,
                region: CONFIG.speech.region
            },
            openai: {
                endpoint: CONFIG.openai.endpoint,
                key: CONFIG.openai.key,
                deployment: CONFIG.openai.deployment
            },
            voice: CONFIG.voice || {
                name: 'en-US-AndrewMultilingualNeural',
                rate: 1.0
            },
            systemPrompt: CONFIG.systemPrompt || 'You are a friendly assistant. Keep responses brief and conversational.'
        };

        // Apply voice settings to UI
        if (config.voice.name) {
            this.elements.voiceSelect.value = config.voice.name;
        }
        if (config.voice.rate) {
            this.elements.speedSlider.value = config.voice.rate;
            this.elements.speedValue.textContent = config.voice.rate.toFixed(1) + 'x';
        }

        const success = this.azure.configure(config);

        if (success) {
            this.addSystemMessage('✓ Connected! You can now chat with the avatar.');
            // Keep config section closed since we're connected
        } else {
            // Open config section so user can fix
            this.elements.configSection.setAttribute('open', '');
            this.addSystemMessage('Connection failed. Please check your credentials.');
        }
    }

    setupAzureCallbacks() {
        this.azure.on('status', (data) => {
            this.setStatus(data.status, data.message);
        });

        this.azure.on('error', (data) => {
            this.setStatus('error', data.message);
            this.addSystemMessage('⚠️ Error: ' + data.message);
        });

        this.azure.on('listening', (isListening) => {
            this.elements.micBtn.classList.toggle('recording', isListening);
            this.elements.micBtn.textContent = isListening ? '⏹️' : '🎙️';
            if (isListening) {
                this.addSystemMessage('🎤 Listening...');
            }
        });

        this.azure.on('speaking', (isSpeaking) => {
            console.log('Speaking:', isSpeaking);
        });

        this.azure.on('transcript', (data) => {
            if (data.isFinal && data.text.trim()) {
                // Remove "Listening..." message
                this.removeSystemMessage('🎤 Listening...');
                this.addMessage('user', data.text);
                this.azure.stopListening();
                this.azure.processMessage(data.text);
            }
        });

        this.azure.on('thinking', (isThinking) => {
            if (isThinking) {
                this.addSystemMessage('💭 Thinking...');
            }
        });

        this.azure.on('response', (text) => {
            this.removeSystemMessage('💭 Thinking...');
            this.addMessage('assistant', text);
        });

        this.azure.on('blendshapeFrame', (data) => {
            this.elements.debugCurrent.textContent = 
                `${data.frameIndex}/${data.totalFrames} (${data.elapsed}ms)`;
        });
    }

    setupEventListeners() {
        // Connect/Reconnect button
        this.elements.connectBtn.addEventListener('click', () => this.manualConnect());

        // Voice settings
        this.elements.voiceSelect.addEventListener('change', () => {
            this.azure.updateVoiceSettings(
                this.elements.voiceSelect.value,
                parseFloat(this.elements.speedSlider.value)
            );
        });

        this.elements.speedSlider.addEventListener('input', () => {
            const rate = parseFloat(this.elements.speedSlider.value);
            this.elements.speedValue.textContent = rate.toFixed(1) + 'x';
            this.azure.updateVoiceSettings(
                this.elements.voiceSelect.value,
                rate
            );
        });

        // Intensity slider - controls mouth movement expressiveness
        if (this.elements.intensitySlider) {
            this.elements.intensitySlider.addEventListener('input', () => {
                const intensity = parseFloat(this.elements.intensitySlider.value);
                this.elements.intensityValue.textContent = Math.round(intensity * 100) + '%';
                if (this.azure) {
                    this.azure.setVisemeIntensity(intensity);
                }
            });
        }

        // Send button
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());

        // Enter to send (Shift+Enter for newline)
        this.elements.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Mic button
        this.elements.micBtn.addEventListener('click', () => this.toggleMic());
    }

    /**
     * Manual connection using form inputs (override)
     */
    async manualConnect() {
        const config = {
            speech: {
                key: this.elements.speechKey.value.trim() || CONFIG?.speech?.key,
                region: this.elements.speechRegion.value.trim() || CONFIG?.speech?.region
            },
            openai: {
                endpoint: this.elements.openaiEndpoint.value.trim() || CONFIG?.openai?.endpoint,
                key: this.elements.openaiKey.value.trim() || CONFIG?.openai?.key,
                deployment: this.elements.openaiDeployment.value.trim() || CONFIG?.openai?.deployment
            },
            voice: {
                name: this.elements.voiceSelect.value,
                rate: parseFloat(this.elements.speedSlider.value)
            }
        };

        // Validate
        if (!config.speech.key || !config.speech.region) {
            this.addSystemMessage('⚠️ Please enter Speech API key and region');
            return;
        }
        if (!config.openai.endpoint || !config.openai.key || !config.openai.deployment) {
            this.addSystemMessage('⚠️ Please enter OpenAI endpoint, key, and deployment name');
            return;
        }

        this.setStatus('connecting', 'Connecting...');
        this.elements.connectBtn.disabled = true;

        const success = this.azure.configure(config);

        if (success) {
            this.addSystemMessage('✓ Connected successfully!');
            this.elements.configSection.removeAttribute('open');
        }

        this.elements.connectBtn.disabled = false;
    }

    async sendMessage() {
        const text = this.elements.userInput.value.trim();
        if (!text) return;

        if (!this.azure.isConfigured) {
            this.addSystemMessage('⚠️ Please connect to Azure first');
            this.elements.configSection.setAttribute('open', '');
            return;
        }

        this.elements.userInput.value = '';
        this.addMessage('user', text);
        await this.azure.processMessage(text);
    }

    async toggleMic() {
        if (!this.azure.isConfigured) {
            this.addSystemMessage('⚠️ Please connect to Azure first');
            this.elements.configSection.setAttribute('open', '');
            return;
        }

        if (this.azure.isListening) {
            await this.azure.stopListening();
            this.removeSystemMessage('🎤 Listening...');
        } else {
            await this.azure.startListening();
        }
    }

    addMessage(role, text) {
        const msg = document.createElement('div');
        msg.className = `message ${role}`;
        msg.textContent = text;
        this.elements.chatMessages.appendChild(msg);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    addSystemMessage(text) {
        const msg = document.createElement('div');
        msg.className = 'message system';
        msg.textContent = text;
        msg.dataset.text = text; // For finding and removing
        this.elements.chatMessages.appendChild(msg);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    removeSystemMessage(text) {
        const messages = this.elements.chatMessages.querySelectorAll('.message.system');
        messages.forEach(msg => {
            if (msg.dataset.text === text || msg.textContent === text) {
                msg.remove();
            }
        });
    }

    setStatus(status, message) {
        this.elements.statusIndicator.className = status;
        this.elements.statusText.textContent = message;
    }

    updateDebugInfo() {
        setInterval(() => {
            if (this.azure) {
                const state = this.azure.getDebugState();
                if (this.elements.debugFrames) {
                    this.elements.debugFrames.textContent = state.totalFrames;
                }
                
                if (typeof BlendShapeMapper !== 'undefined' && this.elements.debugActive) {
                    const stats = BlendShapeMapper.getStats();
                    this.elements.debugActive.textContent = 
                        `${stats.activeCount} (max: ${stats.maxName} @ ${stats.maxValue})`;
                }
            }

            if (this.renderer && this.elements.debugFps) {
                this.elements.debugFps.textContent = this.renderer.getFps();
            }
        }, 250);
    }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
