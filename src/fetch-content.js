const axios = require("axios");
const Parser = require("rss-parser");
const fs = require("fs");
const { log, saveJSON, delay } = require("./utils");
require("dotenv").config();

const parser = new Parser();

// RSS feeds configuration
const RSS_FEEDS = [
  // iPhone & Apple
  {
    name: "MacRumors",
    url: "https://feeds.macrumors.com/MacRumors/macrumors.rss",
  },
  { name: "9to5Mac", url: "https://9to5mac.com/feed/" },

  // Android
  { name: "Android Authority", url: "https://www.androidauthority.com/feed/" },
  { name: "Android Police", url: "https://www.androidpolice.com/feed/" },

  // Samsung
  { name: "GSM Arena", url: "https://www.gsmarena.com/rss-news-reviews.php3" },

  // India-Specific
  { name: "91Mobiles", url: "https://www.91mobiles.com/rss/india-mobiles" },
  { name: "MySmartPrice", url: "https://www.mysmartprice.com/mobile/rss" },

  // General Tech
  { name: "The Verge", url: "https://www.theverge.com/mobile/index.xml" },
  { name: "SlashGear", url: "https://www.slashgear.com/feed/" },
];

// Keywords for filtering (includes mobile/smartphone)
const KEYWORDS = [
  // General
  "AI",
  "tech",
  "software",
  "app",
  "startup",
  "gadget",
  "review",
  "cloud",
  "security",

  // Smartphones & Mobile
  "iPhone",
  "Android",
  "Samsung",
  "Pixel",
  "Nokia",
  "OnePlus",
  "Motorola",
  "smartphone",
  "mobile",
  "phone",
  "iOS",
  "app store",
  "play store",
  "specs",
  "camera",
  "battery",
  "processor",
  "chip",
  "display",
  "screen",
  "release",
  "announcement",
  "launch",
];

// WordPress Category Mapping
const WORDPRESS_CATEGORIES = {
  1: parseInt(process.env.WP_CAT_IPHONE || "1"),
  2: parseInt(process.env.WP_CAT_ANDROID || "2"),
  3: parseInt(process.env.WP_CAT_SAMSUNG || "3"),
  4: parseInt(process.env.WP_CAT_PIXEL || "4"),
  5: parseInt(process.env.WP_CAT_BUDGET || "5"),
  6: parseInt(process.env.WP_CAT_INDIA || "6"),
  7: parseInt(process.env.WP_CAT_SPECS || "7"),
  8: parseInt(process.env.WP_CAT_CAMERA || "8"),
};

// Auto-categorize headlines by phone brand/type
function categorizeHeadline(headline) {
  const title = (headline.title || "").toLowerCase();
  const description = (headline.description || "").toLowerCase();
  const text = title + " " + description;

  // Priority-based categorization (most specific first)

  // iPhone & Apple
  if (
    text.includes("iphone") ||
    text.includes("ios") ||
    text.includes("apple") ||
    text.includes("macos") ||
    text.includes("macbook")
  ) {
    return { categoryId: 1, categoryName: WORDPRESS_CATEGORIES[1] };
  }

  // Google Pixel
  if (
    text.includes("pixel") ||
    text.includes("google phone") ||
    text.includes("android 15") ||
    text.includes("android 16")
  ) {
    return { categoryId: 4, categoryName: WORDPRESS_CATEGORIES[4] };
  }

  // Samsung Galaxy
  if (
    text.includes("samsung") ||
    text.includes("galaxy") ||
    text.includes("galaxy s") ||
    text.includes("galaxy z")
  ) {
    return { categoryId: 3, categoryName: WORDPRESS_CATEGORIES[3] };
  }

  // OnePlus
  if (text.includes("oneplus") || text.includes("one plus")) {
    return { categoryId: 5, categoryName: WORDPRESS_CATEGORIES[5] };
  }

  // Mobile Photography/Camera
  if (
    text.includes("camera") ||
    text.includes("photography") ||
    text.includes("photo") ||
    text.includes("zoom") ||
    text.includes("portrait")
  ) {
    return { categoryId: 8, categoryName: WORDPRESS_CATEGORIES[8] };
  }

  // India-specific (pricing in rupees or India mention)
  if (
    text.includes("india") ||
    text.includes("₹") ||
    text.includes("rupee") ||
    text.includes("indian") ||
    text.includes("inr")
  ) {
    return { categoryId: 6, categoryName: WORDPRESS_CATEGORIES[6] };
  }

  // Specs & Comparisons
  if (
    text.includes("spec") ||
    text.includes("comparison") ||
    text.includes("vs") ||
    text.includes("battle") ||
    text.includes("benchmark")
  ) {
    return { categoryId: 7, categoryName: WORDPRESS_CATEGORIES[7] };
  }

  // Budget phones (OnePlus & Budget category)
  if (
    text.includes("budget") ||
    text.includes("affordable") ||
    text.includes("cheap") ||
    text.includes("under ₹") ||
    text.includes("redmi")
  ) {
    return { categoryId: 5, categoryName: WORDPRESS_CATEGORIES[5] };
  }

  // Android (generic, if not matched above)
  if (text.includes("android")) {
    return { categoryId: 2, categoryName: WORDPRESS_CATEGORIES[2] };
  }

  // Default: General smartphone specs
  return { categoryId: 7, categoryName: WORDPRESS_CATEGORIES[7] };
}

