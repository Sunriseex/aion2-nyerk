# Personal additions for Nyerk 0.2.64

This directory adds separate currency rates, persistent bound-Kina income and rotating timer
icons to the original 0.2.64 distribution. It does not rebuild the app from the older public
0.2.50 sources. The original 0.2.64 code and native tracker helper are local build inputs, not
committed or uploaded. Their licences and credits remain in the packaged app.

`build.mjs` verifies the exact original app archive SHA-256, extracts it into a new ignored
staging folder, applies counted, fail-closed patches, adds these modules, and checks syntax.
It preserves existing dependencies, addons, loader, custom sounds and addon-HUD implementations.
The reader uses the standard Python addon API. The UI uses the existing sandboxed addon SDK;
two explicitly allowed core bridge channels supply the bubble's configuration and icon mapping.
No generic IPC access, remote code, new network connection, game memory access or game input
is introduced.

The existing `tracker:kina` object keeps its ordinary-session fields and adds `bound` (a second
session) and `boundActive` (reader availability). Existing addon consumers still receive the
ordinary fields. `personal:get` is read-only and restricted to original core renderer main frames;
`personal:state` supplies icon mappings, the icon toggle and an optional expiring preview. The
Personal Kina addon uses its existing authenticated SDK `send` route for `refresh`, a boolean-only
`config` request and a parameterless `preview` request.

