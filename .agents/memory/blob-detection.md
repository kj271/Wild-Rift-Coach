---
name: Blob detection false positives
description: Filtering rules for minimap circle detection to avoid towers/base/objectives.
---

Green/blue/red blob detection picks up towers, base fountains, inhibitors, and other map elements without filters.

Filters that work:
- Aspect ratio: `min(bw,bh)/max(bw,bh) >= 0.28` — excludes elongated tower hitboxes
- Min pixels: `max(20, W*H*0.0006)` — excludes noise
- Max pixels: `W*H*0.04` — excludes large base structures
- Bounding box: each dimension must be ≥ 2% of minimap — excludes tiny artifacts

**Why:** Without these, enemy base fountain (red) and ally base (blue) both trigger as circles.
**How to apply:** All findBlobs() calls in champion-detection.ts should use these thresholds.
