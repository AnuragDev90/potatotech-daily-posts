const Groq = require('groq-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const USE_GROQ = process.env.USE_GROQ === 'true';

if (USE_GROQ && !GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY not set in .env but USE_GROQ is enabled');
  process.exit(1);
}

const GROQ_MODELS = {
  mixtral: 'gemma-7b-it',                   // Stable, reliable
  llama2: 'llama2-70b-4096',                // Proven stable
  llama3: 'llama-3.1-405b-reasoning'        // Latest reasoning
};

const CONFIG = {
  groqMaxTokens: 4000,
  groqTemperature: 0.8,
  groqTopP: 0.9,
  groqTimeout: 60000, // 60 seconds
  imageTimeout: 30000, // 30 seconds
  minWordCount: 3000,
  pollinations: {
    baseUrl: 'https://pollinations.ai/p',
    imageWidth: 1200,
    imageHeight: 630
  }
};

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// ═══════════════════════════════════════════════════════════════
// LOGGING & UTILITIES
// ═══════════════════════════════════════════════════════════════

function log(prefix, message) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] [${prefix}] ${message}`);
}

function createGroqPrompt(storyPrompt) {
  const sections = storyPrompt.structure.sections
    .map(s => `- ${s.heading}: ${s.instructions} (${s.word_count} words)`)
    .join('\n');

  const redditQuotes = (storyPrompt.reddit_quotes || [])
    .map((quote, i) => `${i + 1}. "${quote}"`)
    .join('\n');

  const keywords = (storyPrompt.seo_tips?.keywords_to_hit || []).join(', ');

  return `You are an expert tech journalist and SEO writer creating a comprehensive, authoritative article.

ARTICLE BRIEF
=============
Title: ${storyPrompt.structure.title}
Primary Keyword: ${storyPrompt.keyword}
Search Intent: ${storyPrompt.intent}
Target Audience: ${storyPrompt.audience}
Content Angle: ${storyPrompt.content_angle}

REQUIRED STRUCTURE (Minimum 3,000 words total)
==============================================
${sections}

SEO REQUIREMENTS
================
Primary Keyword: "${storyPrompt.keyword}"
Keywords to naturally include: ${keywords}
Meta Description (for reference): ${storyPrompt.seo_tips?.meta_description}
Schema Type: ${storyPrompt.seo_tips?.schema_type}

REAL USER INSIGHTS TO WEAVE IN NATURALLY
==========================================
${redditQuotes || 'No quotes available'}

WRITING INSTRUCTIONS
====================
1. Write naturally and authoritatively - this is expert advice, not AI-generated content
2. Include ALL sections from the structure above with proper word counts
3. Weave in the Reddit quotes naturally as evidence/real experiences
4. Use keywords naturally throughout without keyword stuffing
5. Format with clear H2 and H3 headings, bullet points, and emphasis
6. Include practical, actionable information
7. Minimum 3,000 words - aim for 3,200+
8. End with a clear call to action: "${storyPrompt.cta || 'Share your experience in the comments below!'}"

TONE & STYLE
============
- Expert, helpful, conversational, honest
- Write like you're talking to a friend who trusts your expertise
- Back up claims with logic and user experiences

