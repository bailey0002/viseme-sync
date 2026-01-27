# 3D Avatar Lip-Sync with Azure TTS

A web application that renders a 3D avatar with real-time lip-sync powered by Azure Text-to-Speech and OpenAI.

## Features

- **60fps Facial Animation**: Uses Azure's 3D BlendShapes (55 ARKit values per frame)
- **Full Face Animation**: Not just mouth - eyes, brows, cheeks all animate
- **Voice Chat**: Speak to the avatar and get spoken responses
- **Text Chat**: Type messages as an alternative to voice

## Quick Start (Local Development)

1. **Copy the config template:**
   ```bash
   cp config.template.js config.js
   ```

2. **Edit `config.js`** with your Azure credentials:
   - Azure Speech Service key and region
   - Azure OpenAI endpoint, key, and deployment name

3. **Serve the files** (required for Azure SDK):
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Or using Node.js
   npx serve .
   
   # Or use VS Code Live Server extension
   ```

4. **Open** http://localhost:8000 in your browser

## Deploy to Azure Static Web Apps

### Step 1: Create the Azure Static Web App

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a new **Static Web App**
3. Choose your subscription and resource group
4. Give it a name (e.g., `avatar-lipsync`)
5. For deployment, select **GitHub** and connect your repository
6. Set:
   - **App location**: `/`
   - **API location**: (leave empty)
   - **Output location**: (leave empty)

### Step 2: Configure GitHub Secrets

In your GitHub repository, go to **Settings → Secrets and variables → Actions** and add these secrets:

| Secret Name | Value |
|-------------|-------|
| `AZURE_SPEECH_KEY` | Your Azure Speech Service key |
| `AZURE_SPEECH_REGION` | Your region (e.g., `eastus`) |
| `AZURE_OPENAI_ENDPOINT` | Your OpenAI endpoint URL |
| `AZURE_OPENAI_KEY` | Your Azure OpenAI key |
| `AZURE_OPENAI_DEPLOYMENT` | Your deployment name (e.g., `gpt-4o`) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | (Auto-created when you connect GitHub) |

### Step 3: Deploy

Push to `main` branch and GitHub Actions will automatically:
1. Inject your secrets into `config.js`
2. Deploy to Azure Static Web Apps

## Project Structure

```
├── index.html              # Main HTML file
├── styles.css              # Styling
├── config.template.js      # Config template (safe to commit)
├── config.js               # Your actual config (DO NOT COMMIT)
├── app.js                  # Main application logic
├── azure-services-3d.js    # Azure TTS with 3D BlendShapes
├── avatar-renderer.js      # Three.js scene and model loading
├── blendshape-mapper.js    # Maps Azure's 55 values to model
├── assets/
│   └── avatar.glb          # Your Avaturn T2 3D model
└── .github/
    └── workflows/
        └── azure-static-web-apps.yml  # CI/CD pipeline
```

## How It Works

1. **Azure TTS** receives text and generates:
   - Audio (played through browser)
   - 55 BlendShape values per frame at 60fps (via `FacialExpression` viseme type)

2. **BlendShapeMapper** takes each frame's 55 values and applies them to the corresponding morph targets on the 3D model

3. **Three.js** renders the model in real-time

## Requirements

- Azure Speech Service (for TTS and STT)
- Azure OpenAI Service (for chat responses)
- A modern browser with WebGL support

## Avatar Model

The app uses an Avaturn T2 model which includes:
- 52 ARKit blendshapes
- 15 Oculus visemes
- Mixamo-compatible skeleton

You can replace `assets/avatar.glb` with any GLB model that has ARKit-compatible blendshapes.

## License

MIT
