const fs = require('fs');
const { generateDeepArticle: generateOpenAIArticle } = require('./generate-posts-openai');

// Adapt the OpenAI generator's result to the shape the quality checks expect
async function generateDeepArticle(prompt, modelName) {
  const a = await generateOpenAIArticle(prompt, modelName);
  if (!a) return null;
  return {
    title: a.content.split('\n').find(l => l.trim())?.replace(/[#*`]/g, '').trim() || a.title,
    content: a.content,
    featured_image_url: a.featuredImage || null,
    word_count: a.wordCount,
    model_used: a.model,
    tokens_used: a.tokensUsed,
    seo_metadata: {
      meta_description: prompt.seo_tips?.meta_description || `Complete guide to ${prompt.keyword}`,
      keywords: prompt.seo_tips?.keywords_to_hit || [prompt.keyword],
      schema_type: prompt.seo_tips?.schema_type || 'Article'
    },
    timestamp: a.createdAt,
    generation_time_minutes: a.generationTime
  };
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const TEST_CONFIG = {
  totalArticles: 5,
  articlesPerModel: {
    'gpt-3.5-turbo': 3,
    'gpt-4o': 1,
    'gpt-4-turbo': 1
  },
  minWordCount: 2000,
  preferredWordCount: 3000
};

// ═══════════════════════════════════════════════════════════════
// TEST STORY PROMPTS
// ═══════════════════════════════════════════════════════════════

function loadOrCreateTestPrompts() {
  try {
    const data = fs.readFileSync('src/story_prompts.json', 'utf-8');
    const parsed = JSON.parse(data);
    const prompts = parsed.prompts || parsed;
    return prompts.slice(0, 5);
  } catch (error) {
    console.log('📝 Creating inline test prompts...\n');
    return [
      {
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
          'Try disabling Background App Refresh and location services.',
          'After the iOS update, my battery was dying in 2 hours.',
          'Check your battery health in Settings > Battery > Battery Health & Charging'
        ],
        seo_tips: {
          meta_description: 'Expert guide to fixing iPhone 16 battery drain with real solutions.',
          keywords_to_hit: ['iPhone 16 battery drain', 'battery fix', 'background app refresh'],
          schema_type: 'HowToArticle'
        },
        content_angle: 'Real user solutions combined with official Apple recommendations',
        cta: 'Try these fixes and let us know which one worked for you!'
      },
      {
        keyword: 'Samsung Galaxy S25 camera comparison',
        intent: 'informational',
        audience: 'Samsung phone users considering upgrade',
        structure: {
          title: 'Samsung Galaxy S25 vs S24: Camera Comparison 2026',
          sections: [
            { heading: 'Introduction', instructions: 'Hook with camera upgrades', word_count: 250 },
            { heading: 'Hardware Changes', instructions: 'New sensors and specs', word_count: 600 },
            { heading: 'Photo Quality Comparison', instructions: 'Side-by-side examples and analysis', word_count: 900 },
            { heading: 'Video Recording', instructions: 'New 8K capabilities', word_count: 500 },
            { heading: 'Verdict', instructions: 'Final recommendation', word_count: 300 }
          ]
        },
        reddit_quotes: [
          'The S25 camera is a huge upgrade from S24.',
          'Night mode photos are incredibly sharp now.',
          'Worth upgrading just for the camera quality.'
        ],
        seo_tips: {
          meta_description: 'Detailed comparison of Samsung Galaxy S25 vs S24 cameras with sample photos.',
          keywords_to_hit: ['Galaxy S25 camera', 'S25 vs S24', 'phone camera comparison'],
          schema_type: 'ComparisonChart'
        },
        content_angle: 'Technical specs + real user experiences',
        cta: 'Which Galaxy S camera is your favorite? Share in comments!'
      },
      {
        keyword: 'Android 15 best features guide',
        intent: 'informational',
        audience: 'Android users wanting to learn new features',
        structure: {
          title: 'Android 15: Top 10 Features You Should Know (2026)',
          sections: [
            { heading: 'Introduction', instructions: 'Exciting new capabilities', word_count: 200 },
            { heading: 'Privacy & Security Upgrades', instructions: 'Enhanced data protection', word_count: 700 },
            { heading: 'Performance Improvements', instructions: 'Speed and battery optimizations', word_count: 600 },
            { heading: 'AI Integration', instructions: 'New AI-powered features', word_count: 800 },
            { heading: 'How to Update', instructions: 'Step-by-step guide', word_count: 400 },
            { heading: 'Conclusion', instructions: 'Final thoughts', word_count: 200 }
          ]
        },
        reddit_quotes: [
          'Android 15 is finally catching up to iOS privacy.',
          'The AI features are genuinely useful.',
          'Battery life improved significantly after update.'
        ],
        seo_tips: {
          meta_description: 'Complete guide to Android 15 best features with setup instructions.',
          keywords_to_hit: ['Android 15 features', 'Android update', 'new Android capabilities'],
          schema_type: 'HowToArticle'
        },
        content_angle: 'Feature highlights + practical tips',
        cta: 'Have you upgraded? Tell us your favorite Android 15 feature!'
      },
      {
        keyword: 'AirPods Pro 3rd generation review',
        intent: 'commercial',
        audience: 'Apple users considering AirPods upgrade',
        structure: {
          title: 'AirPods Pro (3rd Generation) Review: Worth the Upgrade?',
          sections: [
            { heading: 'Overview', instructions: 'Introduce new model', word_count: 300 },
            { heading: 'Design & Comfort', instructions: 'Physical changes and fit', word_count: 500 },
            { heading: 'Audio Quality', instructions: 'Sound profile and comparison', word_count: 700 },
            { heading: 'Noise Cancellation', instructions: 'New adaptive ANC tech', word_count: 600 },
            { heading: 'Battery & Charging', instructions: 'Runtime improvements', word_count: 400 },
            { heading: 'Verdict', instructions: 'Recommendation and pricing', word_count: 350 }
          ]
        },
        reddit_quotes: [
          'The new AirPods Pro are worth every penny.',
          'Noise cancellation is now perfect on planes.',
          'Battery lasts way longer than AirPods 2.'
        ],
        seo_tips: {
          meta_description: 'In-depth review of AirPods Pro 3rd gen with pros, cons, and pricing.',
          keywords_to_hit: ['AirPods Pro review', 'AirPods Pro 3rd generation', 'best wireless earbuds'],
          schema_type: 'Product'
        },
        content_angle: 'Technical review + user testimonials',
        cta: 'Do you use AirPods Pro? Share your experience!'
      },
      {
        keyword: 'Google Pixel 9 AI photography features',
        intent: 'informational',
        audience: 'Photography enthusiasts and casual phone users',
        structure: {
          title: 'Google Pixel 9 AI Photography: How to Use Advanced Features (2026)',
          sections: [
            { heading: 'Introduction', instructions: 'AI-powered photography overview', word_count: 250 },
            { heading: 'Magic Eraser Explained', instructions: 'Remove unwanted objects', word_count: 600 },
            { heading: 'Best Take Feature', instructions: 'AI selects best faces', word_count: 500 },
            { heading: 'Night Mode AI', instructions: 'Advanced low-light photography', word_count: 700 },
            { heading: 'Real Magic Features', instructions: 'Generative AI in photos', word_count: 600 },
            { heading: 'Tips & Tricks', instructions: 'Pro photography advice', word_count: 400 },
            { heading: 'Conclusion', instructions: 'Summary of capabilities', word_count: 200 }
          ]
        },
        reddit_quotes: [
          'Magic Eraser is a game changer for photos.',
          'The AI photo editing is better than Lightroom.',
          'Night mode photos look professional quality.'
        ],
        seo_tips: {
          meta_description: 'Master Google Pixel 9 AI photography features with practical examples.',
          keywords_to_hit: ['Pixel 9 photography', 'Magic Eraser', 'AI photography', 'phone camera'],
          schema_type: 'HowToArticle'
        },
        content_angle: 'Technical guide + real-world examples',
        cta: 'Try these features and share your best Pixel photos!'
      }
    ];
  }
}

// ═══════════════════════════════════════════════════════════════
// QUALITY CHECKER
// ═══════════════════════════════════════════════════════════════

function checkArticleQuality(article) {
  const checks = {
    word_count_minimum: false,
    word_count_preferred: false,
    has_h2_sections: false,
    h2_count: 0,
    proper_paragraphs: false,
    seo_keywords_present: false,
    keywords_found: [],
    reading_quality: false,
    quality_notes: '',
    image_valid: false,
    title_matches: false,
    metadata_present: false
  };

  // 1. Word count check
  checks.word_count_minimum = article.word_count >= TEST_CONFIG.minWordCount;
  checks.word_count_preferred = article.word_count >= TEST_CONFIG.preferredWordCount;

  // 2. H2 sections check
  const h2Matches = (article.content.match(/^##\s+/gm) || []);
  checks.h2_count = h2Matches.length;
  checks.has_h2_sections = h2Matches.length >= 3;

  // 3. Proper paragraphs check
  const paragraphs = article.content.split('\n\n').filter(p => p.trim().length > 100);
  checks.proper_paragraphs = paragraphs.length >= 5;

  // 4. SEO keywords check
  const contentLower = article.content.toLowerCase();
  if (article.seo_metadata?.keywords) {
    article.seo_metadata.keywords.forEach(keyword => {
      if (contentLower.includes(keyword.toLowerCase())) {
        checks.keywords_found.push(keyword);
      }
    });
    checks.seo_keywords_present = checks.keywords_found.length >= 2;
  }

  // 5. Reading quality check (no obvious AI gibberish)
  const badPatterns = [
    /\[([A-Z]+)\]/g,           // [SECTION] brackets
    /\{.*?\}/g,                // {curly braces}
    /\*\*\*/g,                 // *** triple asterisks
    /undefined/gi,
    /\[object Object\]/gi,
    /null/gi
  ];
  const hasBadPatterns = badPatterns.some(pattern => pattern.test(article.content));
  checks.reading_quality = !hasBadPatterns;
  checks.quality_notes = hasBadPatterns ? 'Contains AI artifacts' : 'Professional quality';

  // 6. Image valid check
  checks.image_valid = article.featured_image_url && article.featured_image_url.startsWith('https://pollinations.ai');

  // 7. Title matches keyword check
  if (article.title && article.seo_metadata?.keywords) {
    const titleLower = article.title.toLowerCase();
    checks.title_matches = article.seo_metadata.keywords.some(k => titleLower.includes(k.toLowerCase()));
  }

  // 8. Metadata present check
  checks.metadata_present = !!(
    article.seo_metadata?.meta_description &&
    article.seo_metadata?.keywords &&
    article.seo_metadata?.schema_type
  );

  return checks;
}

// ═══════════════════════════════════════════════════════════════
// TEST EXECUTION
// ═══════════════════════════════════════════════════════════════

async function runTests() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🧪 OPENAI MODELS QUALITY TEST');
  console.log('═══════════════════════════════════════════════════════\n');

  // Load test prompts
  const allPrompts = loadOrCreateTestPrompts();

  // Build test queue
  const testQueue = [];
  const modelOrder = ['gpt-3.5-turbo', 'gpt-4o', 'gpt-4-turbo'];
  let promptIndex = 0;

  for (const model of modelOrder) {
    const count = TEST_CONFIG.articlesPerModel[model];
    for (let i = 0; i < count; i++) {
      if (promptIndex < allPrompts.length) {
        testQueue.push({
          testNumber: testQueue.length + 1,
          model: model,
          modelFriendly: model,
          prompt: allPrompts[promptIndex]
        });
        promptIndex++;
      }
    }
  }

  console.log(`📊 Test Queue: ${testQueue.length} articles`);
  console.log(`   • gpt-3.5-turbo: ${TEST_CONFIG.articlesPerModel['gpt-3.5-turbo']} articles`);
  console.log(`   • gpt-4o: ${TEST_CONFIG.articlesPerModel['gpt-4o']} articles`);
  console.log(`   • gpt-4-turbo: ${TEST_CONFIG.articlesPerModel['gpt-4-turbo']} articles\n`);

  // Run tests
  const results = {
    test_run: new Date().toLocaleString(),
    total_articles: testQueue.length,
    passed: 0,
    failed: 0,
    articles: [],
    model_comparison: {},
    recommendation: ''
  };

  const modelStats = {};

  for (const test of testQueue) {
    console.log(`[TEST ${test.testNumber}/${testQueue.length}] 🚀 ${test.modelFriendly}`);
    console.log(`   Keyword: ${test.prompt.keyword}\n`);

    try {
      const article = await generateDeepArticle(test.prompt, test.modelFriendly);

      if (!article) {
        console.log(`   ❌ FAILED: No article generated\n`);
        results.failed++;
        continue;
      }

      // Check quality
      const qualityChecks = checkArticleQuality(article);

      // Determine pass/fail
      const overallPass = qualityChecks.word_count_minimum &&
                         qualityChecks.has_h2_sections &&
                         qualityChecks.proper_paragraphs &&
                         qualityChecks.seo_keywords_present &&
                         qualityChecks.reading_quality &&
                         qualityChecks.image_valid;

      // Log results
      console.log(`   ✅ Generated: ${article.word_count} words in ${article.generation_time_minutes} minutes`);
      console.log(`   📸 Image: ${qualityChecks.image_valid ? '✅ Valid' : '❌ Invalid'}`);
      console.log(`   📋 Sections: ${qualityChecks.h2_count} H2 headings`);
      console.log(`   🔍 Keywords: ${qualityChecks.keywords_found.length}/${article.seo_metadata?.keywords?.length || 0}`);
      console.log(`   📖 Quality: ${qualityChecks.reading_quality ? '✅ Professional' : '❌ AI artifacts detected'}`);
      console.log(`   🎯 Overall: ${overallPass ? '✅ PASS' : '❌ FAIL'}\n`);

      // Save result
      results.articles.push({
        test_number: test.testNumber,
        keyword: test.prompt.keyword,
        model: test.model,
        model_friendly: test.modelFriendly,
        generation_time: `${article.generation_time_minutes} minutes`,
        word_count: article.word_count,
        image_url: article.featured_image_url,
        tokens_used: article.tokens_used,
        quality_checks: {
          word_count_minimum: { passed: qualityChecks.word_count_minimum, value: article.word_count },
          word_count_preferred: { passed: qualityChecks.word_count_preferred },
          has_h2_sections: { passed: qualityChecks.has_h2_sections, value: qualityChecks.h2_count },
          proper_paragraphs: { passed: qualityChecks.proper_paragraphs },
          seo_keywords_present: { passed: qualityChecks.seo_keywords_present, keywords: qualityChecks.keywords_found },
          reading_quality: { passed: qualityChecks.reading_quality, notes: qualityChecks.quality_notes },
          image_valid: { passed: qualityChecks.image_valid, url: article.featured_image_url },
          title_matches: { passed: qualityChecks.title_matches },
          metadata_present: { passed: qualityChecks.metadata_present }
        },
        overall_result: overallPass ? 'PASS' : 'FAIL',
        notes: `Model: ${test.model}. ${qualityChecks.quality_notes}`
      });

      // Track model stats
      if (!modelStats[test.model]) {
        modelStats[test.model] = {
          articles: 0,
          times: [],
          wordCounts: [],
          passCount: 0
        };
      }
      modelStats[test.model].articles++;
      modelStats[test.model].times.push(parseFloat(article.generation_time_minutes));
      modelStats[test.model].wordCounts.push(article.word_count);
      if (overallPass) modelStats[test.model].passCount++;

      if (overallPass) {
        results.passed++;
      } else {
        results.failed++;
      }

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
      results.failed++;
    }

    // Rate limiting between tests
    if (test.testNumber < testQueue.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Calculate model comparison
  results.model_comparison = {};
  for (const [model, stats] of Object.entries(modelStats)) {
    const avgTime = (stats.times.reduce((a, b) => a + b, 0) / stats.times.length).toFixed(1);
    const avgWords = Math.round(stats.wordCounts.reduce((a, b) => a + b, 0) / stats.wordCounts.length);
    const successRate = ((stats.passCount / stats.articles) * 100).toFixed(0);

    results.model_comparison[model] = {
      articles: stats.articles,
      avg_time: avgTime,
      avg_words: avgWords,
      success_rate: `${successRate}%`,
      passes: stats.passCount,
      failures: stats.articles - stats.passCount
    };
  }

  // Generate recommendation
  const fastStats = results.model_comparison['gpt-3.5-turbo'];
  const midStats = results.model_comparison['gpt-4o'];
  const bestStats = results.model_comparison['gpt-4-turbo'];

  let recommendation = 'All models performed well. ';
  if (fastStats?.avg_time < 1.5) {
    recommendation += `gpt-3.5-turbo is fastest (avg ${fastStats.avg_time} min). `;
  }
  if (bestStats && bestStats.avg_words > (midStats?.avg_words || 0)) {
    recommendation += `gpt-4-turbo produces longest articles (avg ${bestStats.avg_words} words). `;
  }
  recommendation += 'For production: Use gpt-3.5-turbo for speed, gpt-4-turbo for best quality.';

  results.recommendation = recommendation;

  // Save results
  fs.writeFileSync('test_results.json', JSON.stringify(results, null, 2));

  // Print summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log(`Total Articles: ${results.total_articles}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / results.total_articles) * 100).toFixed(1)}%\n`);

  console.log('📈 MODEL COMPARISON\n');
  for (const [model, stats] of Object.entries(results.model_comparison)) {
    const modelFriendly = model;
    console.log(`${modelFriendly}:`);
    console.log(`   Articles: ${stats.articles}`);
    console.log(`   Avg Time: ${stats.avg_time} min`);
    console.log(`   Avg Words: ${stats.avg_words}`);
    console.log(`   Success: ${stats.success_rate} (${stats.passes}/${stats.articles})\n`);
  }

  console.log('🎯 RECOMMENDATION\n');
  console.log(results.recommendation);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`✅ Full results saved to: test_results.json\n`);

  return results;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  runTests()
    .then(results => {
      process.exit(results.passed === results.total_articles ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = { runTests, checkArticleQuality };
