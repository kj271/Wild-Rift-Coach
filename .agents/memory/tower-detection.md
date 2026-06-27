---
name: Tower auto-detection from minimap
description: How tower up/down status is detected from minimap pixel colours.
---

`detectTowerStatus(minimapDataUrl, allyPositions, enemyPositions)` is called in `processImage` immediately after champion circle detection. It updates `towersDown` state (replaces manual click-to-toggle with auto result).

**Logic:**
- Sample a square region of ±4% minimap around each tower's calibrated position (from `towerConfig`).
- Ally towers: count blue-ish pixels (`b > 130 && b > r*1.15 && b > g*0.72`). If count < 8 → tower down.
- Enemy towers: count red-ish pixels (`r > 145 && r > g*1.7 && r > b*1.5`). If count < 8 → tower down.

**Why looser than champion detection:** Tower icons may be slightly less saturated than champion circles, especially outer towers overlapping terrain.

**Dependency:** Tower positions come from `towerConfig.ally` / `towerConfig.enemy` (calibrated via Settings → Tower calibrator). Auto-detection is meaningless if tower positions aren't calibrated.

**How to apply:** Call `detectTowerStatus` with the minimap data URL after circle detection. Result feeds directly into `setTowersDown`.
