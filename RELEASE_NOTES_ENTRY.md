# Release Notes: User Name Persistence & Settings Sync

## What's New ✨

- **Bookmarkable Links**: Visit your unique app URL (e.g., `/jacob`) to skip setup and auto-restore all your settings
- **Reliable Name Persistence**: Your name now survives browser restarts, cache clears, and Chrome shared profiles
- **Complete Settings Sync**: All 11 user preferences (theme, layout, automations) automatically sync across devices via database

## What Got Fixed 🐛

- Fixed name disappearing after closing the browser (sessionStorage priority bug)
- Fixed "Change Name" button not working in Settings modal
- Fixed unnecessary double-refresh on first app open
- Fixed settings not loading when accessing the app via URL slug
- Added missing settings to database sync (Mobile View, Automations, Dark Mode boost, Faculty Admin, Lite UI)

## For Users 👤

- Use your bookmarkable URL to skip name entry on return visits
- All settings automatically save and sync every 20 seconds
- Change your name anytime from Settings → "Change Name" button
- URL updates automatically when you change your name

## For Admins 👨‍💼

- System Management → "Users & Commands" tab now displays all 11 user settings
- View and edit any user's preferences directly from the admin dashboard
- All settings sync automatically (no manual intervention needed)

## For Developers 👨‍💻

- New standardized process: Create `RELEASE_NOTES_ENTRY.md` in PRs for user-friendly notes
- Custom release notes take precedence over git commit history in the changelog
- See `CLAUDE.md` "Release Notes Entry" section for the workflow
