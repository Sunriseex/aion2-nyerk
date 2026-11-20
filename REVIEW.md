# Review contract

For the 0.2.64 local extension, also read [personal/README.md](personal/README.md). Run its Node and Python test commands and `node personal/build.mjs <original-program-folder> --installer`. Verify that the original four addon directories and every original sidecar file are byte-for-byte unchanged in the package. Only main, preload and the single renderer JS bundle may change among original app files. Do not commit original binaries, extracted third-party bundles, profiles, databases or captures. Review new IPC sender checks, addon isolation, transaction rollback, retry/deduplication, unknown-character attribution, replay isolation, and recovery preserving new collection progress.

Validate the Kina packet parser with `.venv/Scripts/python -m pytest tests/test_kina.py`.
From `app/`, run `npm test`, `npm run typecheck`, then `npm run build`.

Kina currencies must have independent baselines, earned totals, clocks and reset/rebase behavior. Old restart files and untagged ordinary-Kina events must remain supported. Ignore unrelated item balances, including the combined currency. No packets may be sent to the game and no game memory may be accessed.

The Bound item ID is 930100001. Synthetic inventory-stack fixtures validate parsing, but a capture from the current Global client must confirm the record layout before claiming live validation. Keep any capture private and outside Git. A session reset or character switch must not count the existing wallet as income. Recovery uses the existing upstream version and existing settings, with no user settings migration required.

Validation on Windows, 2026-11-20: upstream parser reproduction confirmed that an ordinary balance is parsed while the bound item is ignored. Parser suite: 8 passed. Session suite (`npm test`): 4 passed. Node and Vue type checks passed. Production build passed. No live-game capture or installed-app validation has been performed. Dependency installation reported 8 moderate and 2 high advisories in the unchanged upstream dependency tree; no dependency upgrades are included in this change.