NOW WRITE THE COMPLETE ARTICLE. START WITH THE TITLE, THEN THE FULL CONTENT.`;
}

// ═══════════════════════════════════════════════════════════════
// GROQ ARTICLE GENERATION
// ═══════════════════════════════════════════════════════════════

async function generateArticleWithGroq(storyPrompt, modelName = 'mixtral') {
  if (!groq) {
    throw new Error('GROQ API key is not configured. Set GROQ_API_KEY in .env and USE_GROQ=true');
  }

  const model = GROQ_MODELS[modelName] || GROQ_MODELS.mixtral;
  const startTime = Date.now();

  log('GROQ', `🚀 Generating article: "${storyPrompt.keyword}"`);
  log('GROQ', `📊 Model: ${model}`);

  try {
    const prompt = createGroqPrompt(storyPrompt);

    const response = await groq.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      model: model,
      max_tokens: CONFIG.groqMaxTokens,
      temperature: CONFIG.groqTemperature,
      top_p: CONFIG.groqTopP
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content received from Groq');
    }

    // Count words
    const wordCount = content.split(/\s+/).length;

    if (wordCount < CONFIG.minWordCount) {
      log('GROQ', `⚠️  Generated content too short (${wordCount} words, need ${CONFIG.minWordCount})`);
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    log('GROQ', `✅ Generated ${wordCount} words in ${duration} minutes`);

    return {
      content,
      wordCount,
      model,
      generationTime: duration,
      tokensUsed: response.usage?.completion_tokens
    };
  } catch (error) {
    if (error.status === 429) {
      log('GROQ', `⚠️  Rate limited (429). Waiting 30 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 30000));
      return generateArticleWithGroq(storyPrompt, modelName); // Retry
    }

    log('GROQ', `❌ Error: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// POLLINATIONS AI IMAGE GENERATION
// ═══════════════════════════════════════════════════════════════

function generateImageUrl(keyword) {
  const imagePrompt = `${keyword}, professional tech review article header image, high quality, 2026, modern design, clean layout`;
  const encodedPrompt = encodeURIComponent(imagePrompt);
  const seed = Math.floor(Date.now() / 1000);

  const url = `${CONFIG.pollinations.baseUrl}/${encodedPrompt}?width=${CONFIG.pollinations.imageWidth}&height=${CONFIG.pollinations.imageHeight}&seed=${seed}`;

  return url;
}

async function verifyImageUrl(imageUrl) {
  try {
    log('IMAGE', `🔍 Verifying image URL...`);

    const response = await axios.head(imageUrl, {
      timeout: CONFIG.imageTimeout,
      maxRedirects: 5
    });

    if (response.status === 200) {
      log('IMAGE', `✅ Image verified successfully`);
      return true;
    }
  } catch (error) {
    log('IMAGE', `⚠️  Could not verify image (${error.message})`);
  }

  return false;
}

async function generateFeaturedImage(keyword) {
  log('IMAGE', `🎨 Generating featured image for: "${keyword}"`);

  try {
    const imageUrl = generateImageUrl(keyword);

    // Verify the image URL works
    const isValid = await verifyImageUrl(imageUrl);

    if (isValid) {
      log('IMAGE', `✅ Generated: ${imageUrl}`);
      return imageUrl;
    }

    log('IMAGE', `⚠️  Image generation returned unverified URL, using anyway`);
    return imageUrl;

  } catch (error) {
    log('IMAGE', `❌ Error: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ARTICLE GENERATION FUNCTION
// ═══════════════════════════════════════════════════════════════

async function generateDeepArticle(storyPrompt, modelName = 'mixtral') {
  const startTime = Date.now();

  log('ARTICLE', `\n═══════════════════════════════════════════════════════`);
  log('ARTICLE', `GENERATING ARTICLE: ${storyPrompt.keyword}`);
  log('ARTICLE', `═══════════════════════════════════════════════════════`);

  try {
    // Generate article content with Groq
    const articleResult = await generateArticleWithGroq(storyPrompt, modelName);

    if (!articleResult) {
      log('ARTICLE', `❌ Failed to generate article content`);
      return null;
    }

    // Generate featured image with Pollinations
    log('IMAGE', `\n`);
    const featuredImageUrl = await generateFeaturedImage(storyPrompt.keyword);

    // Extract title from content (first line)
    const lines = articleResult.content.split('\n').filter(l => l.trim());
    let title = lines[0]?.replace(/^#+\s*/, '').trim() || storyPrompt.structure.title;

    // Remove markdown formatting if present
    title = title.replace(/[#*`]/g, '').trim();

    // Calculate generation time
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    // Build final article object
    const article = {
      title: title,
      content: articleResult.content,
      featured_image_url: featuredImageUrl || null,
      word_count: articleResult.wordCount,
      model_used: articleResult.model,
      tokens_used: articleResult.tokensUsed,
      seo_metadata: {
        meta_description: storyPrompt.seo_tips?.meta_description || `Complete guide to ${storyPrompt.keyword}`,
        keywords: storyPrompt.seo_tips?.keywords_to_hit || [storyPrompt.keyword],
        schema_type: storyPrompt.seo_tips?.schema_type || 'Article'
      },
      timestamp: new Date().toISOString(),
      generation_time_minutes: totalTime,
      content_angle: storyPrompt.content_angle
    };

    log('ARTICLE', `\n✅ ARTICLE COMPLETE`);
    log('ARTICLE', `   Title: ${article.title}`);
    log('ARTICLE', `   Words: ${article.word_count}`);
    log('ARTICLE', `   Model: ${article.model_used}`);
    log('ARTICLE', `   Image: ${article.featured_image_url ? '✅ Yes' : '❌ No'}`);
    log('ARTICLE', `   Time: ${article.generation_time_minutes} minutes`);
    log('ARTICLE', `═══════════════════════════════════════════════════════\n`);

    return article;

  } catch (error) {
    log('ARTICLE', `❌ Fatal error: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// BATCH GENERATION
// ═══════════════════════════════════════════════════════════════

async function generateMultipleArticles(storyPrompts, modelName = 'mixtral') {
  log('BATCH', `\n🚀 Starting batch generation for ${storyPrompts.length} articles`);

  const articles = [];
  const errors = [];

  for (let i = 0; i < storyPrompts.length; i++) {
    const prompt = storyPrompts[i];

    log('BATCH', `\n[${i + 1}/${storyPrompts.length}] Processing: ${prompt.keyword}`);

    try {
      const article = await generateDeepArticle(prompt, modelName);

      if (article) {
        articles.push(article);
      } else {
        errors.push(prompt.keyword);
      }
    } catch (error) {
      log('BATCH', `❌ Error processing ${prompt.keyword}: ${error.message}`);
      errors.push(prompt.keyword);
    }

    // Rate limiting between articles (Groq: 30 req/min = 1 every 2 seconds)
    if (i < storyPrompts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  log('BATCH', `\n═══════════════════════════════════════════════════════`);
  log('BATCH', `BATCH COMPLETE`);
  log('BATCH', `Generated: ${articles.length}/${storyPrompts.length}`);
  log('BATCH', `Failed: ${errors.length}`);
  if (errors.length > 0) {
    log('BATCH', `Errors: ${errors.join(', ')}`);
  }
  log('BATCH', `═══════════════════════════════════════════════════════\n`);

  return {
    successful: articles,
    failed: errors,
    total: storyPrompts.length
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

module.exports = {
  generateDeepArticle,
  generateMultipleArticles,
  GROQ_MODELS
};

// ═══════════════════════════════════════════════════════════════
// CLI USAGE (for testing)
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  // Test with a sample story prompt
  const samplePrompt = {
    keyword: 'iPhone 16 battery drain fix',
    intent: 'informational',
    audience: 'iPhone 16 users with battery problems',
    structure: {
      title: 'iPhone 16 Battery Drain: Complete Fix Guide (2026)',
      sections: [
        { heading: 'Introduction', instructions: 'Hook with problem, preview solutions', word_count: 300 },
        { heading: 'Understanding the Issue', instructions: 'Explain what, why, which models affected', word_count: 500 },
        { heading: 'Step-by-Step Fixes', instructions: 'Detailed solutions with Reddit insights', word_count: 800 },
        { heading: 'Pro Tips', instructions: 'Additional recommendations', word_count: 400 },
        { heading: 'Conclusion', instructions: 'Summary and next steps', word_count: 200 }
      ]
    },
    reddit_quotes: [
      'Try disabling Background App Refresh and location services. That fixed it for me completely.',
      'After the iOS update, my battery was dying in 2 hours.',
      'Check your battery health in Settings > Battery > Battery Health & Charging'
    ],
    seo_tips: {
      meta_description: 'Expert guide to fixing iPhone 16 battery drain with real solutions from users.',
      keywords_to_hit: ['iPhone 16 battery drain', 'battery fix', 'background app refresh'],
      schema_type: 'HowToArticle'
    },
    content_angle: 'Real user solutions combined with official Apple recommendations',
    cta: 'Try these fixes and let us know which one worked for you in the comments!'
  };

  // Generate article
  generateDeepArticle(samplePrompt, 'mixtral')
    .then(article => {
      if (article) {
        console.log('\n✅ Article generated successfully!');
        console.log(`Title: ${article.title}`);
        console.log(`Words: ${article.word_count}`);
        console.log(`Image: ${article.featured_image_url}`);
        console.log(`Time: ${article.generation_time_minutes} minutes`);
      }
    })
    .catch(error => {
      console.error('❌ Generation failed:', error);
      process.exit(1);
    });
}
