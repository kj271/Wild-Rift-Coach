---
name: Personal portrait database
description: How champion auto-matching works — personal IDB over Data Dragon.
---

Data Dragon PC LoL art does NOT match Wild Rift minimap portraits — avoid using matchPortrait() in auto-detection flows.
Instead: crop the minimap at pin position on user assignment (`saveChampPortrait`), store 48×48 jpeg + colour sig in IDB `wr_portrait_db_v1`, match future uploads against that DB with `matchPersonalDb` (threshold 0.28).

**Why:** Wild Rift renders different art assets than PC. Data Dragon sigs are useless for WR minimap circles.
**How to apply:** All auto champion-naming in processImage should query personal DB first; Data Dragon fallback produces "Aatrox for everything".
