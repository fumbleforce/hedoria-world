# Setup Guide

Follow these steps in order.

## Step 1: Install an Editor

Install one of the following:

- [VS Code](https://code.visualstudio.com/)
- [Cursor](https://www.cursor.com/)

## Step 2: Install Node.js

Node runs the project's build scripts, validation hooks, and automation. The project won't function without it.

**macOS** (using Homebrew):
```bash
brew install node
```

**Windows** (using winget):
```bash
winget install OpenJS.NodeJS.LTS
```

Or download directly from [nodejs.org](https://nodejs.org/en/download) (LTS version).

Verify it installed:
```bash
node --version
```

## Step 3: Install the Claude Code Extension

1. Open VS Code or Cursor
2. Go to the Extensions panel (`Cmd+Shift+X` on macOS, `Ctrl+Shift+X` on Windows)
3. Search for **Claude Code**
4. Click Install

## Step 4: Open the Project

Open this folder in your editor and start a Claude Code session. Claude Code hooks will run automatically on session start.

## Step 5 (Optional): Enable AI features in the engine

To enable LLM-driven chat, scene generation, and texture prebake in the
standalone engine:

1. Get an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Copy `engine/.env.example` to `engine/.env` and paste the key into
   `VITE_GEMINI_API_KEY=`
3. Restart the dev server (`npm run dev` in `engine/`) so Vite picks up
   the new env

The same `engine/.env` file powers `npm run prebake:textures`, so one key
covers everything.