Build (Windows, after installing the repo's existing app dependencies and generating its icon):

```powershell
node personal/build.mjs 'C:\path\to\original-0.2.64-program' --installer
```

The installer is `build/personal-installer/Nyerk-Personal-0.2.64-1.2.0.exe`.
The installer itself never deletes user data. Stop Nyerk, back up its program and current profile,
enable `addons.enabled.personal-kina` in the preserved settings, and keep `autoUpdateCheck=false`.
Leave other addon choices unchanged, including the built-in DPS Meter. Launch the installed
program with `--builtin-bundle` and verify the log says 0.2.64 and the extension loads.

History is in `%APPDATA%/Nyerk/personal-kina/history.sqlite`, using WAL and full synchronous
transactions. Back it up while Nyerk is stopped (including any WAL/SHM files); never copy only
the main database while a writer is active. Corrupt or unwritable data is reported and never
silently replaced. Failed writes remain queued in memory for retry; an abrupt shutdown during
a sustained storage failure can lose those pending writes. The UI displays the pending count.

Only observed positive bound-wallet changes count. Spending is ignored. A new connection,
login sync, zone boundary or confirmed character switch establishes new wallet baselines.
Unknown-character gains stay in a visible separate row and are assigned only on confirmation
within the same epoch. Identity is server plus character name, so renaming a character creates
a separate row. Historical or offline income cannot be inferred from a wallet balance.
Session reset affects rates only; the income ledger survives. Replay never writes income.

All-time totals persist; detail older than 31 days is pruned. Periods are `(now - duration, now]`
in UTC milliseconds. Seven and thirty days mean 168 and 720 hours, independent of DST.
Multiple event icons rotate every three seconds using the existing active alert list. Existing
sound and dismissal behavior is unchanged. Boss portraits come from the original app's assets;
local pictograms remain an error fallback if an image fails to load. No runtime network image
fetch is needed.

Personal 1.1.1 bundles client images for Shugo Festival, Dimensional Invasion, Rift, Artifact Siege,
the general field-boss symbol, Watcher Kaira, Guardian Lord Nahma, trading and reset notices. `game-icons.json` records
source pages, client resource identifiers, download URLs and SHA-256 hashes. `fetch-icons.mjs`
refreshes only these ten explicit mappings; the build verifies their hashes before packaging.
Game artwork belongs to NCSOFT. Event images come from Aion2.gg's client-asset registry
(https://aion2.gg/about/data), and NPC portraits from Questlog's game database
(https://questlog.gg/aion-2/en/map). Merchant uses the game's Trade menu icon (scales), also used
on https://aion2.gg/database/shops/random-shop. Daily and weekly reset share the game's Attendance
calendar icon, as on https://aion2.gg/tools/event-timer/resets. These are client menu assets
reused for notification categories; distinct native daily-reset and weekly-reset icons have not
been confirmed. Their existing tooltip names distinguish the two reset types.

Personal 1.1.1 validation on 2026-11-20: personal Node18, Python11 and app4 tests passed;
typecheck, app build and the original-0.2.64-based installer passed. Independent review confirmed
the new assets' client filenames, hashes, mappings and unchanged runtime boundaries. All ten
mapped images matched their manifest hashes inside the final package; all 78 original helper
files were unchanged and only the three expected original JS entrypoints differed. The installed
archive matched the package. Settings, collection and all income totals were preserved at
installation; SQLite `quick_check` passed. The new image files were visually inspected. Actual
merchant and reset alert times were not awaited for this asset-only update.

The Kina tab's **Test boss + event icons** button, or a second launch with `--personal-preview`, starts
a 12-second silent visual preview: Kaira, Shugo, Kaira, Shugo, each for three seconds. Its tooltip
says `TEST`. Preview does not broadcast timer alerts, change real dismissal state, change the
stored icon toggle, or add income. It ends even if a window throttles broadcast updates, and
then resumes any real active alerts (or the normal Nyerk icon). Soul pulses do not replace the
image node during preview or real alerts. Preview accepts no event IDs or other parameters.

Personal 1.1 validation on 2026-11-20: Node17, Python11 and original app4 tests passed;
typecheck, original app build and the 0.2.64-based installer build passed. A fresh independent
review found no actionable findings. Package comparison preserved all 78 original helper files
and all original archive files except the three expected JS entrypoints. Installation retained
settings, collection and complete income totals; the installed archive matched the package.
Live screenshots at approximately 0, 3, 6, 9 and 12 seconds showed Kaira, Shugo, Kaira, Shugo,
then the original Nyerk icon. This verifies the two-item preview through the actual installed
bubble, rather than only the queue unit test. It is a silent simulation, not a claim that those
two game events were actually scheduled together. No raw player data or captures are committed.

Tests:

```powershell
$env:NYERK_REVIEW_BASE = 'C:\path\to\extracted-original\out'
node --test personal/tests/personal.test.mjs
.venv/Scripts/python -m pytest personal/tests/test_reader.py tests/test_kina.py
```

Personal 1.2 uses English throughout the extension: navigation, statuses, messages, tooltips,
preview controls and en-US number/date formatting. Character names remain exactly as received
from the game. Existing unknown-character rows are labelled in English by their reserved key;
stored history is not rewritten. Rates with insufficient data show `Calculating…` in the HUD,
Session and Kina tab, including before the first gain. Stopped bound readers show `Paused`.
The one-minute calculation threshold and income accounting are unchanged. The compact HUD
rate label can shrink and wrap, and Session uses a smaller font for placeholders; both text and
font update through the optimized Vue block when the real rate becomes available.

Personal 1.2 validation on 2026-11-20: personal Node20, Python11 and app4 tests passed;
typecheck, app build and the 0.2.64-based installer passed. Independent review found no findings.
The packaged archive changed only the three allowed original JS entrypoints and preserved all
78 original helper files. Installed archive hash matched the package; settings and collection
bytes and complete income totals matched the pre-update backup, with SQLite `quick_check=ok`.
The app restarted and the English Kina navigation label was observed. Native UI automation
could not activate the panel to open the tab; placeholder text/class transitions were verified
with the optimized Vue test, while full live HUD wrapping remains a manual visual check.

Recovery: stop the patched app, restore the original program directory, keep the current profile
and `personal-kina` directory. Do not restore an older collection over new play progress.
The original app ignores the new database. Keep automatic updates off until a new base has been
reviewed and patched; this patcher intentionally rejects any unrecognized archive.

Validation on 2026-11-20: independent review of `a40519b..ee0b971` verified the four corrected
findings and reran Node (14 passed) and Python (11 passed). The final installer built successfully.
Comparison of all 1,455 original archive files found only the three intended JS entrypoints
changed; all 78 original tracker-helper files matched byte-for-byte. Installed archive hash
matched the packaged archive. The user's current profile and collection were preserved at
installation; only the new addon was enabled, with automatic updates already off.

Live Global validation confirmed bound income attributed to a character/server, the working
history tab, and continued income after a forced-stop/relaunch with committed totals intact.
SQLite `quick_check` returned `ok`. Active multi-alert image rotation and positive ordinary-Kina
income have automated coverage but no live observation yet. The user confirmed the history
table appears. Live character switching was subsequently verified: the previous character's
committed total stayed unchanged, a new character/server row received positive income, and
the total included both rows. Existing wallet balances were not imported as earnings. SQLite
`quick_check` also passed after the switch.
