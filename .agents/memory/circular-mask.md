---
name: Circular mask for colour signatures
description: Why and how signatures mask pixels outside the inscribed circle.
---

Champion portrait crops include minimap background (terrain, lane markers). Without masking, background colour bleeds into the 12×12 signature, causing wrong matches (e.g. Thresh matching Garen).

**Rule:** In `_sig()`, pixels outside the inscribed circle are set to neutral grey (0.5, 0.5, 0.5) rather than their actual colour.

**Why this works:** Both the saved DB signature and the query signature use the same mask. The out-of-circle pixels always contribute (0.5 - 0.5)² = 0 to the L2 distance, so background is entirely ignored. Only the in-circle pixels determine the match.

**Threshold:** With circular masking, tighten the match threshold from 0.28 → 0.22 (background removal makes unrelated portraits more distinguishable).

**How to apply:** All `sigFromUrl()` calls use circular masking by default. Do not pass `circular=false` for portrait matching.
