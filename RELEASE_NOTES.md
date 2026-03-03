# User Name Persistence & Settings Sync - Release Notes

## Overview
This update fixes several critical issues with user name persistence and adds comprehensive settings synchronization across devices. Users can now access the app via a simple link (like `/jacob`), and all their display preferences will automatically restore.

---

## What Got Fixed

### 1. **Name Persistence Bug** 🐛
**Problem:** User names would disappear when closing and reopening the browser, especially in Chrome shared profiles or after clearing cache.

**Root Cause:** The app was checking `sessionStorage.tempUserName` first (which gets cleared when you close the browser), instead of checking persistent storage like `localStorage`.

**Solution:** Changed the priority order to check `localStorage` first, then cookie backup, ensuring names survive browser restarts.

**You'll Notice:** Your name stays remembered even after closing the browser completely.

---

### 2. **URL Slug for Quick Access** ⚡
**Problem:** New users had to enter their name every time they visited the app.

**Solution:** You can now visit a custom URL that includes your name:
- Instead of: `https://stomaboard.vercel.app` → enter name manually
- Now use: `https://stomaboard.vercel.app/jacob` → skip setup, use "Jacob"

**Features:**
- Automatically bypasses the setup screen
- When you enter your name in the setup form, the URL updates automatically
- You can bookmark or share the link with your name included
- Switching users resets the URL back to `/`

**You'll Notice:** The URL updates to your name after setup, and you can bypass setup entirely on return visits.

---

### 3. **"Change Name" Button Now Works** 🔧
**Problem:** Pressing "Change Name" in the Settings modal did nothing.

**Root Cause:** The `UserSetupModal` component was only rendered when you first opened the app (in the login screen). Once you logged in, it disappeared from the page, so it couldn't hear the "Change Name" button click.

**Solution:** Added `UserSetupModal` to the main app shell so it's always available, even when logged in.

**You'll Notice:** Clicking "Change Name" in Settings now pops open the name entry screen, and you can change your name at any time.

---

### 4. **Fixed First-Open Double Refresh** 🔄
**Problem:** When opening the app for the first time, it would refresh twice and show `?_deep_refresh=<timestamp>` in the URL.

**Root Cause:** The service worker would trigger a "controller changed" event on first install (not just on updates), causing an unnecessary deep refresh. Plus, the cleanup marker wasn't being removed from the URL.

**Solution:**
- Detect if this is the first install (no previous service worker) and skip the refresh
- Automatically strip the `_deep_refresh` query parameter from the URL so it never persists

**You'll Notice:** Clean startup on first open, no extra page refresh, no messy URL parameters.

---

### 5. **Settings Now Sync Across Devices** 📱
**Problem:** When you accessed the app via URL slug (e.g., `/jacob`), your saved settings (theme, layout preferences, automations) weren't being loaded.

**Solution:** When you access the app via URL slug, the system now:
1. Looks up all your previous settings in the database
2. Automatically restores your theme preference
3. Restores all your display and automation settings
4. Applies them to your browser immediately

**You'll Notice:** Your preferences are there when you use the URL slug, not just on normal login.

---

### 6. **All Settings Now Tracked in Database** 💾
**Problem:** Some settings weren't being saved to the database, so they couldn't be restored or managed by admins.

**Added Settings to Sync:**
- `enableMobileBoardView` - Mobile layout preference
- `disableAutomations` - Smart automation toggle
- `boostDarkMode` - Dark mode brightness adjustment
- `facultySystemManager` - Admin access flag
- `liteUi` - Performance mode toggle

**Plus all existing settings:**
- Theme (blue/white/pink/dark)
- Info Bar visibility
- Table Dividers
- Lock Add Case Card
- Stage Dividers
- Auto Update

**You'll Notice:** Your complete configuration is now saved and synchronized.

---

### 7. **System Admin Dashboard Updated** 👨‍💼
**For Admins:** The "Users & Commands" tab in System Management now shows all 11 user settings:

| Setting | Type | What It Does |
|---------|------|-------------|
| Theme | Dropdown | Changes the color scheme |
| Info Bar | On/Off | Shows/hides the info guide |
| Table Dividers | On/Off | Groups cases by category |
| Lock Add Card | On/Off | Keeps form sticky while scrolling |
| Stage Dividers | On/Off | Shows separators between workflow stages |
| Mobile Board View | On/Off | Compact layout for small screens |
| Smart Automations | On/Off | Auto-detects department and priority from notes |
| Boost Dark Mode | On/Off | Brightens dark theme for visibility |
| Auto Update | On/Off | Automatically installs app updates |
| Faculty: System Manager | On/Off | Grants admin access |
| Lite UI | On/Off | Performance mode (removes animations/blur) |

Admins can now view and edit any user's settings from the dashboard.

---

## Technical Changes Summary

**Files Modified:**
1. `src/context/UserContext.jsx` - Added settings fetch on URL slug access
2. `src/services/userService.js` - Extended sync to include all 11 settings
3. `src/components/SystemManagementScreen.jsx` - Added all settings to admin dashboard
4. `src/App.jsx` - Added UserSetupModal to main app shell
5. `src/index.js` - Fixed service worker reload logic
6. `src/services/caseService.js` - Fixed name persistence priority
7. `CLAUDE.md` & `AGENTS.md` - Updated AI documentation

**How Settings Flow Now:**
1. User changes a setting in Settings modal
2. Setting is saved to browser's localStorage
3. Every 20 seconds, a heartbeat sends all current settings to the database
4. When user logs in (or accesses via URL), all settings are fetched from database and applied
5. Admin can view/edit settings for any user from the System Management dashboard

---

## What Users Should Do

### **First Time Setup**
1. Visit the app normally and enter your name
2. Customize your settings (theme, layout preferences, etc.)
3. Copy/bookmark the URL that now includes your name

### **Return Visits**
1. **Option A:** Use your saved URL (e.g., `stomaboard.vercel.app/jacob`) - skips setup, restores all settings
2. **Option B:** Visit normally - name remembered from localStorage

### **Changing Settings**
1. Open Settings modal (gear icon)
2. Adjust any preferences
3. Changes automatically save and sync to database every 20 seconds

### **Changing Your Name**
1. Open Settings → "User" section
2. Click "Change Name"
3. Enter new name
4. URL updates automatically, bookmark the new link

---

## For Admins

### **Managing User Settings**
1. Go to "Manage Cases" → "System Management"
2. Select the "Users & Commands" tab
3. Click on any user to view their settings
4. Toggle between "View" and "Edit" modes
5. Change any setting and click "⚡ Apply" to push it to their device

### **Pushing Updates**
1. Use the "Push Update" panel to notify users of new versions
2. Send "Normal" updates for regular releases
3. Send "High" priority for critical fixes
4. Use "Force" only for emergency fixes (immediately reloads all browsers)

---

## Benefits

✅ **Better persistence** - Names survive browser/cache cleanup
✅ **Faster access** - Skip setup with bookmarkable links
✅ **Settings work** - Preferences sync across devices
✅ **Admin control** - Manage all user settings from dashboard
✅ **Smoother startup** - No more double-refresh on first load
✅ **Complete sync** - All 11 settings now tracked in database

---

## What Was Delivered

- **5 commits** with comprehensive fixes
- **7 files** updated
- **154 lines** of new/improved code
- **11 user settings** now fully synced
- **0 breaking changes** - fully backward compatible

---

## Questions?

All settings are automatically synced every 20 seconds via the heartbeat system. If you change something and don't see it reflected elsewhere, just wait a moment for the sync to complete.

