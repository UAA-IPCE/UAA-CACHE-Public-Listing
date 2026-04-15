#!/usr/bin/env bash
# Run the CACHE daily enrichment pipeline and sync event snapshots
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Scrape latest courses
node scripts/scrapeContinuingStudies.js

# 2. Enrich and update catalog
node scripts/dailyEnrich.js

# 3. Sync event snapshots for frontend
node scripts/syncEventSnapshots.js

echo "[worker] Daily event pipeline complete: $(date)"