// Fetch from RSS feeds
async function fetchRSSFeeds() {
  console.log("📰 Fetching RSS feeds...\n");
  const allItems = [];

  for (const feed of RSS_FEEDS) {
    try {
      console.log(`  Fetching from ${feed.name}...`);
      const result = await parser.parseURL(feed.url);

      result.items.slice(0, 20).forEach((item) => {
        allItems.push({
          source: feed.name,
          title: item.title || "Untitled",
          link: item.link || "",
          description: item.contentSnippet || item.summary || "",
          pubDate: item.pubDate || new Date().toISOString(),
          content: item.content || item.description || "",
        });
      });

      console.log(`    ✅ Got ${Math.min(20, result.items.length)} items`);
      await delay(1000); // Rate limiting
    } catch (error) {
      console.log(`    ⚠️  Failed: ${error.message.substring(0, 50)}`);
      log(`RSS fetch failed for ${feed.name}: ${error.message}`, "WARN");
    }
  }

  return allItems;
}

// Fetch from Dev.to API
async function fetchDevToArticles() {
  console.log("\n🔗 Fetching from Dev.to API...");

  try {
    const response = await axios.get("https://dev.to/api/articles", {
      params: {
        per_page: 50,
        tag: "technology",
      },
      timeout: 10000,
    });

    const articles = response.data.map((article) => ({
      source: "Dev.to",
      title: article.title,
      link: article.url,
      description: article.description || article.excerpt || "",
      pubDate: article.published_at,
      content: article.body_markdown || "",
    }));

    console.log(`  ✅ Got ${articles.length} articles`);
    return articles;
  } catch (error) {
    console.log(`  ⚠️  Failed: ${error.message}`);
    log(`Dev.to fetch failed: ${error.message}`, "WARN");
    return [];
  }
}

// Fetch mobile/smartphone news from Hacker News (mobile tag)
async function fetchMobileNews() {
  console.log("\n📱 Fetching Mobile & Smartphone News...");

  try {
    // Fetch from tech news with mobile focus
    const searchTerms = ["iPhone", "Android", "smartphone", "mobile phones"];
    const allMobileNews = [];

    for (const term of searchTerms) {
      try {
        // Try to get mobile-focused content
        const response = await axios.get("https://news.google.com/rss/search", {
          params: {
            q: `${term} news`,
          },
          timeout: 10000,
        });

        const result = await parser.parseString(response.data);
        result.items.slice(0, 10).forEach((item) => {
          allMobileNews.push({
            source: `Mobile News - ${term}`,
            title: item.title || "Untitled",
            link: item.link || "",
            description: item.content || item.contentSnippet || "",
            pubDate: item.pubDate || new Date().toISOString(),
            content: item.content || "",
          });
        });
      } catch (error) {
        // Skip if this search fails
        continue;
      }
    }

    console.log(`  ✅ Got ${allMobileNews.length} mobile news items`);
    return allMobileNews;
  } catch (error) {
    console.log(`  ⚠️  Failed: ${error.message}`);
    log(`Mobile news fetch failed: ${error.message}`, "WARN");
    return [];
  }
}

// Filter content by keywords
function filterByKeywords(items) {
  console.log("\n🔍 Filtering by keywords...");

  const filtered = items.filter((item) => {
    const text = (item.title + " " + item.description).toLowerCase();
    return KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  });

  console.log(`  Original: ${items.length} items`);
  console.log(`  Filtered: ${filtered.length} items`);

  return filtered;
}

// Remove duplicates
function deduplicateItems(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = item.title.toLowerCase().trim();
    if (!seen.has(key) && item.title.length > 10) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}

// Validate content quality
function validateQuality(items) {
  return items.filter((item) => {
    // Ensure minimum content length
    const hasTitle = item.title && item.title.length > 20;
    const hasDescription = item.description && item.description.length > 50;
    return hasTitle && hasDescription;
  });
}

// Main function
async function main() {
  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📰 Fetching Content from Free Sources");
    console.log("═══════════════════════════════════════════════════════\n");

    // Fetch from all sources
    const rssItems = await fetchRSSFeeds();
    const devtoItems = await fetchDevToArticles();
    const mobileItems = await fetchMobileNews();

    // Combine all items
    const allItems = [...rssItems, ...devtoItems, ...mobileItems];
    console.log(`\n📊 Total items fetched: ${allItems.length}`);

    // Filter by keywords
    const filtered = filterByKeywords(allItems);

    // Validate quality
    const validated = validateQuality(filtered);
    console.log(`  After quality check: ${validated.length} items`);

    // Deduplicate
    const unique = deduplicateItems(validated);

    console.log(`\n✅ Final unique items: ${unique.length}\n`);

    // Apply category tagging to each headline
    console.log("📂 Categorizing headlines...");
    const categorized = unique.map((headline) => ({
      ...headline,
      category: categorizeHeadline(headline),
    }));

    // Group by category for summary
    const byCategory = {};
    categorized.forEach((item) => {
      const catId = item.category.categoryId;
      if (!byCategory[catId]) byCategory[catId] = [];
      byCategory[catId].push(item);
    });

    console.log("\n📊 Headlines by category:");
    Object.entries(byCategory).forEach(([catId, items]) => {
      const catName = WORDPRESS_CATEGORIES[catId];
      console.log(`   ${catName}: ${items.length} posts`);
    });

    // Save
    saveJSON("tech_headlines.json", categorized);

    // Show sample
    console.log("\n📝 Sample headlines:");
    categorized.slice(0, 5).forEach((item, i) => {
      console.log(
        `  ${i + 1}. [${item.category.categoryName}] ${item.title.substring(0, 65)}`,
      );
    });

    console.log(`\n✨ Next: node src/generate-unique-posts.js\n`);
    console.log("═══════════════════════════════════════════════════════\n");

    log(`Fetched ${unique.length} unique headlines`, "SUCCESS");
  } catch (error) {
    log(`Fatal error in fetch-content: ${error.message}`, "ERROR");
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
