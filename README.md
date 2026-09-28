# Penguin Brain Website

The web version of **Penguin Brain**: tasks, notes (with folders), diary with mood chart, bookmarks and a calendar, in a pink penguin theme. It signs in with GitHub and syncs both ways with the [Penguin Brain Android app](https://github.com/ismeseraphina/PenguinBrain).

**Open it:** Cloudflare version with accounts: `https://penguinbrain.<your-subdomain>.workers.dev` · static GitHub Pages version (GitHub sync only): https://ismeseraphina.github.io/PenguinBrainWebsite/

## Backend (Cloudflare Worker + D1)

`worker/index.ts` serves the website and a small API:

- Email + password accounts (PBKDF2-SHA256 hashes, bearer tokens, login rate limit). The first account becomes admin; sign ups are closed afterwards unless the admin opens them.
- Sync storage per user that speaks the same subset of the GitHub Contents API, so the Android app syncs with it by using the server URL as "Repository owner" and `data` as "Repository name".
- Admin page at `#/admin`: users, roles, disable, reset password, sign out everywhere, download or delete data, open or close sign ups.

Deploy: add the repository secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" plus D1 Edit) and `CLOUDFLARE_ACCOUNT_ID`, then run the "Deploy to Cloudflare" workflow. It creates the D1 database on first run. Local: `npx wrangler dev`.

## Credits

- Modified by **Seraphina**: [github.com/ismeseraphina](https://github.com/ismeseraphina) and [github.com/Cryjai](https://github.com/Cryjai) (old account)
- Feedback: [ismeseraphina.com](https://ismeseraphina.com)
- Modified from the code of [MyBrain](https://github.com/mhss1/MyBrain) by mhss1. The data model, sync format and features follow the MyBrain app. Licensed under GPL-3.0, same as MyBrain.
- Personal, non-commercial project.

## Sign in & Sync

Sync stores one file, `penguinbrain-sync.json`, in a **private** GitHub repository you own. No other server is involved.

1. [Create a private repository](https://github.com/new?name=PenguinBrainData&visibility=private) named `PenguinBrainData`.
2. [Create a fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Penguin+Brain+Sync&contents=write): Repository access → Only select repositories → `PenguinBrainData`; Permissions → Contents → Read and write.
3. Website: Settings → Sign in & Sync. App: Settings → Sign in & Sync. Use the same token, owner and repository on both.

How it merges: per item, the newest `updatedDate` wins; deletions are kept as tombstones for 180 days so they sync too. Auto sync runs when the site opens, 4 seconds after edits, when the tab regains focus and every 5 minutes (the app syncs on start, after changes and hourly in the background).

Not synced: external markdown folder notes (app option), phone calendar events, AI assistant chats (the AI assistant is app only).

The token is kept in this browser's IndexedDB. Only use the site on your own devices, and revoke the token on GitHub if a device is lost.

## Develop

```bash
npm install
npm run dev     # local dev server
npm test        # sync engine test against a fake GitHub API
npm run build   # static build in dist/
```

Stack: Vite, React 19, TypeScript, marked + DOMPurify. Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
