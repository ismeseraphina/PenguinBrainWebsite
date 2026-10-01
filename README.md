# Penguin Brain Website

The web version of **Penguin Brain**: tasks, notes (with folders), diary with mood chart, bookmarks, a calendar, a Clock (focus timer fed by calendar events, task deadlines and routines) and the AI assistant (OpenAI, Gemini, Anthropic, OpenRouter, LM Studio, Ollama with your own key, same tools as the app), in a pink penguin theme. It signs in with GitHub and syncs both ways with the [Penguin Brain Android app](https://github.com/ismeseraphina/PenguinBrain).

**Open it:** Cloudflare version with accounts: https://penguinbrain.acry.workers.dev/ · static GitHub Pages version (GitHub sync only): https://ismeseraphina.github.io/PenguinBrainWebsite/

## Backend (Cloudflare Worker + D1)

`worker/index.ts` serves the website and a small API:

- Email + password accounts (PBKDF2-SHA256 hashes, bearer tokens, login rate limit). The first account becomes admin; sign ups are closed afterwards unless the admin opens them.
- Sync storage per user that speaks the same subset of the GitHub Contents API, so the Android app syncs with it by using the server URL as "Repository owner" and `data` as "Repository name".
- Admin page at `#/admin`: users, roles, disable, reset password, sign out everywhere, download or delete data, open or close sign ups.

Deploy: add the repository secret `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit, D1 Edit, Account Settings Read), then push to `main` or run the "Deploy to Cloudflare" workflow. It creates the D1 database on first run. Local: `npx wrangler dev`.

## What Seraphina made and added

This website is new: MyBrain only has an Android app. Everything below was built for Penguin Brain, following MyBrain's data model and features.

- **All app spaces on the web:** tasks (priority, sub-tasks, due dates, recurrence), Markdown notes with folders, diary with mood chart, bookmarks, dashboard, pink penguin theme, light/dark mode, works offline.
- **Accounts and backend:** Cloudflare Worker + D1, email + password sign in, app tokens for the Android app, first account becomes admin, admin page.
- **Sync with the Android app:** two-way, per-item newest-wins, deletions as tombstones, offline edits upload when back online. GitHub-repository sync is also supported.
- **Calendar:** events with repeat, reminders and browser notifications; **categories with custom colours** (filter by category); events sync with the app's "Penguin Brain" calendar with no duplicates and correct Hong Kong time.
- **Clock:** big ring focus timer with a countdown bar, Pause / Resume / +5 min, and swipeable cards built from events in progress, upcoming events, task deadlines (focus window) and routines; editable routines; a log of only the sessions you start; notifications. Nothing starts by itself.
- **AI assistant:** same providers, prompt and tools as the app (OpenAI, Gemini, Anthropic, OpenRouter, LM Studio, Ollama) with your own API key, kept in your browser.

## Credits

- Modified by **Seraphina**: [github.com/ismeseraphina](https://github.com/ismeseraphina) and [github.com/Cryjai](https://github.com/Cryjai) (old account)
- Feedback: [ismeseraphina.com](https://ismeseraphina.com)
- Modified from the code of [MyBrain](https://github.com/mhss1/MyBrain) by mhss1. The data model, sync format and features follow the MyBrain app. Licensed under GPL-3.0, same as MyBrain.
- Personal, non-commercial project. See [Usage, credit and commercial use](#usage-credit-and-commercial-use).

## Usage, credit and commercial use

Penguin Brain is Seraphina's personal remix. It is free and not sold.

**Please do not:**
- use Penguin Brain, its name or its penguin look for a **commercial** product, paid app, paid service or ads;
- present this remix, or a copy of it, as **your own project**, or remove the "Modified by Seraphina" and MyBrain credits.

**What the license requires (GPL-3.0, same as MyBrain):** if you share a copy or a modified version, you must
- keep all copyright notices and credits (MyBrain by mhss1, and this remix by Seraphina);
- clearly say that you changed it and what you changed;
- release your version under GPL-3.0 with its full source code.

Because this code comes from a GPL-3.0 project, the requests above about commercial use are Seraphina's personal request and cannot add extra legal limits to the GPL code. The credit and source rules above are required by the license. Questions or permission requests: [ismeseraphina.com](https://ismeseraphina.com).

### Penguin artwork

The penguin pictures (app icon, space cards, Clock penguin and the other `penguin_*` images) were made by Seraphina with AI image tools. They are **not** part of the GPL-3.0 code license. All rights reserved to the extent the law allows: please do not reuse, sell or redistribute them, or use them in another app, without Seraphina's permission. If you fork this project, replace the penguin images with your own. (Hong Kong's Copyright Ordinance protects computer-generated works; rules differ in other countries.)

## Sign in & Sync

Sync stores one file, `penguinbrain-sync.json`, in a **private** GitHub repository you own. No other server is involved.

1. [Create a private repository](https://github.com/new?name=PenguinBrainData&visibility=private) named `PenguinBrainData`.
2. [Create a fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Penguin+Brain+Sync&contents=write): Repository access → Only select repositories → `PenguinBrainData`; Permissions → Contents → Read and write.
3. Website: Settings → Sign in & Sync. App: Settings → Sign in & Sync. Use the same token, owner and repository on both.

How it merges: per item, the newest `updatedDate` wins; deletions are kept as tombstones for 180 days so they sync too. Auto sync runs when the site opens, 4 seconds after edits, when the tab regains focus and every 5 minutes (the app syncs on start, after changes and hourly in the background).

Calendar events sync with the "Penguin Brain" calendar in the Android app (other phone calendars stay on the phone). Not synced: external markdown folder notes (app option), AI assistant chats and API keys.

The token is kept in this browser's IndexedDB. Only use the site on your own devices, and revoke the token on GitHub if a device is lost.

## Develop

```bash
npm install
npm run dev     # local dev server
npm test        # sync, AI, calendar and clock tests
npm run build   # static build in dist/
```

Stack: Vite, React 19, TypeScript, marked + DOMPurify. Pushing to `main` deploys to Cloudflare (`.github/workflows/cloudflare.yml`) and GitHub Pages (`.github/workflows/deploy.yml`).
