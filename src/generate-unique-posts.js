const axios = require("axios");
const fs = require("fs");
const {
  log,
  selectUniqueAngle,
  formatAsHTML,
  generateExcerpt,
  saveJSON,
  loadJSON,
  calculateSimilarity,
  delay,
} = require("./utils");
require("dotenv").config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_GROQ_MODELS = [
  process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "groq/compound",
  "groq/compound-mini",
];
const WORDS_PER_POST = parseInt(process.env.WORDS_PER_POST || "1000");
const POST_COUNT = parseInt(
  process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] ||
    process.env.POSTS_PER_DAY ||
    "50",
);
const GROQ_BATCH_SIZE = parseInt(process.env.GROQ_BATCH_SIZE || "5");
const GROQ_RATE_LIMIT_DELAY_MS = parseInt(
  process.env.GROQ_RATE_LIMIT_DELAY_MS || "60000",
);
const MAX_RATE_LIMIT_RETRIES = parseInt(
  process.env.GROQ_MAX_RATE_LIMIT_RETRIES || "3",
);
const CHECK_UNIQUENESS = process.env.CHECK_UNIQUENESS !== "false";
const MIN_UNIQUENESS = parseInt(process.env.MIN_UNIQUENESS_SCORE || "60");

function getGroqModels() {
  const configured = (process.env.GROQ_MODEL || "").trim();
  const chosen = configured
    ? [
        configured,
        ...DEFAULT_GROQ_MODELS.filter((model) => model !== configured),
      ]
    : DEFAULT_GROQ_MODELS;
  return [...new Set(chosen)];
}

// Load headlines from previous fetch
function loadHeadlines() {
  try {
    const data = fs.readFileSync("tech_headlines.json", "utf-8");
    return JSON.parse(data);
  } catch (error) {
    log(`Error loading headlines: ${error.message}`, "ERROR");
    log("Run: node src/fetch-content.js (first)", "INFO");
    process.exit(1);
  }
}

