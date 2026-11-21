# Aster

Aster is a personal desktop companion for Windows, macOS, and Linux. It provides a floating assistant window, local app and browser commands, visual lessons, screen and microphone recording, text-file editing, and an optional personal ChatGPT-plan connection.

## Windows download

Open the latest release, download `Aster-Windows-x64.zip`, extract the whole archive, and launch `Aster.exe`. Keep `Aster.exe` beside its `resources` folder and runtime files.

The current build is unsigned, so Windows SmartScreen may show an “unrecognized app” warning. Use **More info → Run anyway** only after confirming you downloaded it from this repository's Releases page.

## ChatGPT

- **Regular ChatGPT:** Aster can open `chatgpt.com` in your default browser and copy a prepared prompt for you to paste.
- **Inside Aster:** Open **Settings → ChatGPT → Continue with ChatGPT**. Eligible personal ChatGPT plans can authorize Aster through OpenAI's official Sign in with ChatGPT flow. No API key is needed.
- Aster does not use ChatGPT Work or a Codex runtime for normal operation.

## Commands

- `Open calculator`
- `Open text editor`
- `Open files`
- `Open wikipedia.org`
- `Search the web for aurora photos`
- `Search for jazz on YouTube`
- `Get directions to the nearest library`
- `Record my screen`
- `Record microphone`
- `Stop recording`
- `Edit a file`
- `Teach me how sound waves work`

Screen video and microphone audio are separate recordings. Files are saved under **Videos/Aster Recordings**. Aster's editor supports UTF-8 text files up to 2 MB and shows the content before saving.

## Run from source

Install Node.js 22.12 or newer, then run:

```sh
npm ci
npm start
```

## Privacy

Desktop commands, file editing, and recording are handled on the device. Text is sent to ChatGPT only after you connect a plan or open regular ChatGPT in the browser. OAuth credentials are protected by Electron's operating-system-backed secure storage.

The vendored Sign in with ChatGPT DevKit is provided under its own noncommercial license in `vendor/siwc/`.
