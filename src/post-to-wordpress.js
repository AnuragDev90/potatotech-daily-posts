const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");
const FormData = require("form-data");
const { log, saveJSON } = require("./utils");
require("dotenv").config();

const WORDPRESS_SITE = process.env.WORDPRESS_SITE;
const WORDPRESS_USERNAME = process.env.WORDPRESS_USERNAME;
const WORDPRESS_PASSWORD = process.env.WORDPRESS_PASSWORD;
const POSTED_TRACKER_FILE = "posted_posts.json";

// Parse command line
const STATUS =
  process.argv.find((arg) => arg.startsWith("--status="))?.split("=")[1] ||
  "draft";
const DRY_RUN = process.argv.includes("--dry-run");
const RESET_POSTED = process.argv.includes("--reset-posted");

function normalizePostKey(post) {
  if (typeof post === "string") {
    return post.trim().toLowerCase().replace(/\s+/g, " ");
  }

  const key = post?.sourceLink || post?.source || post?.title || "";
  return String(key).trim().toLowerCase().replace(/\s+/g, " ");
}

function loadPostedKeys() {
  const keys = new Set();

  for (const fileName of [POSTED_TRACKER_FILE, "posting_results.json"]) {
    try {
      const data = fs.readFileSync(fileName, "utf-8");
      const parsed = JSON.parse(data);

      if (typeof parsed === "string") {
        const key = normalizePostKey(parsed);
        if (key) keys.add(key);
      }

      if (Array.isArray(parsed)) {
        parsed.forEach((entry) => {
          const key = normalizePostKey(entry);
          if (key) keys.add(key);
        });
      }

      if (parsed && Array.isArray(parsed.posts)) {
        parsed.posts.forEach((entry) => {
          const key = normalizePostKey(entry);
          if (key) keys.add(key);
        });
      }
    } catch (error) {
      // Ignore missing or invalid historical files
    }
  }

  return keys;
}

function savePostedKeys(keys) {
  saveJSON(POSTED_TRACKER_FILE, Array.from(keys));
}

function resetPostedTracker() {
  for (const fileName of [POSTED_TRACKER_FILE, "posting_results.json"]) {
    if (fs.existsSync(fileName)) {
      fs.unlinkSync(fileName);
      console.log(`🧹 Reset posted tracker: ${fileName}`);
    }
  }
}

// Download and upload image to WordPress
async function uploadImageToWordPress(imageUrl, postTitle) {
  try {
    if (!imageUrl) return null;

    console.log(`  📸 Uploading image...`);

    // Download image
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
    });

    const filename = `featured-${Date.now()}.jpg`;
    const tempDir = os.tmpdir();
    fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, filename);

    // Save to temp
    fs.writeFileSync(tempPath, imageResponse.data);

    // Upload to WordPress
    const auth = Buffer.from(
      `${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`,
    ).toString("base64");
    const form = new FormData();
    form.append("file", fs.createReadStream(tempPath));

    const uploadResponse = await axios.post(
      `${WORDPRESS_SITE}/wp-json/wp/v2/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Basic ${auth}`,
        },
        timeout: 30000,
      },
    );

    // Clean up
    fs.unlinkSync(tempPath);

    console.log(`    ✅ Image uploaded (ID: ${uploadResponse.data.id})`);
    return uploadResponse.data.id;
  } catch (error) {
    console.log(
      `    ⚠️  Image upload failed: ${error.message.substring(0, 50)}`,
    );
    log(`Image upload failed: ${error.message}`, "WARN");
    return null;
  }
}

