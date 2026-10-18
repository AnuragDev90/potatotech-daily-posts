const axios = require('axios');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL_CONFIG = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set in .env');
  process.exit(1);
}

const OPENAI_MODELS = {
  gpt4: 'gpt-4-turbo',
  'gpt-4': 'gpt-4-turbo',
  'gpt-4-turbo': 'gpt-4-turbo',
  'gpt-4-turbo-preview': 'gpt-4-turbo',
  gpt4o: 'gpt-4o',
  'gpt-4o': 'gpt-4o',
  gpt35: 'gpt-3.5-turbo',
  'gpt-3.5-turbo': 'gpt-3.5-turbo'
};

function getModelId(modelName) {
  return OPENAI_MODELS[modelName] || OPENAI_MODEL_CONFIG;
}

const OPENAI_MODEL = getModelId(OPENAI_MODEL_CONFIG);

const CONFIG = {
  openaiMaxTokens: 4096,
  openaiTemperature: 0.8,
  openaiTopP: 0.9,
  openaiTimeout: 120000, // 120 seconds
  imageTimeout: 30000, // 30 seconds
  minWordCount: 1000,
  pollinations: {
    baseUrl: 'https://image.pollinations.ai/prompt',
    imageWidth: 1200,
    imageHeight: 630
  }
};

// ═══════════════════════════════════════════════════════════════
// LOGGING & UTILITIES
// ═══════════════════════════════════════════════════════════════

function log(prefix, message) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] [${prefix}] ${message}`);
}

function createPrompt(storyPrompt) {
  const sections = storyPrompt.structure.sections
    .map(s => `- ${s.heading}: ${s.instructions} (${s.word_count} words)`)
    .join('\n');

  const redditQuotes = (storyPrompt.reddit_quotes || [])
    .map((quote, i) => `${i + 1}. "${quote}"`)
    .join('\n');

  const keywords = ((storyPrompt.seo_tips || storyPrompt.seo_optimization)?.keywords_to_hit || []).join(', ');

  return `You are an expert tech journalist and SEO writer creating a comprehensive, authoritative article.

ARTICLE BRIEF
=============
Title: ${storyPrompt.structure.title}
Primary Keyword: ${storyPrompt.keyword}
Search Intent: ${storyPrompt.intent}
Target Audience: ${storyPrompt.audience}
Content Angle: ${storyPrompt.content_angle}

REQUIRED STRUCTURE (Target ~1,200 words total)
==============================================
${sections}

SEO REQUIREMENTS
================
Primary Keyword: "${storyPrompt.keyword}"
Keywords to naturally include: ${keywords}
Meta Description (for reference): ${(storyPrompt.seo_tips || storyPrompt.seo_optimization)?.meta_description}
Schema Type: ${(storyPrompt.seo_tips || storyPrompt.seo_optimization)?.schema_type}

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
7. Total length MUST be 1,200-1,400 words. Treat each section's word count as a MINIMUM and write fully developed paragraphs; do not stop early or summarize
8. End with a clear call to action: "${storyPrompt.cta || 'Share your experience in the comments below!'}"

TONE & STYLE
============
- Expert, helpful, conversational, honest
- Write like you're talking to a friend who trusts your expertise
- Back up claims with logic and user experiences

