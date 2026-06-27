---
name: Blob detection — ring shapes and size filtering
description: Why bbox-based filtering is required; pixel-count filtering breaks ring detection.
---

Wild Rift champion circles are RING-SHAPED — the interior is the champion portrait (not team-coloured). Only the border ring is green/blue/red. A 15%-wide ring has far fewer coloured pixels than a filled circle of the same apparent size.

**Critical lesson:** Do NOT filter by pixel count — it silently drops thin rings. Filter by BOUNDING BOX DIMENSIONS instead. The bbox of a ring correctly captures the full circle diameter regardless of fill.

Filters that work (in `findBlobs`):
- `minBBoxPct = 5` — each dimension must be ≥ 5% of minimap (filters wards, noise, small dots)
- `maxBBoxPct = 22` — each dimension must be ≤ 22% (filters base structures, large river patches)
- Aspect ratio `min(bw,bh)/max(bw,bh) ≥ 0.3` — excludes elongated non-ring shapes

**Why pixel-count min broke things:** Setting min = 0.7% of area filtered out champion rings (~0.3-0.5% pixels) while accidentally passing small filled dots.

**How to apply:** Pass `minBBoxPct, maxBBoxPct` to `findBlobs()`, not `minPx, maxPx`.

**Ring-shape check (critical for filtering wards):**
Sight wards are SOLID filled circles — their interior IS team-coloured. Champion circles are RINGS — interior is portrait (NOT team-coloured). After bbox/aspect filters, sample the centre 20% of the blob bbox. If >30% of those pixels pass the colour test → solid → reject. This is far more reliable than size filtering alone since wards and rings can overlap in bbox size range. Use ihw/ihh = 10% of bbox dimensions to sample the interior.

**Threshold history:** 0.22 → 0.20 → 0.16 (current). Vi was matching as Garen at 0.20, suggesting 12×12 signatures need a tight threshold when DB has only 1 entry.

