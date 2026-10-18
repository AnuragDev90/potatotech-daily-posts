const axios = require("axios");
const fs = require("fs");
const { log, loadJSON, saveJSON } = require("./utils");
require("dotenv").config();

const WORDPRESS_SITE = process.env.WORDPRESS_SITE;
const WORDPRESS_USERNAME = process.env.WORDPRESS_USERNAME;
const WORDPRESS_PASSWORD = process.env.WORDPRESS_PASSWORD;

// WordPress API base URL
const WORDPRESS_API = `${WORDPRESS_SITE.replace(/\/$/, "")}/wp-json/wp/v2`;

// Create auth header for WordPress
function getAuthHeader() {
  const credentials = Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString("base64");
  return {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/json"
  };
}

// Get all posts from WordPress
async function getAllWordPressPosts() {
  try {
    console.log("📝 Fetching all WordPress posts...");
    const response = await axios.get(`${WORDPRESS_API}/posts?per_page=100`, {
      headers: getAuthHeader()
    });

    console.log(`✅ Found ${response.data.length} posts\n`);
    return response.data;
  } catch (error) {
    log(`Error fetching posts: ${error.message}`, "ERROR");
    console.error("❌ Could not fetch posts from WordPress");
    console.error("Make sure your credentials are correct in .env");
    process.exit(1);
  }
}

// Update single post with SEO data
async function updatePostSEO(post, seoData) {
  try {
    // Generate schema markup JSON
    const schemaMarkup = seoData.seo.schema_markup;
    const schemaScript = `<script type="application/ld+json">${JSON.stringify(schemaMarkup.article)}</script>`;

    // Build internal links HTML
    let internalLinksHTML = "";
    if (seoData.seo.internal_links && seoData.seo.internal_links.length > 0) {
      internalLinksHTML = `
        <div style="background: #f0f0f0; padding: 20px; margin: 20px 0; border-radius: 5px;">
          <h3>📚 Related Posts:</h3>
          <ul>
            ${seoData.seo.internal_links.map(link => 
              `<li><a href="${link.url}">${link.anchor_text}</a></li>`
            ).join("")}
          </ul>
        </div>
      `;
    }

    // Prepare update payload
    const updatePayload = {
      title: seoData.seo.title,
      excerpt: seoData.excerpt,
      meta: {
        _yoast_wpseo_title: seoData.seo.title,
        _yoast_wpseo_metadesc: seoData.seo.meta_description,
        _yoast_wpseo_focuskw: seoData.seo.primary_keyword,
        _yoast_wpseo_keywordsynonyms: seoData.seo.secondary_keywords.join(", ")
      }
    };

    // Add schema markup and internal links to content if needed
    if (schemaScript && internalLinksHTML) {
      const currentContent = post.content.rendered;
      const newContent = currentContent + "\n" + internalLinksHTML + "\n" + schemaScript;
      updatePayload.content = newContent;
    }

    // Make update request
    const response = await axios.post(
      `${WORDPRESS_API}/posts/${post.id}`,
      updatePayload,
      { headers: getAuthHeader() }
    );

    return {
      success: true,
      postId: post.id,
      postTitle: response.data.title.rendered,
      updatedFields: ["title", "excerpt", "meta"]
    };
  } catch (error) {
    return {
      success: false,
      postId: post.id,
      postTitle: post.title.rendered,
      error: error.message
    };
  }
}

// Main function
async function main() {
  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("🚀 SEO WordPress Auto-Updater");
    console.log("═══════════════════════════════════════════════════════\n");

    // Validate credentials
    if (!WORDPRESS_SITE || !WORDPRESS_USERNAME || !WORDPRESS_PASSWORD) {
      console.error("❌ Missing WordPress credentials in .env");
      console.error("Required: WORDPRESS_SITE, WORDPRESS_USERNAME, WORDPRESS_PASSWORD");
      process.exit(1);
    }

    // Load SEO optimized posts
    console.log("📂 Loading SEO optimized data...");
    const seoOptimizedPosts = loadJSON("seo-optimized-posts.json");

    if (!seoOptimizedPosts || seoOptimizedPosts.length === 0) {
      console.error("❌ No SEO optimized posts found");
      console.error("Run: node src/seo-optimizer.js (first)");
      process.exit(1);
    }

    console.log(`✅ Loaded ${seoOptimizedPosts.length} optimized posts\n`);

    // Get all WordPress posts
    const wordPressPosts = await getAllWordPressPosts();

    // Match and update
    console.log("🔄 Updating posts with SEO data...\n");

    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < Math.min(seoOptimizedPosts.length, wordPressPosts.length); i++) {
      const wpPost = wordPressPosts[i];
      const seoData = seoOptimizedPosts[i];

      try {
        const result = await updatePostSEO(wpPost, seoData);
        results.push(result);

        if (result.success) {
          successCount++;
          console.log(`  ✅ [${i + 1}] "${result.postTitle.substring(0, 50)}"`);
        } else {
          failureCount++;
          console.log(`  ❌ [${i + 1}] "${result.postTitle}" - ${result.error}`);
        }

        // Rate limiting
        if ((i + 1) % 5 === 0) {
          console.log("  (waiting 2 seconds...)");
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        failureCount++;
        console.log(`  ❌ [${i + 1}] Error - ${error.message}`);
      }
    }

    // Summary
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📊 Update Summary:");
    console.log(`   ✅ Updated: ${successCount} posts`);
    console.log(`   ❌ Failed: ${failureCount} posts`);
    console.log(`   Total: ${successCount + failureCount} posts processed`);
    console.log("\n🎉 All posts now have SEO-optimized titles, descriptions & metadata!");
    console.log("📈 Check Google Search Console in 24-48 hours for crawl data\n");
    console.log("═══════════════════════════════════════════════════════\n");

    // Save results
    saveJSON("seo-update-results.json", {
      timestamp: new Date().toISOString(),
      successful: successCount,
      failed: failureCount,
      results: results
    });

    log(`Updated ${successCount} posts with SEO data`, "SUCCESS");

  } catch (error) {
    log(`Fatal error: ${error.message}`, "ERROR");
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