NOW WRITE THE COMPLETE ARTICLE. START WITH THE TITLE, THEN THE FULL CONTENT.`;
}

// ═══════════════════════════════════════════════════════════════
// OPENAI ARTICLE GENERATION
// ═══════════════════════════════════════════════════════════════

async function generateArticleWithOpenAI(storyPrompt, modelName = null) {
  // Use .env model if no modelName provided
  const modelToUse = modelName || OPENAI_MODEL_CONFIG;
  const model = getModelId(modelToUse);
  const startTime = Date.now();

  log('OPENAI', `🚀 Generating article: "${storyPrompt.keyword}"`);
  log('OPENAI', `📊 Model: ${model}`);

  try {
    const prompt = createPrompt(storyPrompt);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert tech journalist and SEO writer.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: CONFIG.openaiMaxTokens,
        temperature: CONFIG.openaiTemperature,
        top_p: CONFIG.openaiTopP
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: CONFIG.openaiTimeout
      }
    );

    const content = response.data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content received from OpenAI');
    }

    // Count words
    const wordCount = content.split(/\s+/).length;

    if (wordCount < CONFIG.minWordCount) {
      log('OPENAI', `⚠️  Generated content too short (${wordCount} words, need ${CONFIG.minWordCount})`);
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    log('OPENAI', `✅ Generated ${wordCount} words in ${duration} minutes`);

    return {
      content,
      wordCount,
      model,
      generationTime: duration,
      tokensUsed: response.data.usage?.completion_tokens
    };
  } catch (error) {
    if (error.response?.data?.error?.type === 'insufficient_quota') {
      log('OPENAI', `❌ ${error.response.data.error.message}`);
      throw new Error('OpenAI account has no credits (insufficient_quota). Add billing credits or switch to Groq.');
    }
    if (error.response?.status === 429) {
      log('OPENAI', `⚠️  Rate limited (429). Waiting 30 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 30000));
      return generateArticleWithOpenAI(storyPrompt, modelName); // Retry
    }

    if (error.response?.status === 401) {
      log('OPENAI', `❌ Authentication failed (401): Invalid API key`);
      log('OPENAI', `   Check OPENAI_API_KEY in .env file`);
    } else if (error.response?.status === 404) {
      log('OPENAI', `❌ Not found (404): Invalid model or endpoint`);
      log('OPENAI', `   Model: ${model}`);
      log('OPENAI', `   Endpoint: https://api.openai.com/v1/chat/completions`);
      if (error.response?.data?.error) {
        log('OPENAI', `   Details: ${error.response.data.error.message}`);
      }
    } else if (error.response?.status === 429) {
      log('OPENAI', `⚠️  Rate limited (429)`);
    } else if (error.response) {
      log('OPENAI', `❌ API Error (${error.response.status}): ${error.response.statusText}`);
      if (error.response?.data?.error) {
        log('OPENAI', `   Details: ${error.response.data.error.message}`);
      }
    } else if (error.request) {
      log('OPENAI', `❌ Network Error: No response received`);
      log('OPENAI', `   Check internet connection`);
    } else {
      log('OPENAI', `❌ Error: ${error.message}`);
    }
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

  return `${CONFIG.pollinations.baseUrl}/${encodedPrompt}?width=${CONFIG.pollinations.imageWidth}&height=${CONFIG.pollinations.imageHeight}&seed=${seed}&nologo=true`;
}

async function verifyImageUrl(imageUrl) {
  try {
    const response = await axios.head(imageUrl, { timeout: CONFIG.imageTimeout });
    return response.status === 200 && String(response.headers['content-type'] || '').startsWith('image/');
  } catch (error) {
    log('IMAGE', `⚠️  Image verification failed: ${error.message}`);
    return false;
  }
}