// Post to WordPress (with featured image requirement)
async function postToWordPress(post, index) {
  const auth = Buffer.from(
    `${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`,
  ).toString("base64");

  // ENFORCE FEATURED IMAGE REQUIREMENT
  if (!post.featured_image_url) {
    console.log(
      `  [${index + 1}] ⏭️  SKIPPING: "${post.title.substring(0, 50)}" (no featured image)`,
    );
    log(`Skipped post (no image): ${post.title}`, "WARN");
    return {
      skipped: true,
      reason: "no_image",
      article_title: post.title,
    };
  }

  let content = post.content;

  // Upload featured image (REQUIRED - post won't be created without it)
  console.log(`  [${index + 1}] 📤 "${post.title.substring(0, 50)}"`);
  let mediaId = null;

  if (process.env.INCLUDE_IMAGES !== "false") {
    mediaId = await uploadImageToWordPress(post.featured_image_url, post.title);
  }

  // FAIL IF IMAGE UPLOAD FAILED
  if (!mediaId) {
    console.log(
      `      ❌ Failed to upload featured image - SKIPPING post`,
    );
    log(`Image upload failed - skipped post: ${post.title}`, "ERROR");
    return {
      skipped: true,
      reason: "image_upload_failed",
      article_title: post.title,
    };
  }

  const payload = {
    title: post.title,
    content: content,
    excerpt: post.excerpt || "",
    status: STATUS,
    featured_media: mediaId,  // REQUIRED: set featured image
    categories: post.categories || [1],
    tags: post.tags || [],
    format: "standard",
  };

  // Add SEO metadata if available
  if (post.seo_metadata) {
    payload.meta = {
      _meta_description: post.seo_metadata.meta_description || "",
      _keywords: (post.seo_metadata.keywords || []).join(", "),
    };
  }

  try {
    if (DRY_RUN) {
      console.log(
        `      [DRY RUN] with image (ID: ${mediaId})`,
      );
      return {
        success: true,
        skipped: false,
        id: 0,
        link: "",
        status: "draft",
        attachment_id: mediaId,
        article_title: post.title,
      };
    }

    const response = await axios.post(
      `${WORDPRESS_SITE}/wp-json/wp/v2/posts`,
      payload,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    console.log(`      ✅ Published with image`);
    console.log(
      `         Post ID: ${response.data.id} | Image ID: ${mediaId}`,
    );

    log(`Posted article with image: ${post.title}`, "SUCCESS");

    return {
      success: true,
      skipped: false,
      post_id: response.data.id,
      attachment_id: mediaId,
      article_title: post.title,
      id: response.data.id,
      link: response.data.link || "",
      status: response.data.status,
    };
  } catch (error) {
    console.log(`      ❌ Post creation failed`);

    if (error.response?.status === 401) {
      console.log(`         Auth failed - check credentials`);
    } else if (error.response?.status === 403) {
      console.log(`         Permission denied - check REST API`);
    } else if (error.code === "ECONNREFUSED") {
      console.log(`         Can't connect - check WORDPRESS_SITE URL`);
    } else {
      console.log(
        `         Error: ${error.response?.data?.message || error.message}`,
      );
    }

    log(`Post creation failed: ${post.title} - ${error.message}`, "ERROR");

    return {
      success: false,
      skipped: false,
      article_title: post.title,
      attachment_id: mediaId,
      error: error.message,
    };
  }
}

// Load generated posts
function loadGeneratedPosts() {
  try {
    const data = fs.readFileSync("generated_posts.json", "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("❌ Missing generated_posts.json");
    console.error("   Run: node src/generate-unique-posts.js (first)");
    process.exit(1);
  }
}

// Validate configuration
function validateConfig() {
  if (!WORDPRESS_SITE || !WORDPRESS_USERNAME || !WORDPRESS_PASSWORD) {
    console.error("❌ Missing WordPress configuration in .env file\n");
    console.error("Required:");
    console.error("   WORDPRESS_SITE=https://your-domain.com");
    console.error("   WORDPRESS_USERNAME=your_username");
    console.error(
      "   WORDPRESS_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx\n",
    );
    process.exit(1);
  }
}

// Main function
async function main() {
  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📤 Posting to WordPress");
    console.log("═══════════════════════════════════════════════════════\n");

    // Validate
    validateConfig();

    if (RESET_POSTED) {
      resetPostedTracker();
    }

    // Load posts
    console.log("📂 Loading generated posts...");
    const rawPosts = loadGeneratedPosts();
    const uniquePosts = [];
    const seenInBatch = new Set();

    rawPosts.forEach((post) => {
      const key = normalizePostKey(post);
      if (!key || seenInBatch.has(key)) return;
      seenInBatch.add(key);
      uniquePosts.push(post);
    });

    const postedKeys = loadPostedKeys();
    const postsToPost = uniquePosts.filter((post) => {
      const key = normalizePostKey(post);
      return key && !postedKeys.has(key);
    });

    const duplicatesSkipped = uniquePosts.length - postsToPost.length;
    console.log(`✅ Loaded ${uniquePosts.length} unique posts`);
    if (duplicatesSkipped > 0) {
      console.log(
        `⏭️  Skipping ${duplicatesSkipped} already-posted duplicate post(s)\n`,
      );
    } else {
      console.log();
    }

    if (postsToPost.length === 0) {
      console.log("✅ No new posts to publish. All content is already posted.");
      return;
    }

    // Post to WordPress
    console.log(`🚀 Posting ${postsToPost.length} new posts to WordPress...\n`);

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      posts: [],
      timestamp: new Date().toISOString(),
    };

    for (let i = 0; i < postsToPost.length; i++) {
      try {
        const result = await postToWordPress(postsToPost[i], i);

        if (result.skipped) {
          results.skipped++;
          results.posts.push({
            title: postsToPost[i].title,
            skipped: true,
            reason: result.reason,
          });
          log(`Post skipped (${result.reason}): ${postsToPost[i].title}`, "WARN");
        } else if (result.success === false) {
          results.failed++;
          results.posts.push({
            title: postsToPost[i].title,
            error: result.error,
          });
          log(`Post failed: ${postsToPost[i].title}`, "ERROR");
        } else {
          results.success++;
          results.posts.push({
            title: postsToPost[i].title,
            id: result.post_id || result.id,
            attachment_id: result.attachment_id,
            link: result.link || "",
            status: result.status,
          });
          postedKeys.add(normalizePostKey(postsToPost[i]));
        }
      } catch (error) {
        results.failed++;
        results.posts.push({
          title: postsToPost[i].title,
          error: error.message,
        });
        log(`Post failed: ${postsToPost[i].title}`, "ERROR");
      }

      // Rate limiting
      if (i % 5 === 0 && i > 0) {
        console.log("  (rate limiting - waiting 2 seconds)");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Save results
    savePostedKeys(postedKeys);
    saveJSON("posting_results.json", results);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📊 Posting Summary:");
    console.log(`   ✅ Published with images: ${results.success}`);
    console.log(`   ⏭️  Skipped (no image): ${results.skipped}`);
    console.log(`   ❌ Failed: ${results.failed}`);
    console.log(`   Total processed: ${results.success + results.failed + results.skipped}`);
    console.log(
      `   Status: ${STATUS === "publish" ? "🔴 PUBLISHED" : "🟡 DRAFT"}`,
    );
    console.log("═══════════════════════════════════════════════════════\n");

    if (results.success > 0) {
      if (STATUS === "publish") {
        console.log(`✨ ${results.success} posts published with featured images!\n`);
        console.log("View your blog:");
        console.log(`   ${WORDPRESS_SITE}/blog\n`);
      } else {
        console.log(`✨ ${results.success} posts created as drafts with featured images!\n`);
        console.log("Review in WordPress:");
        console.log(`   ${WORDPRESS_SITE}/wp-admin/edit.php\n`);
      }
    }

    if (results.skipped > 0) {
      console.log(`ℹ️  ${results.skipped} posts skipped (missing featured images)\n`);
    }

    log(`Posted ${results.success} articles successfully`, "SUCCESS");
  } catch (error) {
    log(`Fatal error: ${error.message}`, "ERROR");
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
