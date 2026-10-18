#!/usr/bin/env bash

# ═════════════════════════════════════════════════════════════════════════════
# COMPLETE DAILY AUTOMATION SCRIPT
# Generates 50 unique posts + SEO optimization + WordPress posting (ALL AUTO)
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# Resolve the actual project root regardless of where this script is launched from.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_DIR/automation.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
  echo -e "${BLUE}[$TIMESTAMP]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
  echo -e "${RED}[$TIMESTAMP] ERROR: $1${NC}" | tee -a "$LOG_FILE"
  exit 1
}

success() {
  echo -e "${GREEN}[$TIMESTAMP] ✅ $1${NC}" | tee -a "$LOG_FILE"
}

# ═════════════════════════════════════════════════════════════════════════════

log "════════════════════════════════════════════════════════════"
log "🚀 COMPLETE DAILY AUTOMATION STARTING"
log "════════════════════════════════════════════════════════════"

# Change to project directory
cd "$PROJECT_DIR" || error "Could not change to project directory"
log "📂 Working directory: $(pwd)"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 1: Fetch Headlines from RSS/APIs
# ═════════════════════════════════════════════════════════════════════════════

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "STEP 1/5: Fetching headlines from RSS feeds & APIs"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if node src/fetch-content.js >> "$LOG_FILE" 2>&1; then
  success "Headlines fetched and categorized"
  HEADLINES=$(grep -c "Final unique items" "$LOG_FILE" | tail -1 || echo "Unknown")
  log "Found headlines: tech_headlines.json"
else
  error "Failed to fetch headlines"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 2: Generate Unique Content
# ═════════════════════════════════════════════════════════════════════════════

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "STEP 2/5: Generating unique 1000-word posts with images"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if npm run generate >> "$LOG_FILE" 2>&1; then
  success "Posts generated with unique content"
  log "Generated posts saved: generated_posts.json"
else
  error "Failed to generate posts"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 3: SEO Optimization
# ═════════════════════════════════════════════════════════════════════════════

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "STEP 3/5: Optimizing for Google ranking (SEO)"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if node src/seo-optimizer.js >> "$LOG_FILE" 2>&1; then
  success "SEO optimization complete"
  log "SEO data saved: seo-optimized-posts.json"
else
  error "Failed to optimize for SEO"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 4: Post to WordPress
# ═════════════════════════════════════════════════════════════════════════════

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "STEP 4/5: Posting all posts to WordPress"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if node src/post-to-wordpress.js >> "$LOG_FILE" 2>&1; then
  success "All posts posted to WordPress"
  log "Check WordPress > Posts to see drafts"
else
  error "Failed to post to WordPress"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 5: Auto-Update WordPress with SEO Data
# ═════════════════════════════════════════════════════════════════════════════

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "STEP 5/5: Auto-updating WordPress with SEO metadata"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if node src/seo-wordpress-updater.js >> "$LOG_FILE" 2>&1; then
  success "WordPress posts auto-updated with SEO data"
  log "✅ All posts now have:"
  log "   - SEO-optimized titles"
  log "   - Meta descriptions"
  log "   - Schema markup"
  log "   - Internal links"
else
  error "Failed to update WordPress with SEO data"
fi

# ═════════════════════════════════════════════════════════════════════════════
# CLEANUP & SUMMARY
# ═════════════════════════════════════════════════════════════════════════════

log ""
log "════════════════════════════════════════════════════════════"
log "✅ AUTOMATION COMPLETE!"
log "════════════════════════════════════════════════════════════"

log ""
log "📊 SUMMARY:"
log "   ✅ Step 1: Headlines fetched & categorized"
log "   ✅ Step 2: Unique posts generated (1000 words each)"
log "   ✅ Step 3: SEO optimized (titles, descriptions, schema)"
log "   ✅ Step 4: Posted to WordPress as drafts"
log "   ✅ Step 5: Auto-updated with SEO metadata"

log ""
log "📈 NEXT ACTIONS:"
log "   1. Go to WordPress > Posts"
log "   2. Review posts (all should be drafts)"
log "   3. Check Yoast SEO fields are populated"
log "   4. Publish posts when ready"
log "   5. Setup Google Search Console (if not done)"

log ""
log "📝 FULL LOG: $LOG_FILE"
log "⏰ Completed: $(date '+%Y-%m-%d %H:%M:%S')"

log ""
log "════════════════════════════════════════════════════════════"

success "Ready for tomorrow! Same time tomorrow? 🚀"

