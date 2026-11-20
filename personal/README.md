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

Build (Windows, after installing the repo's existing app dependencies and generating its icon):

```powershell
node personal/build.mjs 'C:\path\to\original-0.2.64-program' --installer
```

The installer is `build/personal-installer/Nyerk-Personal-0.2.64-1.0.0.exe`.
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
local pictograms cover periodic events and missing portraits. No network image fetch is needed.

Tests:

```powershell
$env:NYERK_REVIEW_BASE = 'C:\path\to\extracted-original\out'
node --test personal/tests/personal.test.mjs
.venv/Scripts/python -m pytest personal/tests/test_reader.py tests/test_kina.py
```

Recovery: stop the patched app, restore the original program directory, keep the current profile
and `personal-kina` directory. Do not restore an older collection over new play progress.
The original app ignores the new database. Keep automatic updates off until a new base has been
reviewed and patched; this patcher intentionally rejects any unrecognized archive.
