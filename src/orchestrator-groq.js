const fs = require('fs');
const path = require('path');
const { generateDeepArticle } = require('./generate-posts-groq');
const { log, saveJSON } = require('./utils');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  articlesPerRun: parseInt(process.env.GENERATE_MAX_POSTS || '50'),
  groqModel: process.env.GROQ_MODEL || 'gemma-7b-it',
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
    logStep('📂 Loading story prompts...');

    const data = fs.readFileSync('src/story_prompts.json', 'utf-8');
    const parsed = JSON.parse(data);
    const prompts = parsed.prompts || parsed;

    const topPrompts = prompts.slice(0, CONFIG.articlesPerRun);
    logStep(`✅ Loaded ${topPrompts.length} story prompts`);

    return topPrompts;
  } catch (error) {
    logError('Failed to load story prompts', error);
    console.log('   Run: npm run prompts');
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════
// GENERATE ARTICLE
// ═══════════════════════════════════════════════════════════════

async function generateArticle(prompt, index) {
  try {
    logStep(`   [${index + 1}/${CONFIG.articlesPerRun}] Generating: "${prompt.keyword.substring(0, 40)}"`);

    const article = await generateDeepArticle(prompt, CONFIG.groqModel);

    if (!article) {
      logError(`Generation failed for: ${prompt.keyword}`);
      return null;
    }

    return article;
  } catch (error) {
    logError(`Error generating article for ${prompt.keyword}`, error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// POST TO WORDPRESS
// ═══════════════════════════════════════════════════════════════

async function postArticleToWordPress(article, index) {
  try {
    // Import posting function
    const postToWordPress = require('./post-to-wordpress');

    logStep(`   [${index + 1}/${CONFIG.articlesPerRun}] Posting: "${article.title.substring(0, 40)}"`);

    const result = await postToWordPress(article, index);

    return result;
  } catch (error) {
    logError(`Error posting article: ${article.title}`, error);
    return { skipped: true, reason: 'posting_error', article_title: article.title };
  }
}

// ═══════════════════════════════════════════════════════════════
// CALCULATE METRICS
// ═══════════════════════════════════════════════════════════════

function calculateMetrics(articles) {
  if (articles.length === 0) {
    return {
      average: '0 minutes',
      fastest: '0 minutes',
      slowest: '0 minutes'
    };
  }

  const times = articles.map(a => parseFloat(a.generation_time_minutes || 0));
  const avgTime = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1);
  const fastestTime = Math.min(...times).toFixed(1);
  const slowestTime = Math.max(...times).toFixed(1);

  return {
    average: `${avgTime} minutes`,
    fastest: `${fastestTime} minutes`,
    slowest: `${slowestTime} minutes`
  };
}

// ═══════════════════════════════════════════════════════════════
// SEND EMAIL REPORT
// ═══════════════════════════════════════════════════════════════

async function sendEmailReport(results) {
  if (!CONFIG.emailOnCompletion) return;

  try {
    logStep('📧 Sending email report...');

    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const htmlContent = `
      <h2>Daily Blog Automation Report</h2>
      <p><strong>Date:</strong> ${results.run_timestamp}</p>

      <h3>Summary</h3>
      <p>${results.summary}</p>

      <h3>Statistics</h3>
      <ul>
        <li>Total Processed: ${results.total_processed}</li>
        <li>Published: ${results.published}</li>
        <li>Skipped: ${results.skipped}</li>
        <li>Failed: ${results.failed}</li>
      </ul>

      <h3>Generation Times</h3>
      <ul>
        <li>Average: ${results.generation_times.average}</li>
        <li>Fastest: ${results.generation_times.fastest}</li>
        <li>Slowest: ${results.generation_times.slowest}</li>
      </ul>

      <h3>Model Used</h3>
      <p>${CONFIG.groqModel}</p>

      <p><strong>Next Run:</strong> ${results.next_run}</p>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_RECIPIENT,
      subject: `📊 Daily Blog Report - ${results.published}/${results.total_processed} Published`,
      html: htmlContent,
    });

    logStep('✅ Email sent');
  } catch (error) {
    logError('Failed to send email', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// SAVE ERROR LOG
// ═══════════════════════════════════════════════════════════════

function saveErrorLog() {
  if (errorLog.length > 0) {
    const errorPath = 'error.log';
    const errorContent = errorLog
      .map(e => `[${e.timestamp}] ${e.message}\n${e.error || ''}`)
      .join('\n\n');

    fs.appendFileSync(errorPath, `\n\n${errorContent}`);
    logStep(`📝 Errors logged to: ${errorPath}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

async function runOrchestrator(count = 50, modelName = 'gemma-7b-it') {
  const runStartTime = Date.now();

  // Allow function parameters to override environment variables
  const articlesPerRun = count;
  const groqModel = modelName || process.env.GROQ_MODEL || 'gemma-7b-it';
  const autoPublish = process.env.AUTO_PUBLISH === 'true';
  const includeImages = process.env.INCLUDE_IMAGES !== 'false';
  const emailOnCompletion = process.env.EMAIL_ENABLED === 'true';
  const delayBetweenPosts = 3000;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🚀 ORCHESTRATOR: Groq + WordPress Pipeline');
  console.log('═══════════════════════════════════════════════════════\n');

  logStep(`Configuration:`);
  logStep(`   Model: ${groqModel}`);
  logStep(`   Articles: ${articlesPerRun}`);
  logStep(`   Auto-publish: ${autoPublish ? 'YES' : 'DRAFT'}`);
  logStep(`   Include images: ${includeImages ? 'YES' : 'NO'}\n`);

  // Validate WordPress config
  if (!WORDPRESS_SITE || !WORDPRESS_USERNAME || !WORDPRESS_PASSWORD) {
    logError('Missing WordPress configuration in .env');
    process.exit(1);
  }

  // Override CONFIG for this run
  CONFIG.articlesPerRun = articlesPerRun;
  CONFIG.groqModel = groqModel;
  CONFIG.autoPublish = autoPublish;
  CONFIG.includeImages = includeImages;
  CONFIG.emailOnCompletion = emailOnCompletion;
  CONFIG.delayBetweenPosts = delayBetweenPosts;

  // Load prompts
  const prompts = loadStoryPrompts();
  if (prompts.length === 0) {
    logError('No prompts available for generation');
    process.exit(1);
  }

  // Initialize results
  const results = {
    run_timestamp: CONFIG.timestampFormat,
    total_processed: prompts.length,
    published: 0,
    skipped: 0,
    failed: 0,
    generation_times: {},
    articles: [],
    summary: '',
    next_run: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString(),
    errors: []
  };

  console.log('');

  // Process each prompt
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];

    // Generate article
    logStep(`\n📝 STEP 1/3: GENERATE ARTICLE`);
    const article = await generateArticle(prompt, i);

    if (!article) {
      logStep(`⏭️  Skipping ${prompt.keyword} due to generation failure`);
      results.failed++;
      results.errors.push({
        title: prompt.keyword,
        reason: 'generation_failed'
      });

      if (i < prompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPosts));
      }
      continue;
    }

    // Post to WordPress
    logStep(`\n📤 STEP 2/3: POST TO WORDPRESS`);
    let postResult = null;

    try {
      const axios = require('axios');
      const FormData = require('form-data');
      const os = require('os');

      // Check for featured image
      if (!article.featured_image_url) {
        logStep(`⏭️  SKIPPING: No featured image`);
        results.skipped++;
        results.errors.push({
          title: article.title,
          reason: 'no_image'
        });
        postResult = null;
      } else {
        // Download and upload image
        try {
          logStep(`   📸 Uploading featured image...`);

          const imageResponse = await axios.get(article.featured_image_url, {
            responseType: 'arraybuffer',
            timeout: 10000
          });

          const filename = `featured-${Date.now()}.jpg`;
          const tempPath = path.join(os.tmpdir(), filename);
          fs.writeFileSync(tempPath, imageResponse.data);

          // Upload to WordPress
          const auth = Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64');
          const form = new FormData();
          form.append('file', fs.createReadStream(tempPath));

          const uploadResponse = await axios.post(
            `${WORDPRESS_SITE}/wp-json/wp/v2/media`,
            form,
            {
              headers: {
                ...form.getHeaders(),
                Authorization: `Basic ${auth}`
              },
              timeout: 30000
            }
          );

          fs.unlinkSync(tempPath);
          const mediaId = uploadResponse.data.id;

          logStep(`   ✅ Image uploaded (ID: ${mediaId})`);

          // Create post
          const payload = {
            title: article.title,
            content: article.content,
            excerpt: `${article.word_count} words`,
            status: CONFIG.autoPublish ? 'publish' : 'draft',
            featured_media: mediaId,
            categories: [1]
          };

          if (article.seo_metadata) {
            payload.meta = {
              _meta_description: article.seo_metadata.meta_description || '',
              _keywords: (article.seo_metadata.keywords || []).join(', ')
            };
          }

          const postResponse = await axios.post(
            `${WORDPRESS_SITE}/wp-json/wp/v2/posts`,
            payload,
            {
              headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json'
              },
              timeout: 15000
            }
          );

          logStep(`   ✅ Published (Post ID: ${postResponse.data.id})`);

          postResult = {
            success: true,
            post_id: postResponse.data.id,
            attachment_id: mediaId,
            link: postResponse.data.link
          };

          results.published++;

        } catch (imageError) {
          logError(`Image upload failed`, imageError);
          results.skipped++;
          results.errors.push({
            title: article.title,
            reason: 'image_upload_failed'
          });
        }
      }

    } catch (error) {
      logError(`WordPress post creation failed`, error);
      results.failed++;
      results.errors.push({
        title: article.title,
        reason: 'wordpress_error',
        error: error.message
      });
    }

    // Add to results
    results.articles.push({
      title: article.title,
      status: postResult ? 'published' : (results.skipped > 0 ? 'skipped' : 'failed'),
      post_id: postResult?.post_id || null,
      word_count: article.word_count,
      image_url: article.featured_image_url,
      generation_time: article.generation_time_minutes,
      model: CONFIG.groqModel
    });

    logStep(`\n📊 STEP 3/3: TRACK RESULTS`);
    logStep(`   Status: ${postResult ? '✅ PUBLISHED' : '⏭️ SKIPPED'}`);
    logStep(`   Words: ${article.word_count}`);
    logStep(`   Time: ${article.generation_time_minutes} minutes`);

    // Rate limiting between posts (look organic)
    if (i < prompts.length - 1) {
      logStep(`\n⏳ Rate limiting (waiting ${CONFIG.delayBetweenPosts / 1000}s)...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPosts));
    }
  }

  // Calculate metrics
  results.generation_times = calculateMetrics(
    results.articles.filter(a => a.generation_time)
  );

  // Create summary
  results.summary = `${results.published}/${results.total_processed} articles published. ${results.skipped} skipped (no image or upload error). ${results.failed} failed (generation error).`;

  // Save results
  saveJSON('orchestration_report.json', results);
  saveErrorLog();

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📊 ORCHESTRATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`Run timestamp: ${results.run_timestamp}`);
  console.log(`Total processed: ${results.total_processed}`);
  console.log(`✅ Published: ${results.published}`);
  console.log(`⏭️  Skipped: ${results.skipped}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success rate: ${((results.published / results.total_processed) * 100).toFixed(1)}%`);
  console.log(`\nGeneration times:`);
  console.log(`  Average: ${results.generation_times.average}`);
  console.log(`  Fastest: ${results.generation_times.fastest}`);
  console.log(`  Slowest: ${results.generation_times.slowest}`);
  console.log(`\nModel: ${CONFIG.groqModel}`);
  console.log(`Status: ${CONFIG.autoPublish ? '🔴 PUBLISHED' : '🟡 DRAFT'}`);
  console.log(`\nNext run: ${results.next_run}`);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`✅ Full report: orchestration_report.json\n`);

  // Send email
  await sendEmailReport(results);

  const runDuration = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1);
  logStep(`\n✅ Orchestration complete in ${runDuration} minutes`);

  return results;
}

// ═══════════════════════════════════════════════════════════════
// EXPORT & MAIN
// ═══════════════════════════════════════════════════════════════

module.exports = { runOrchestrator };

if (require.main === module) {
  runOrchestrator()
    .then(results => {
      process.exit(results.published > 0 ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Fatal error:', error);
      logError('Fatal orchestrator error', error);
      process.exit(1);
    });
}
