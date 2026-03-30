# (WIP)Echo

Open-source AI Pet Project.


## Quick Start

**Prerequisites:** Node.js ≥ 18, Python ≥ 3.12, Git

```bash
# 1. Clone
git clone https://github.com/kuroha893/echo.git
cd echo

# 2. Install Node dependencies
cd apps/desktop-live2d
npm install

# 3. Install Python dependencies
pip install pydantic

# 4. Add Live2D models
#    Place model folders under apps/desktop-live2d/assets/models/
#    Each folder should contain a .model3.json file.
#    Then run:
cd apps/desktop-live2d
node scripts/register-models.mjs
#    Or click button in the console UI after launch.

# 5. Launch
start.bat
# or:
cd apps/desktop-live2d && npx electron ./electron/main.mjs
```

## Project Structure

```
packages/          # Core packages (protocol, runtime, orchestrator, llm, tts, renderer)
apps/desktop-live2d/   # Electron + Live2D desktop app
  electron/            # Main process, IPC, orchestrators
  renderer/            # Chat window, scene rendering
  python/              # Python companion host (LLM/TTS bridge)
  shared/              # Lip sync, Cubism backend, audio analysis
  scene/               # Scene controller, expressions, motions
  assets/models/       # Live2D model assets (not tracked in git)
docs/              # Architecture docs, protocol specs, task cards
```

## Notes

- Live2D model binary assets (`.moc3`, `.cmo3`, `.png`) are gitignored. You need to supply your own models.
- LLM and TTS provider endpoints are configured at first launch through the onboarding UI.