async function generateFeaturedImage(keyword) {
  log('IMAGE', `🎨 Generating featured image for: "${keyword}"`);

  try {
    const imageUrl = generateImageUrl(keyword);
    const isValid = await verifyImageUrl(imageUrl);

    if (isValid) {
      log('IMAGE', `✅ Featured image ready: ${imageUrl}`);
      return imageUrl;
    } else {
      log('IMAGE', `❌ Failed to generate image`);
      return null;
    }
  } catch (error) {
    log('IMAGE', `❌ Image generation error: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// DEEP ARTICLE GENERATION (WITH IMAGE)
// ═══════════════════════════════════════════════════════════════

async function generateDeepArticle(storyPrompt, modelName = null) {
  log('DEEP', `📝 Starting deep article generation for: "${storyPrompt.keyword}"`);

  try {
    // Generate content and image in parallel
    const [articleResult, imageUrl] = await Promise.all([
      generateArticleWithOpenAI(storyPrompt, modelName),
      generateFeaturedImage(storyPrompt.keyword)
    ]);

    if (!articleResult) {
      log('DEEP', `❌ Failed to generate article content`);
      return null;
    }

    const article = {
      keyword: storyPrompt.keyword,
      title: storyPrompt.structure.title,
      content: articleResult.content,
      wordCount: articleResult.wordCount,
      generationTime: articleResult.generationTime,
      tokensUsed: articleResult.tokensUsed,
      featuredImage: imageUrl,
      model: articleResult.model,
      createdAt: new Date().toISOString()
    };

    log('DEEP', `✅ Deep article generation complete`);
    return article;
  } catch (error) {
    log('DEEP', `❌ Error during deep article generation: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// BATCH ARTICLE GENERATION
// ═══════════════════════════════════════════════════════════════

async function generateMultipleArticles(storyPrompts, modelName = null) {
  log('BATCH', `📚 Starting batch generation of ${storyPrompts.length} articles`);
  log('BATCH', `🤖 Using model: ${OPENAI_MODELS[modelName] || OPENAI_MODEL}`);

  const results = {
    success: [],
    failed: [],
    startTime: new Date().toISOString()
  };

  for (let i = 0; i < storyPrompts.length; i++) {
    const prompt = storyPrompts[i];
    log('BATCH', `[${i + 1}/${storyPrompts.length}] Processing: "${prompt.keyword}"`);

    try {
      const article = await generateDeepArticle(prompt, modelName);

      if (article) {
        results.success.push(article);
        log('BATCH', `✅ [${i + 1}/${storyPrompts.length}] Success`);
      } else {
        results.failed.push({ keyword: prompt.keyword, reason: 'Generation returned null' });
        log('BATCH', `❌ [${i + 1}/${storyPrompts.length}] Failed`);
      }

      // Add delay between requests to avoid rate limiting (3 seconds)
      if (i < storyPrompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      results.failed.push({ keyword: prompt.keyword, reason: error.message });
      log('BATCH', `❌ [${i + 1}/${storyPrompts.length}] Error: ${error.message}`);
    }
  }

  results.endTime = new Date().toISOString();
  results.summary = {
    total: storyPrompts.length,
    successful: results.success.length,
    failed: results.failed.length,
    successRate: `${((results.success.length / storyPrompts.length) * 100).toFixed(1)}%`
  };

  log('BATCH', `\n📊 BATCH RESULTS`);
  log('BATCH', `✅ Generated: ${results.success.length}`);
  log('BATCH', `❌ Failed: ${results.failed.length}`);
  log('BATCH', `📈 Success Rate: ${results.summary.successRate}`);

  return results;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  generateDeepArticle,
  generateMultipleArticles,
  OPENAI_MODELS
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
        { heading: 'Why Is My iPhone 16 Battery Draining Fast?', instructions: 'Technical reasons, common causes', word_count: 400 },
        { heading: 'Quick Fixes You Can Try Now', instructions: 'Step-by-step solutions', word_count: 600 },
        { heading: 'Advanced Troubleshooting', instructions: 'For persistent issues', word_count: 500 },
        { heading: 'Best Practices to Prevent Battery Drain', instructions: 'Long-term solutions', word_count: 400 },
        { heading: 'When to Contact Apple Support', instructions: 'Hardware vs software issues', word_count: 300 },
        { heading: 'Conclusion', instructions: 'Summary and final CTA', word_count: 200 }
      ]
    },
    content_angle: 'practical troubleshooting guide',
    reddit_quotes: [
      "My iPhone 16 was dying in 2 hours, these steps literally saved my phone",
      "The iOS optimization tips really made a difference in my battery life"
    ],
    seo_tips: {
      keywords_to_hit: ['iPhone 16 battery', 'battery drain', 'iOS 18 battery fix', 'fast charging damage'],
      meta_description: 'Complete guide to fixing iPhone 16 battery drain. Learn why your battery drains fast and how to fix it.',
      schema_type: 'HowTo'
    },
    cta: 'Which solution worked best for you? Share in the comments!'
  };

  (async () => {
    try {
      log('TEST', '🧪 Starting test generation with OpenAI...');
      const result = await generateDeepArticle(samplePrompt);

      if (result) {
        log('TEST', '✅ Test successful!');
        log('TEST', `Generated: ${result.wordCount} words`);
        log('TEST', `Image: ${result.featuredImage ? '✅' : '❌'}`);
      } else {
        log('TEST', '❌ Test failed - no result');
      }
    } catch (error) {
      log('TEST', `❌ Test error: ${error.message}`);
      process.exit(1);
    }
  })();
}