// Generate unique content using Groq
async function generateUniqueContent(headline, angle) {
  if (!GROQ_API_KEY) {
    log("Missing GROQ_API_KEY. Cannot generate content.", "ERROR");
    process.exit(1);
  }

  const prompt = `You are a technical writer creating content for Indian tech enthusiasts.

HEADLINE: ${headline.title}
ORIGINAL SUMMARY: ${headline.description}

YOUR TASK:
Create a COMPLETELY UNIQUE, ${WORDS_PER_POST}-word blog post about this topic.

CRITICAL REQUIREMENTS:
1. DO NOT copy any sentences from the original summary
2. Write from a unique angle: ${angle.description}
3. Target keyword: ${angle.template}
4. Add India-specific insights (pricing in INR, availability, relevance)
5. Include original analysis, comparisons, and examples
6. Structure with clear H2/H3 headers
7. Add practical examples or tutorials
8. Include your honest opinion/verdict
9. Make it SEO-friendly but NOT spammy
10. MUST be 900-1100 words

OUTPUT FORMAT:
Return ONLY valid JSON (no markdown, no preamble):
{
  "title": "Unique title incorporating the angle",
  "content": "Full HTML-formatted content with <h2>, <h3>, <p> tags",
  "excerpt": "50-word summary",
  "keyword": "Primary SEO keyword",
  "angle_used": "The unique angle you used"
}

START YOUR RESPONSE WITH THE JSON ONLY.`;

  try {
    log(
      `Generating post from: "${headline.title.substring(0, 50)}"`,
      "GENERATE",
    );

    const models = getGroqModels();
    let response = null;
    let lastError = null;

    for (const model of models) {
      try {
        response = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_tokens: 2000,
            temperature: 0.7,
          },
          {
            headers: {
              Authorization: `Bearer ${GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          },
        );
        log(`Using model: ${model}`, "INFO");
        break; // Success, exit loop
      } catch (error) {
        lastError = error;
        log(`Model ${model} failed, trying next...`, "WARN");
        continue;
      }
    }

    if (!response) {
      throw lastError || new Error("All Groq models failed");
    }

    let content = response.data.choices[0].message.content;

    const extractJsonObject = (raw) => {
      if (!raw) return raw;
      let cleaned = raw.trim();
      cleaned = cleaned
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      return cleaned;
    };

    content = extractJsonObject(content);
    const post = JSON.parse(content);

    // Verify uniqueness
    if (CHECK_UNIQUENESS) {
      const similarity = calculateSimilarity(
        post.content,
        headline.description,
      );
      if (similarity > 100 - MIN_UNIQUENESS) {
        log(
          `Content too similar (${similarity}% match). Regenerating...`,
          "WARN",
        );
        await delay(2000);
        return await generateUniqueContent(headline, angle);
      }
      log(`Uniqueness check: ${100 - similarity}% unique ✓`, "CHECK");
    }

    // Use auto-detected category from headline, fallback to default
    const categoryId =
      headline.category?.categoryId ||
      parseInt(process.env.DEFAULT_CATEGORY || "1");
    const categoryName = headline.category?.categoryName || "General";

    return {
      ...post,
      source: headline.source,
      sourceLink: headline.link,
      categories: [categoryId],
      categoryName: categoryName,
      tags: [10, 11],
      status: "draft",
    };
  } catch (error) {
    if (error.response?.status === 429) {
      log(
        "Groq rate limit hit. Stopping this generation batch to avoid an endless retry loop.",
        "WARN",
      );
      throw error;
    }
    if (error.response?.status === 404) {
      log(
        "Groq model not found or not available on this API key. Available models depend on your Groq account and key. Set GROQ_MODEL to a model returned by GET /openai/v1/models.",
        "ERROR",
      );
    }
    log(
      `Groq error: ${error.response?.data?.message || error.message}`,
      "ERROR",
    );
    throw error;
  }
}

// Generate featured image using Unsplash
async function fetchFeaturedImage(keyword) {
  const UNSPLASH_KEY = process.env.UNSPLASH_API_KEY;

  if (!UNSPLASH_KEY) {
    log("Unsplash API key not configured. Skipping images.", "WARN");
    return null;
  }

  try {
    const response = await axios.get("https://api.unsplash.com/search/photos", {
      params: {
        query: keyword,
        per_page: 1,
        orientation: "landscape",
      },
      headers: {
        Authorization: `Client-ID ${UNSPLASH_KEY}`,
      },
      timeout: 5000,
    });

    if (response.data.results.length > 0) {
      return response.data.results[0].urls.regular;
    }
    return null;
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      log(
        "Unsplash image fetch failed: UNSPLASH_API_KEY is invalid, expired, or missing permissions. Update it in .env or set INCLUDE_IMAGES=false.",
        "WARN",
      );
    } else {
      log(`Image fetch error: ${error.message}`, "WARN");
    }
    return null;
  }
}

// Main function
async function main() {
  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📝 Generating Unique Blog Posts");
    console.log("═══════════════════════════════════════════════════════\n");

    // Validate
    if (!GROQ_API_KEY) {
      console.error("❌ Missing GROQ_API_KEY in .env file");
      process.exit(1);
    }

    // Load headlines
    console.log("📂 Loading headlines...");
    const headlines = loadHeadlines();
    console.log(`✅ Loaded ${headlines.length} headlines\n`);

    if (headlines.length === 0) {
      console.error("❌ No headlines. Run: node src/fetch-content.js");
      process.exit(1);
    }

    // Generate posts
    console.log(
      `🚀 Generating ${POST_COUNT} unique posts (${WORDS_PER_POST} words each)...\n`,
    );

    const existingPosts = Array.isArray(loadJSON("generated_posts.json"))
      ? loadJSON("generated_posts.json")
      : [];
    const posts = [...existingPosts];
    const targetCount = Math.min(POST_COUNT, headlines.length);
    const resumeStartIndex = posts.length;

    if (posts.length >= targetCount) {
      log(
        `Already generated ${posts.length} posts. Target is ${targetCount}. Nothing to do.`,
        "INFO",
      );
      return;
    }

    let successCount = 0;
    let failureCount = 0;
    let rateLimitRetries = 0;

    log(
      `Resuming generation from post ${resumeStartIndex + 1}. Already saved: ${posts.length}.`,
      "INFO",
    );

    for (let i = resumeStartIndex; i < targetCount; i++) {
      try {
        const angle = selectUniqueAngle();
        const post = await generateUniqueContent(headlines[i], angle);

        // Fetch featured image if enabled
        if (process.env.INCLUDE_IMAGES !== "false") {
          const imageUrl = await fetchFeaturedImage(post.keyword);
          if (imageUrl) {
            post.featured_image_url = imageUrl;
            log(`Image: ${imageUrl.substring(0, 50)}...`, "IMAGE");
          }
        }

        posts.push(post);
        successCount++;

        console.log(
          `  [${i + 1}/${POST_COUNT}] ✅ "${post.title.substring(0, 60)}" [${post.categoryName}]`,
        );

        // Rate limiting - be nice to APIs
        if (i % 5 === 0 && i > 0) {
          console.log("  (rate limiting - waiting 3 seconds)");
          await delay(3000);
        }
      } catch (error) {
        if (error.response?.status === 429) {
          rateLimitRetries++;
          console.log(
            `  [${i + 1}/${POST_COUNT}] ⏳ Groq rate limit reached. Ending the current generation loop.`,
          );
          log(
            `Groq rate limit reached after ${rateLimitRetries} stop point(s). Ending the current run.`,
            "WARN",
          );
          saveJSON("generated_posts.json", posts);
          break;
        }

        failureCount++;
        console.log(
          `  [${i + 1}/${POST_COUNT}] ❌ Failed - ${error.message.substring(0, 50)}`,
        );
        log(`Generation failed for: ${headlines[i].title}`, "ERROR");
      }

      if (
        posts.length > 0 &&
        (posts.length - existingPosts.length) % GROQ_BATCH_SIZE === 0
      ) {
        log(
          `Completed batch of ${GROQ_BATCH_SIZE}. Waiting ${Math.max(GROQ_RATE_LIMIT_DELAY_MS, 30000) / 1000}s before continuing...`,
          "WARN",
        );
        await delay(Math.max(GROQ_RATE_LIMIT_DELAY_MS, 30000));
      }
    }

    // Save posts
    saveJSON("generated_posts.json", posts);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📊 Generation Summary:");
    console.log(`   ✅ Success: ${successCount} posts`);
    console.log(`   ❌ Failed: ${failureCount} posts`);
    console.log(`   Words per post: ${WORDS_PER_POST}`);
    console.log(
      `   Uniqueness check: ${CHECK_UNIQUENESS ? "Enabled" : "Disabled"}`,
    );
    console.log(
      `   Images: ${process.env.INCLUDE_IMAGES !== "false" ? "Enabled" : "Disabled"}`,
    );
    console.log("\n💾 Saved to: generated_posts.json");
    console.log("✨ Next: node src/post-to-wordpress.js\n");
    console.log("═══════════════════════════════════════════════════════\n");

    log(`Generated ${successCount} posts successfully`, "SUCCESS");
  } catch (error) {
    log(`Fatal error: ${error.message}`, "ERROR");
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();

// const axios = require("axios");
// const fs = require("fs");
// const crypto = require("crypto");
// const { log, loadJSON, saveJSON } = require("./utils");
// require("dotenv").config();

// const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
// const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022";
// const UNSPLASH_API_KEY = process.env.UNSPLASH_API_KEY;
// const POSTS_PER_DAY = parseInt(process.env.POSTS_PER_DAY) || 50;
// const WORDS_PER_POST = parseInt(process.env.WORDS_PER_POST) || 1000;

// // Validate API keys
// if (!CLAUDE_API_KEY) {
//   log("Missing CLAUDE_API_KEY in .env file", "ERROR");
//   console.error("❌ Missing CLAUDE_API_KEY in .env file");
//   console.error("Get it from: https://console.anthropic.com/account/keys");
//   process.exit(1);
// }

// if (!UNSPLASH_API_KEY) {
//   log("Missing UNSPLASH_API_KEY in .env file", "ERROR");
//   console.error("❌ Missing UNSPLASH_API_KEY in .env file");
//   console.error("Get it from: https://unsplash.com/api");
//   process.exit(1);
// }

// // Calculate similarity between two texts (simple check)
// function calculateSimilarity(text1, text2) {
//   const normalize = (text) => text.toLowerCase().replace(/[^\w]/g, "");
//   const t1 = normalize(text1);
//   const t2 = normalize(text2);

//   let matches = 0;
//   for (let i = 0; i < Math.min(t1.length, t2.length); i++) {
//     if (t1[i] === t2[i]) matches++;
//   }
//   return matches / Math.max(t1.length, t2.length);
// }

// // Fetch image from Unsplash
// async function fetchImageFromUnsplash(query) {
//   try {
//     const response = await axios.get(
//       `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1`,
//       {
//         headers: { Authorization: `Client-ID ${UNSPLASH_API_KEY}` },
//       },
//     );

//     if (response.data.results && response.data.results.length > 0) {
//       return response.data.results[0].urls.regular;
//     }
//   } catch (error) {
//     log(`Unsplash error for "${query}": ${error.message}`, "WARN");
//   }

//   return null;
// }

// // Generate unique post using Claude API
// async function generatePostWithClaude(headline, category) {
//   try {
//     const prompt = `Write a unique, original ${WORDS_PER_POST}-word blog post about: "${headline}"

// Category: ${category}

// Requirements:
// 1. Completely unique content (don't copy from anywhere)
// 2. Include relevant information about smartphones/tech
// 3. Target Indian audience where relevant
// 4. Include specific details, not generic statements
// 5. Make it SEO-friendly with keyword density
// 6. Include practical tips or insights
// 7. Format with clear paragraphs

// Start writing the post directly without any preamble.`;

//     const response = await axios.post(
//       "https://api.anthropic.com/v1/messages",
//       {
//         model: CLAUDE_MODEL,
//         max_tokens: 2000,
//         messages: [
//           {
//             role: "user",
//             content: prompt,
//           },
//         ],
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${CLAUDE_API_KEY}`,
//           "Content-Type": "application/json",
//         },
//       },
//     );

//     if (response.data.content && response.data.content.length > 0) {
//       return response.data.content[0].text;
//     }
//   } catch (error) {
//     if (error.response?.status === 401) {
//       throw new Error("Invalid Claude API key");
//     }
//     throw error;
//   }

//   return null;
// }

// // Main generation function
// async function generateUniquePosts() {
//   try {
//     console.log("\n═══════════════════════════════════════════════════════");
//     console.log("📝 Generating Unique Blog Posts");
//     console.log("═══════════════════════════════════════════════════════\n");

//     // Load headlines
//     const headlines = loadJSON("tech_headlines.json");
//     if (!headlines || headlines.length === 0) {
//       console.error("❌ No headlines found. Run: node src/fetch-content.js");
//       process.exit(1);
//     }

//     const postsToGenerate = Math.min(POSTS_PER_DAY, headlines.length);
//     console.log(`📋 Headlines loaded: ${headlines.length}`);
//     console.log(`🎯 Generating: ${postsToGenerate} posts\n`);

//     const generatedPosts = [];
//     let successCount = 0;
//     let failureCount = 0;

//     for (let i = 0; i < postsToGenerate; i++) {
//       const headline = headlines[i];
//       console.log(
//         `\n[${i + 1}/${postsToGenerate}] Generating: "${headline.title.substring(0, 50)}..."`,
//       );

//       try {
//         // Generate content
//         console.log("  ⏳ Writing content...");
//         const content = await generatePostWithClaude(
//           headline.title,
//           headline.category || "Tech News",
//         );

//         if (!content) {
//           throw new Error("No content generated");
//         }

//         // Fetch image
//         console.log("  🖼️  Fetching featured image...");
//         const imageUrl = await fetchImageFromUnsplash(headline.title);

//         // Create post object
//         const post = {
//           id: i + 1,
//           title: headline.title,
//           content: content,
//           category: headline.category || "Tech News",
//           categoryId: headline.categoryId || 8,
//           excerpt: content.substring(0, 160),
//           imageUrl: imageUrl,
//           sourceUrl: headline.source_url,
//           generatedAt: new Date().toISOString(),
//           wordCount: content.split(/\s+/).length,
//         };

//         generatedPosts.push(post);
//         successCount++;
//         console.log(`  ✅ Post created (${post.wordCount} words)`);

//         // Rate limiting
//         if ((i + 1) % 5 === 0) {
//           console.log("  ⏸️  Rate limiting (waiting 2 seconds)...");
//           await new Promise((resolve) => setTimeout(resolve, 2000));
//         }
//       } catch (error) {
//         failureCount++;
//         console.log(`  ❌ Failed: ${error.message}`);
//       }
//     }

//     // Save results
//     saveJSON("generated_posts.json", generatedPosts);

//     // Summary
//     console.log("\n═══════════════════════════════════════════════════════");
//     console.log("📊 Generation Summary:");
//     console.log(`   ✅ Success: ${successCount} posts`);
//     console.log(`   ❌ Failed: ${failureCount} posts`);
//     console.log(`   📁 Saved to: generated_posts.json`);
//     console.log("═══════════════════════════════════════════════════════\n");

//     log(`Generated ${successCount} posts with Claude API`, "SUCCESS");
//   } catch (error) {
//     log(`Fatal error: ${error.message}`, "ERROR");
//     console.error("❌ Error:", error.message);
//     process.exit(1);
//   }
// }

// // Run
// generateUniquePosts();
