const fs = require('fs');
const path = require('path');
const { generateDeepArticle } = require('./generate-posts-openai');
const { log, saveJSON } = require('./utils');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  articlesPerRun: parseInt(process.env.GENERATE_MAX_POSTS || '50'),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
  autoPublish: process.env.AUTO_PUBLISH === 'true',
  delayBetweenPosts: 3000, // 3 seconds between posts (organic)
  includeImages: process.env.INCLUDE_IMAGES !== 'false',
  emailOnCompletion: process.env.EMAIL_ENABLED === 'true',
  timestampFormat: new Date().toLocaleString()
};

const WORDPRESS_SITE = process.env.WORDPRESS_SITE;
const WORDPRESS_USERNAME = process.env.WORDPRESS_USERNAME;
const WORDPRESS_PASSWORD = process.env.WORDPRESS_PASSWORD;

// ═══════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════

let errorLog = [];

function logStep(message) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] ${message}`);
  log(message, 'INFO');
}

function logError(message, error) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] ❌ ${message}`);
  if (error) console.log(`     ${error.message}`);
  log(`${message} - ${error?.message || ''}`, 'ERROR');
  errorLog.push({ timestamp: new Date().toISOString(), message, error: error?.message });
}

// ═══════════════════════════════════════════════════════════════
// LOAD STORY PROMPTS
// ═══════════════════════════════════════════════════════════════

function loadStoryPrompts() {
  try {
    const filePath = path.join(__dirname, '..', 'story_prompts.json');
    const data = fs.readFileSync(filePath, 'utf-8');
    const prompts = JSON.parse(data);
    logStep(`📋 Loaded ${prompts.length} story prompts`);
    return prompts;
  } catch (error) {
    logError('Failed to load story prompts', error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// GENERATE ARTICLES
// ═══════════════════════════════════════════════════════════════

async function generateArticles(storyPrompts) {
  const articles = [];
  const startTime = Date.now();

  logStep(`🚀 Starting OpenAI article generation for ${storyPrompts.length} prompts`);
  logStep(`🤖 Model: ${CONFIG.openaiModel}`);

  for (let i = 0; i < storyPrompts.length; i++) {
    const prompt = storyPrompts[i];
    logStep(`\n[${i + 1}/${storyPrompts.length}] 📝 Generating: "${prompt.keyword}"`);

    try {
      const article = await generateDeepArticle(prompt, 'gpt4');

      if (article) {
        articles.push(article);
        logStep(`✅ [${i + 1}/${storyPrompts.length}] Article generated (${article.wordCount} words)`);
      } else {
        logError(`[${i + 1}/${storyPrompts.length}] Failed to generate article for: "${prompt.keyword}"`, null);
      }

      // Delay between articles
      if (i < storyPrompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPosts));
      }
    } catch (error) {
      logError(`[${i + 1}/${storyPrompts.length}] Error generating article for: "${prompt.keyword}"`, error);
    }
  }

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  logStep(`\n✅ Generation complete! Generated ${articles.length} articles in ${duration} minutes`);

  return articles;
}

// ═══════════════════════════════════════════════════════════════
// POST TO WORDPRESS
// ═══════════════════════════════════════════════════════════════

async function postToWordPress(articles) {
  if (!CONFIG.autoPublish) {
    logStep('⏸️  AUTO_PUBLISH is disabled. Articles generated but not posted.');
    logStep(`📁 Save articles to: generated_articles_${new Date().getTime()}.json`);
    return articles.length;
  }

  logStep(`📤 Publishing ${articles.length} articles to WordPress...`);
  let publishedCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];

    try {
      logStep(`[${i + 1}/${articles.length}] Publishing: "${article.title}"`);

      const auth = Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64');

      const postData = {
        title: article.title,
        content: article.content,
        status: 'publish',
        featured_media: 0,
        slug: article.title
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
      };

      // Post to WordPress
      const response = await fetch(`${WORDPRESS_SITE}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify(postData)
      });

      if (response.ok) {
        publishedCount++;
        logStep(`✅ [${i + 1}/${articles.length}] Published successfully`);
      } else {
        logError(`[${i + 1}/${articles.length}] Failed to publish (HTTP ${response.status})`, null);
      }

      // Delay between posts
      if (i < articles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPosts));
      }
    } catch (error) {
      logError(`[${i + 1}/${articles.length}] Error publishing article`, error);
    }
  }

  logStep(`\n📊 Publishing complete! ${publishedCount}/${articles.length} articles published`);
  return publishedCount;
}

// ═══════════════════════════════════════════════════════════════
// SAVE RESULTS
// ═══════════════════════════════════════════════════════════════

function saveResults(articles, publishedCount) {
  try {
    const timestamp = new Date().getTime();
    const resultsFile = path.join(__dirname, `..`, `orchestration_results_${timestamp}.json`);

    const results = {
      timestamp: new Date().toISOString(),
      config: CONFIG,
      summary: {
        total: articles.length,
        published: publishedCount,
        generated: articles.length
      },
      articles: articles.map(a => ({
        keyword: a.keyword,
        title: a.title,
        wordCount: a.wordCount,
        generationTime: a.generationTime,
        tokensUsed: a.tokensUsed,
        featuredImage: a.featuredImage ? '✅' : '❌',
        model: a.model
      })),
      errors: errorLog
    };

    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    logStep(`📊 Results saved to: ${resultsFile}`);

    return results;
  } catch (error) {
    logError('Failed to save results', error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATION
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🤖 OpenAI Article Generation Orchestrator');
  console.log('═'.repeat(60) + '\n');

  logStep(`⏰ Started at: ${CONFIG.timestampFormat}`);
  logStep(`🔧 Configuration:`);
  logStep(`   • Model: ${CONFIG.openaiModel}`);
  logStep(`   • Articles to generate: ${CONFIG.articlesPerRun}`);
  logStep(`   • Auto-publish: ${CONFIG.autoPublish ? '✅' : '❌'}`);
  logStep(`   • Generate images: ${CONFIG.includeImages ? '✅' : '❌'}`);

  try {
    // Load prompts
    const storyPrompts = loadStoryPrompts();

    if (storyPrompts.length === 0) {
      logError('No story prompts found', new Error('story_prompts.json not found or empty'));
      process.exit(1);
    }

    // Limit to configured amount
    const prompts = storyPrompts.slice(0, CONFIG.articlesPerRun);

    // Generate articles
    const articles = await generateArticles(prompts);

    if (articles.length === 0) {
      logError('No articles were generated', null);
      process.exit(1);
    }

    // Publish to WordPress
    const publishedCount = await postToWordPress(articles);

    // Save results
    const results = saveResults(articles, publishedCount);

    logStep(`\n✅ Orchestration complete!`);
    logStep(`📈 Summary:`);
    logStep(`   • Generated: ${articles.length} articles`);
    logStep(`   • Published: ${publishedCount} articles`);
    logStep(`   • Images: ${articles.filter(a => a.featuredImage).length}/${articles.length}`);

    console.log('\n' + '═'.repeat(60) + '\n');
  } catch (error) {
    logError('Fatal error during orchestration', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { generateArticles, postToWordPress };
