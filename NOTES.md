# potatotech.in content pipeline: project notes

_Last updated: 18 Oct 2026. Short handover: what exists, what was decided, what to do next._

## Current state (checked on the live site, 18 Oct 2026)
- WordPress: **122 published, 54 draft** posts. The five trust pages (About, Contact, Editorial Policy, Disclaimer, Privacy Policy) are published. Blog and Sample Page are drafts.
- The 25 posts from the 8, 9, 10 and 11 Oct batches (IDs 1251-1362) are all published. The pipeline only creates drafts, so these were published by hand. Nothing new has been published since 11 Oct.
- **AdSense rejected the site on 5 Oct 2026 ("low-value content").** Cleanup done: 49 defective posts and the Sample Page set back to draft (list in `adsense_unpublished.json`, plan in `adsense_cleanup_plan.json`), links to them removed, Amazon links cut to about 3 per post, trust pages published with the author set to "Anurag". Not resubmitted yet.
- You reported **losing rankings**. Possible cause: the unpublished posts may have had traffic, and one slug was changed (post 738). Not diagnosed: no Search Console access here.

## How to generate posts
- Main script: `src/pipeline-multi-niche.js` (model `gpt-4o-mini`, roughly $0.01 per article). Writes WordPress **drafts** with Unsplash images.
- Normal run: put topics in a JSON file (`keyword`, `niche`, `queries`, `notes`, `angle`, optional `table_html`), then:
  `node src/pipeline-multi-niche.js --topics-file=<file>.json --depth=deep`
  Other flags: `--mix=ai:2,gpu:2`, `--evergreen=...`, `--dry-run`, `--status=publish`. Examples of topic files: `trend5_oct11.json`, `gpu_compare_topics.json`.
- Audit: `node src/seo-audit.js --ids=1,2,3` (target 100/100). Reports go to `audits/`.
- Helpers: `src/add-videos-to-posts.js` (YouTube embeds; `--fallback`), `src/retrofit-posts.js`, `src/add-affiliate-to-posts.js`, `src/youtube-videos.js` (channel feed and matching), `gpu_specs.json` (GPU comparison specs). The older smartphone pipeline (`src/pipeline.js`) is untouched.
- Categories: AI, Technology, Smartphones, Flipkart Sale, Amazon Sale, GPU Comparisons, Claude AI, graphics cards, gaming.

## Decisions and rules (keep following these)
- **Drafts by default.** Publishing needs the user's say-so for that batch. When asked, publish only after SEO 100 and a read-through, and schedule posts at least 45 minutes apart (never a burst).
- **Facts only from sources.** Each topic carries verified notes (official pages read where possible), live headlines, and attributed claims. Leaks and rumours are labelled; allegations are attributed and never presented as fact. IPO and money posts say "not investment advice". The fact-checker removes unsupported numbers.
- **Affiliate:** Amazon.in links in every post, but only about 3 placements (top box, after the first section, closing). Link-stuffing was part of the AdSense problem.
- **Sources section:** omitted from new posts (user request). Old posts keep theirs.
- **YouTube (@potatotechi) embeds are mandatory** in every new post: a matching video or Short by brand and model, otherwise the channel's top video and a Short. The feed only holds the latest 15 items.
- **AI use is disclosed** in the Editorial Policy. Hiding it was declined as untrue.
- Named author "Anurag", `NewsArticle` schema, "Last updated" line, key takeaways box, FAQ schema, 8 FAQs.
- Audit tweaks made: the "no star ratings" check now matches real rating patterns, so "Hotstar" and "Star Sports" no longer trigger it.
- Fact-checker fix: "Rs. 19,901" and "Rs 19,901" are treated as the same figure.
- OmniRoute (free AI gateway) was reviewed and **not adopted**: savings are pennies, free tiers are unreliable, and consistency matters here.

## Known issues
- **Embedded videos are off-topic** for most non-iPhone posts (the channel is phone-heavy).
- **Stale, time-sensitive posts** need updating: Starlink launch date and the Musk/Ambani row, One UI 9 update list, ColorOS 17 (launch was 13 Oct), UPI MDR delay, Jio IPO (reported to open 21 Oct), JioHotstar/IND vs WI, Samsung Week and festive-sale prices, iPhone 17 effective price.
- Some older published posts have title/slug mismatches or truncated titles (26 were unpublished; others may remain).
- Reddit RSS is rate-limited; Google Trends India rarely shows tech terms; no real search-volume data (only Autocomplete and news).

## Next steps
1. Open Search Console: find pages that lost traffic; restore or redirect any unpublished post that ranked.
2. Refresh the stale posts above (update dates, prices and status).
3. Add menu and footer links to the About, Contact, Editorial Policy, Privacy and Disclaimer pages (cannot be done through the API).
4. Slow down: at most 1-2 new posts a day; prefer fewer, deeper, original posts (own photos, hands-on notes, videos about the actual topic).
5. Review the 54 drafts: publish, merge or delete; do not leave thin ones public.
6. Resubmit to AdSense only after several weeks of steady, curated publishing.
7. Optional: add a small scheduler script (status=future, 45-minute spacing) and an `OPENAI_BASE_URL` switch.
