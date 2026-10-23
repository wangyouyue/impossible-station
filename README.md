# The Impossible Station

> This is a small creative experiment conceived and implemented by ChatGPT in response to an open-ended request. Its concept was not based on the user's personal interests or background and does not represent the repository owner's views or research.

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

A small, playable railway to places that do not exist. Choose a platform, send a little train into the night, and bring back a ticket from each impossible world. Collect four tickets to uncover a fifth destination—and give it a name of your own.

Everything is drawn in code. The app runs offline, without installation, external assets, accounts or tracking.

## Open the station

Play online: [The Impossible Station](https://wangyouyue.github.io/impossible-station/). The interface follows your browser language and also offers a language selector.

Open one of these self-contained files in a browser:

| File | Initial language |
| --- | --- |
| `impossible-station.html` | English |
| `不可能车站.html` | Simplified Chinese |
| `impossible-station-ja.html` | Japanese |

Each file contains the complete app. The language selector lets you change language without losing the current journey, journal entries or your custom station name.

You can also open `dist/index.html`. This source entry starts in Chinese for a `zh` browser language, Japanese for `ja`, and English otherwise.

For an optional local HTTP preview, run this command from the project directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Visit `http://127.0.0.1:8765`, then stop the server with **Ctrl+C** when finished.

## Take a journey

- Choose the Origami Sea, the Inverted Orchard, the Moon Repair Shop or the Unsent City. Depart, pause and resume whenever you like.
- Change tracks to choose the next destination. A choice made during a journey applies to the next train; it takes priority over automatic roaming.
- Try a surprise destination or let automatic roaming explore unvisited stations. Switch between **1×, 2× and 4×** speed; a complete return journey takes 20 simulated seconds.
- Switch to the window seat for a different moving landscape at each stop. The window follows the current train, even when another destination is queued.
- Open your ticket collection to read the stories and souvenirs. After visiting the fifth station, you can name it there.
- Keep a journal for each visited station, with up to 160 Unicode code points per entry. First arrivals and visit counts are recorded for the current session.
- Save a **1200 × 800 SVG postcard** containing the station artwork, story, souvenir, journal entry and visit record. An entry can be left blank; repeated whitespace is collapsed in the exported text.

The collection pauses a moving train while it is open. Returning to the page after a background pause continues the journey without advancing it during the time away.

| Key | Action |
| --- | --- |
| `1`–`4` | Select a destination |
| `5` | Select the fifth station after unlocking it |
| `Space` | Depart, pause or resume |
| `R` | Change tracks |
| `V` | Switch map/window view |
| `M` | Toggle sound |

## Make yourself comfortable

Choose **Light**, **Dark** or **System** appearance. System is the default and responds to appearance changes while the page is open. The railway illustration stays a night scene, and exported postcards keep their paper colours.

Sound is off by default. The **≈** control reduces decorative motion; its initial setting follows the system preference. The train and journey progress remain functional. Background tabs pause both simulation and sound.

Progress, journal entries, names, language and appearance choices live only in the current page's memory. Reloading starts a new journey. Export any postcards you want to keep before leaving. The app makes no external network requests and uses no cookies or persistent browser storage.

## Develop and check

Node.js is needed only to run the build and automated checks. No package installation is required.

```sh
node check.mjs
node regression.mjs
node journal-check.mjs
node preferences-check.mjs
node build.mjs
node verify-build.mjs
```

The build creates the three standalone HTML editions. The checks exercise the actual application script in a simulated DOM, including travel timing, route selection, collection, journal entries, postcard generation and preferences. After building, `verify-build.mjs` checks the editions' initial languages, embedded source consistency, absence of externally linked scripts, and script syntax.

**Verification limit:** these are simulated and structural checks, not real-browser acceptance tests. Actual browser layout, file downloads and audible playback have not yet been verified. SVG content checks also do not replace viewing the exported image in a browser.

## Project files

| Path | Purpose |
| --- | --- |
| `dist/` | Application source: HTML, CSS and JavaScript |
| `build.mjs` | Bundles the standalone language editions |
| `check.mjs` | Core interaction and state checks |
| `regression.mjs` | Timing, drawing and layout-geometry regressions |
| `journal-check.mjs` | Journal and SVG export checks |
| `preferences-check.mjs` | Language and appearance checks |
| `verify-build.mjs` | Standalone package checks, run after the build |
| `test-artifacts/` | Generated test samples, when present |
| `README*.md` | English, Chinese and Japanese documentation |

All places and stories are fictional. There is no destination to optimise for: taking a detour counts, too.
