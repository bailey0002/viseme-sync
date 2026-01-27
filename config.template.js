/**
 * Configuration Template
 * 
 * SETUP INSTRUCTIONS:
 * 1. Copy this file to config.js
 * 2. Replace the placeholder values with your actual Azure credentials
 * 3. NEVER commit config.js to git (it's in .gitignore)
 * 
 * For Azure Static Web Apps deployment:
 * - These values are injected at build time from GitHub Secrets
 * - See .github/workflows/azure-static-web-apps.yml
 */

const CONFIG = {
    // Azure Speech Service
    speech: {
        key: 'YOUR_SPEECH_KEY_HERE',
        region: 'YOUR_REGION_HERE'  // e.g., 'eastus', 'westus2'
    },
    
    // Azure OpenAI Service
    openai: {
        endpoint: 'https://YOUR_RESOURCE_NAME.openai.azure.com',
        key: 'YOUR_OPENAI_KEY_HERE',
        deployment: 'YOUR_DEPLOYMENT_NAME'  // e.g., 'gpt-4o', 'gpt-35-turbo'
    },
    
    // Default voice settings
    voice: {
        name: 'en-US-AndrewMultilingualNeural',
        rate: 1.0
    },
    
    // System prompt for the AI
    systemPrompt: 'You are a friendly assistant. Keep responses brief and conversational.'
};

// Make available globally
window.CONFIG = CONFIG;
