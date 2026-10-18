const fs = require('fs');
const path = require('path');

// File paths
const RANKED_TOPICS_FILE = path.join(__dirname, 'ranked_topics.json');
const REDDIT_DATA_FILE = path.join(__dirname, 'reddit_data.json');
const OUTPUT_FILE = path.join(__dirname, 'story_prompts.json');

// Load JSON files
function loadRankedTopics() {
  try {
    if (!fs.existsSync(RANKED_TOPICS_FILE)) {
      console.warn(`⚠️  ${RANKED_TOPICS_FILE} not found`);
      return [];
    }

    const data = JSON.parse(fs.readFileSync(RANKED_TOPICS_FILE, 'utf8'));
    return data.topics || [];
  } catch (error) {
    console.error(`❌ Error loading ranked topics: ${error.message}`);
    return [];
  }
}

function loadRedditData() {
  try {
    if (!fs.existsSync(REDDIT_DATA_FILE)) {
      console.warn(`⚠️  ${REDDIT_DATA_FILE} not found`);
      return [];
    }

    const data = JSON.parse(fs.readFileSync(REDDIT_DATA_FILE, 'utf8'));
    return data.posts || [];
  } catch (error) {
    console.error(`❌ Error loading Reddit data: ${error.message}`);
    return [];
  }
}

// Determine search intent based on keyword
function determineSearchIntent(keyword) {
  const lowerKeyword = keyword.toLowerCase();

  // Transactional keywords (user wants to buy/do something)
  const transactionalTerms = ['buy', 'price', 'cost', 'deal', 'discount', 'where to get', 'purchase', 'shop'];
  if (transactionalTerms.some(term => lowerKeyword.includes(term))) {
    return 'transactional';
  }

  // Navigational keywords (looking for specific product/site)
  const navigationalTerms = ['official', 'store', 'reddit', 'review site', 'website'];
  if (navigationalTerms.some(term => lowerKeyword.includes(term))) {
    return 'navigational';
  }

  // Informational keywords (learning/understanding)
  const informationalTerms = ['how', 'what', 'why', 'tips', 'guide', 'tutorial', 'fix', 'problem', 'issue', 'specs', 'features', 'comparison', 'vs'];
  if (informationalTerms.some(term => lowerKeyword.includes(term))) {
    return 'informational';
  }

  // Default based on keyword characteristics
  if (lowerKeyword.includes('battery') || lowerKeyword.includes('camera') || lowerKeyword.includes('fix')) {
    return 'informational';
  }

  return 'informational';
}

// Determine target audience
function determineAudience(topic) {
  const keyword = topic.keyword.toLowerCase();
  const category = topic.category || 'General';

  if (keyword.includes('battery')) {
    return `${category} users experiencing battery issues`;
  }
  if (keyword.includes('camera')) {
    return `${category} users interested in photography and camera features`;
  }
  if (keyword.includes('price') || keyword.includes('cost')) {
    return `Budget-conscious smartphone buyers comparing ${category}`;
  }
  if (keyword.includes('vs') || keyword.includes('comparison')) {
    return `Users trying to decide between ${keyword.split('vs')[0]} and ${keyword.split('vs')[1] || 'alternatives'}`;
  }
  if (keyword.includes('review')) {
    return `${category} buyers doing research before purchase`;
  }
  if (keyword.includes('specs') || keyword.includes('features')) {
    return `${category} enthusiasts learning about technical specifications`;
  }
  if (keyword.includes('fix') || keyword.includes('solve')) {
    return `${category} users troubleshooting problems`;
  }

  return `${category} users and smartphone enthusiasts`;
}

// Generate article structure based on topic
function generateArticleStructure(topic, redditData) {
  const keyword = topic.keyword;
  const intent = determineSearchIntent(keyword);

  let structure = {
    title: generateTitle(keyword, topic),
    word_count_total: 1200,
    sections: []
  };

  // Generate different structures based on intent
  if (intent === 'informational') {
    if (keyword.toLowerCase().includes('fix') || keyword.toLowerCase().includes('problem')) {
      structure.sections = [
        {
          type: 'intro',
          heading: 'Introduction',
          word_count: 400,
          instructions: 'Hook with the problem statement, mention urgency, preview solutions'
        },
        {
          type: 'problem',
          heading: `Understanding ${keyword} Issue`,
          word_count: 500,
          instructions: 'Explain what the issue is, why it happens, which models/users affected'
        },
        {
          type: 'solutions',
          heading: 'Solutions & Fixes',
          word_count: 700,
          instructions: 'Provide step-by-step solutions. Include most-mentioned Reddit fixes.',
          include_reddit: true
        },
        {
          type: 'alternative',
          heading: 'When to Seek Help',
          word_count: 300,
          instructions: 'Warranty info, when to contact support, replacement options'
        },
        {
          type: 'conclusion',
          heading: 'Conclusion',
          word_count: 300,
          instructions: 'Summary, next steps, call to action'
        }
      ];
    } else if (keyword.toLowerCase().includes('comparison') || keyword.toLowerCase().includes('vs')) {
      structure.sections = [
        {
          type: 'intro',
          heading: 'Introduction',
          word_count: 350,
          instructions: 'Set up the comparison, mention what makes this decision hard'
        },
        {
          type: 'specs',
          heading: 'Technical Specifications',
          word_count: 500,
          instructions: 'Detailed specs comparison table format'
        },
        {
          type: 'design',
          heading: 'Design & Build Quality',
          word_count: 400,
          instructions: 'Compare design, materials, durability'
        },
        {
          type: 'performance',
          heading: 'Performance & Speed',
          word_count: 400,
          instructions: 'Compare processors, RAM, real-world performance'
        },
        {
          type: 'camera',
          heading: 'Camera Quality',
          word_count: 400,
          instructions: 'Compare camera specs and quality'
        },
        {
          type: 'battery',
          heading: 'Battery & Charging',
          word_count: 300,
          instructions: 'Battery life comparison, charging speed'
        },
        {
          type: 'reddit_discussion',
          heading: 'What Users Say',
          word_count: 400,
          instructions: 'Real user experiences from Reddit',
          include_reddit: true
        },
        {
          type: 'verdict',
          heading: 'Which Should You Buy?',
          word_count: 300,
          instructions: 'Final recommendation based on use case'
        },
        {
          type: 'conclusion',
          heading: 'Conclusion',
          word_count: 250,
          instructions: 'Wrap up, mention both are good choices, CTA'
        }
      ];
    } else if (keyword.toLowerCase().includes('specs') || keyword.toLowerCase().includes('features')) {
      structure.sections = [
        {
          type: 'intro',
          heading: 'Introduction',
          word_count: 300,
          instructions: 'Introduce the device and why specs matter'
        },
        {
          type: 'specs_overview',
          heading: 'Complete Specifications Overview',
          word_count: 600,
          instructions: 'Detailed specs breakdown'
        },
        {
          type: 'performance',
          heading: 'Performance Analysis',
          word_count: 400,
          instructions: 'Real-world performance implications'
        },
        {
          type: 'user_experience',
          heading: 'What This Means for Users',
          word_count: 300,
          instructions: 'How specs translate to daily usage'
        },
        {
          type: 'comparison',
          heading: 'How It Compares',
          word_count: 300,
          instructions: 'Brief comparison with competitors'
        },
        {
          type: 'conclusion',
          heading: 'Conclusion',
          word_count: 200,
          instructions: 'Summary and verdict'
        }
      ];
    } else {
      // Default how-to/guide structure
      structure.sections = [
        {
          type: 'intro',
          heading: 'Introduction',
          word_count: 300,
          instructions: 'Hook, problem statement, what reader will learn'
        },
        {
          type: 'background',
          heading: `Understanding ${keyword}`,
          word_count: 400,
          instructions: 'Background context and key concepts'
        },
        {
          type: 'guide',
          heading: `How To: ${keyword}`,
          word_count: 600,
          instructions: 'Step-by-step guide or detailed explanation'
        },
        {
          type: 'tips',
          heading: 'Pro Tips & Best Practices',
          word_count: 400,
          instructions: 'Additional tips and expert insights'
        },
        {
          type: 'conclusion',
          heading: 'Conclusion',
          word_count: 200,
          instructions: 'Summary and next steps'
        }
      ];
    }
  } else if (intent === 'transactional') {
    structure.sections = [
      {
        type: 'intro',
        heading: 'Quick Overview',
        word_count: 300,
        instructions: 'What product, current price, top features'
      },
      {
        type: 'specs',
        heading: 'Key Specifications',
        word_count: 400,
        instructions: 'Most important specs that matter to buyers'
      },
      {
        type: 'pros_cons',
        heading: 'Pros & Cons',
        word_count: 500,
        instructions: 'Honest assessment of strengths and weaknesses'
      },
      {
        type: 'comparison',
        heading: 'How It Compares',
        word_count: 400,
        instructions: 'Price and feature comparison with alternatives'
      },
      {
        type: 'where_to_buy',
        heading: 'Where & How to Buy',
        word_count: 300,
        instructions: 'Best deals, retailer recommendations, warranty info'
      },
      {
        type: 'conclusion',
        heading: 'Final Verdict',
        word_count: 200,
        instructions: 'Recommendation and call to action'
      }
    ];
  }

  return structure;
}

// Generate title for the article
function generateTitle(keyword, topic) {
  const titleFormats = [
    `${keyword}: Complete 2026 Guide`,
    `${keyword}: Everything You Need to Know`,
    `How to: ${keyword} (Expert Guide)`,
    `${keyword}: Tips, Tricks & Solutions`,
    `The Ultimate Guide to ${keyword}`,
    `${keyword}: Problems, Fixes & Reviews`
  ];

  // Select format based on keyword
  if (keyword.toLowerCase().includes('vs') || keyword.toLowerCase().includes('comparison')) {
    return `${keyword}: Detailed Comparison & Buying Guide`;
  }
  if (keyword.toLowerCase().includes('fix') || keyword.toLowerCase().includes('problem')) {
    return `${keyword}: Complete Fix Guide & Solutions`;
  }
  if (keyword.toLowerCase().includes('price')) {
    return `${keyword}: Best Deals & Price Analysis`;
  }
  if (keyword.toLowerCase().includes('review')) {
    return `${keyword}: Honest Review & Specs Breakdown`;
  }
  if (keyword.toLowerCase().includes('specs') || keyword.toLowerCase().includes('features')) {
    return `${keyword}: Complete Specifications Explained`;
  }

  return titleFormats[Math.floor(Math.random() * titleFormats.length)];
}

// Extract relevant Reddit quotes for a topic
function extractRedditQuotes(keyword, redditData) {
  const quotes = [];

  redditData.forEach(post => {
    const content = `${post.title} ${post.top_comment || ''}`.toLowerCase();

    if (content.includes(keyword.toLowerCase())) {
      // Extract the top comment as a quote
      if (post.top_comment && post.top_comment.length > 20) {
        const cleaned = post.top_comment
          .replace(/^[^\w]*/, '')
          .trim()
          .substring(0, 150);

        if (cleaned.length > 30) {
          quotes.push({
            text: cleaned,
            subreddit: post.subreddit,
            upvotes: post.score
          });
        }
      }
    }
  });

  // Return top 3 quotes sorted by relevance
  return quotes.slice(0, 3);
}

// Generate SEO tips
function generateSEOTips(keyword, topic) {
  const intent = determineSearchIntent(keyword);

  // Generate meta description
  let metaDescription = '';
  if (intent === 'informational') {
    if (keyword.toLowerCase().includes('fix') || keyword.toLowerCase().includes('problem')) {
      metaDescription = `Expert guide to ${keyword}. Real solutions & fixes tested by users.`;
    } else if (keyword.toLowerCase().includes('comparison') || keyword.toLowerCase().includes('vs')) {
      metaDescription = `Detailed comparison: ${keyword}. See specs, pros/cons & expert verdict.`;
    } else {
      metaDescription = `Complete guide to ${keyword}. Everything you need to know about ${keyword.split(' ')[0]}.`;
    }
  } else if (intent === 'transactional') {
    metaDescription = `${keyword}: Current prices, best deals, specs & buying guide. Save time & money.`;
  }

  // Ensure meta is under 160 characters
  if (metaDescription.length > 160) {
    metaDescription = metaDescription.substring(0, 157) + '...';
  }

  // Generate keyword variations to hit
  const keywordVariations = [
    keyword,
    keyword + ' guide',
    keyword + ' how to',
    keyword + ' tips',
    keyword + ' review',
    keyword + ' 2026'
  ];

  // Internal link targets
  const internalLinkTargets = generateInternalLinkTargets(keyword, topic.category);

  return {
    meta_description: metaDescription,
    focus_keyword: keyword,
    keyword_variations: keywordVariations.slice(0, 5),
    internal_link_targets: internalLinkTargets,
    headings_strategy: generateHeadingStrategy(keyword),
    schema_type: determineSchemaType(keyword),
    readability_tips: [
      'Use short paragraphs (2-3 sentences max)',
      'Include bullet points for lists',
      'Use bold for important phrases',
      'Include at least one image per section',
      'Break up long sections with subheadings'
    ]
  };
}

// Generate internal link targets
function generateInternalLinkTargets(keyword, category) {
  const targets = [];

  const categoryTargets = {
    iPhone: ['iPhone specs', 'iPhone battery tips', 'iPhone settings guide', 'iPhone security features'],
    Samsung: ['Samsung specs', 'Samsung battery comparison', 'Samsung camera guide', 'Samsung 5G features'],
    Android: ['Android tips', 'Android settings guide', 'Android customization', 'Android security'],
    Pixel: ['Pixel specs', 'Pixel camera features', 'Pixel AI features', 'Pixel comparison'],
    OnePlus: ['OnePlus specs', 'OnePlus performance', 'OnePlus design', 'OnePlus pricing']
  };

  targets.push(...(categoryTargets[category] || []));

  // Add topic-specific targets
  if (keyword.toLowerCase().includes('battery')) {
    targets.push('smartphone battery comparison', 'battery saving tips', 'battery health guide');
  }
  if (keyword.toLowerCase().includes('camera')) {
    targets.push('smartphone camera comparison', 'mobile photography tips', 'camera settings guide');
  }
  if (keyword.toLowerCase().includes('price')) {
    targets.push('smartphone deals today', 'best budget phones', 'price comparison');
  }

  return targets.slice(0, 5);
}

// Determine schema type
function determineSchemaType(keyword) {
  if (keyword.toLowerCase().includes('how') || keyword.toLowerCase().includes('fix') || keyword.toLowerCase().includes('guide')) {
    return 'HowToArticle';
  }
  if (keyword.toLowerCase().includes('review')) {
    return 'Review';
  }
  if (keyword.toLowerCase().includes('price') || keyword.toLowerCase().includes('buy')) {
    return 'Product';
  }
  if (keyword.toLowerCase().includes('comparison') || keyword.toLowerCase().includes('vs')) {
    return 'ComparisonChart';
  }
  return 'Article';
}

// Generate heading strategy
function generateHeadingStrategy(keyword) {
  return {
    h1: `Main keyword should appear here: ${keyword}`,
    h2_count: '4-6 H2 headings recommended',
    h3_count: '1-2 H3 per H2 for longer sections',
    keyword_placement: 'Include keyword in first H2, avoid keyword stuffing',
    variations: 'Use keyword variations in different headings'
  };
}

// Generate content angle unique perspective
function generateContentAngle(topic, redditData) {
  const keyword = topic.keyword.toLowerCase();

  // Base angle from ranked topic
  let angle = topic.angle || '';

  // Enhance with data source info
  const sources = [];
  if (topic.reddit_posts > 0) {
    sources.push(`${topic.reddit_posts} real Reddit discussions`);
  }
  if (topic.sources.includes('Google Trends')) {
    sources.push('trending search data');
  }

  if (sources.length > 0) {
    angle = `${angle} - Backed by ${sources.join(' + ')}`;
  }

  return {
    primary_angle: topic.angle || 'Comprehensive guide',
    unique_aspect: `Combines official information with real user experiences from Reddit (${topic.reddit_posts || 0} posts)`,
    credibility_boosters: sources,
    author_voice: 'Expert, helpful, honest, conversational'
  };
}

// Generate call to action
function generateCTA(topic) {
  const keyword = topic.keyword.toLowerCase();

  if (keyword.includes('fix') || keyword.includes('problem')) {
    return 'Try these solutions in order. If the issue persists, contact Apple Support with details about your device.';
  }
  if (keyword.includes('price') || keyword.includes('buy')) {
    return 'Use these insights to make an informed purchase decision. Check current prices before buying.';
  }
  if (keyword.includes('comparison') || keyword.includes('vs')) {
    return 'Have you used either of these devices? Share your experience in the comments below!';
  }
  if (keyword.includes('camera') || keyword.includes('specs')) {
    return 'Want to learn more about this feature? Check our detailed guide on getting the most out of your device.';
  }

  return 'Share your thoughts and experiences in the comments below. We love hearing from our readers!';
}

// Create story prompt for a single topic
function createStoryPrompt(topic, redditData, index) {
  const structure = generateArticleStructure(topic, redditData);
  const redditQuotes = extractRedditQuotes(topic.keyword, redditData);
  const seoTips = generateSEOTips(topic.keyword, topic);
  const contentAngle = generateContentAngle(topic, redditData);

  return {
    rank: topic.rank || (index + 1),
    keyword: topic.keyword,
    score: topic.score,
    search_intent: determineSearchIntent(topic.keyword),
    target_audience: determineAudience(topic),
    category: topic.category,
    trend_direction: topic.trend_direction,

    structure: {
      title: structure.title,
      total_word_count: structure.word_count_total,
      estimated_read_time: `${Math.ceil(structure.word_count_total / 200)} minutes`,
      sections: structure.sections.map(section => ({
        type: section.type,
        heading: section.heading,
        word_count: section.word_count,
        instructions: section.instructions,
        include_reddit_insights: section.include_reddit || false
      }))
    },

    seo_optimization: seoTips,

    content_angle: contentAngle,

    reddit_insights: {
      total_relevant_posts: topic.reddit_posts || 0,
      top_subreddits: (topic.subreddits || []).slice(0, 3),
      user_quotes: redditQuotes.map(q => ({
        quote: q.text,
        source: q.subreddit,
        engagement: q.upvotes
      })),
      common_themes: extractCommonThemes(topic, redditData)
    },

    writing_instructions: {
      tone: 'Expert, helpful, honest, conversational',
      perspective: 'Write from first person when sharing experiences, third person for facts',
      specificity: 'Include concrete numbers, statistics, and real examples',
      length: `Target ${structure.word_count_total} words total`,
      formatting: 'Use subheadings, bullet points, bold text, and spacing for readability',
      sources: 'Cite Reddit discussions, official statements, and reliable sources'
    },

    cta: generateCTA(topic),

    optimization_checklist: [
      '✓ Include focus keyword in title',
      '✓ Include keyword in first 100 words',
      '✓ Use keyword variations naturally throughout',
      '✓ Include at least one internal link to related content',
      '✓ Optimize meta description (160 chars)',
      '✓ Use H2 and H3 headings for structure',
      '✓ Include at least one image per section',
      '✓ Include real user quotes from Reddit',
      '✓ Ensure readability (short paragraphs, lists)',
      '✓ Add schema markup for rich snippets',
      '✓ Include strong call to action'
    ]
  };
}

// Extract common themes from Reddit data
function extractCommonThemes(topic, redditData) {
  const themes = {};
  const keyword = topic.keyword.toLowerCase();

  redditData.forEach(post => {
    const content = `${post.title} ${post.top_comment || ''}`.toLowerCase();

    if (content.includes(keyword)) {
      // Extract themes
      const themeKeywords = ['fix', 'problem', 'issue', 'love', 'hate', 'great', 'terrible', 'better', 'worse', 'recommend', 'avoid'];

      themeKeywords.forEach(theme => {
        if (content.includes(theme)) {
          themes[theme] = (themes[theme] || 0) + 1;
        }
      });
    }
  });

  // Return top themes
  return Object.entries(themes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, count]) => ({ theme, mentions: count }));
}

// Save story prompts to JSON
function saveStoryPrompts(prompts) {
  try {
    const output = {
      timestamp: new Date().toISOString(),
      summary: {
        total_prompts: prompts.length,
        avg_score: (prompts.reduce((sum, p) => sum + p.score, 0) / prompts.length).toFixed(2),
        topics_with_reddit: prompts.filter(p => p.reddit_insights.total_relevant_posts > 0).length,
        avg_word_count: Math.round(
          prompts.reduce((sum, p) => sum + p.structure.total_word_count, 0) / prompts.length
        )
      },
      prompts: prompts
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n✅ Story prompts saved to ${path.basename(OUTPUT_FILE)}`);
    console.log(`📊 Generated ${prompts.length} detailed writing briefs`);

    return prompts;
  } catch (error) {
    console.error(`❌ Error saving prompts: ${error.message}`);
    throw error;
  }
}

// Display sample prompt
function displaySamplePrompt(prompts) {
  if (prompts.length === 0) return;

  const sample = prompts[0];

  console.log('\n🎯 Sample Story Prompt (Top Topic):\n');
  console.log(`Rank: ${sample.rank}`);
  console.log(`Keyword: ${sample.keyword}`);
  console.log(`Score: ${sample.score}`);
  console.log(`Title: ${sample.structure.title}`);
  console.log(`Word Count: ${sample.structure.total_word_count}`);
  console.log(`Audience: ${sample.target_audience}`);
  console.log(`Intent: ${sample.search_intent}`);
  console.log(`\nStructure:`);
  sample.structure.sections.forEach(section => {
    console.log(`  - ${section.heading} (${section.word_count} words)`);
  });
  console.log(`\nMeta Description: ${sample.seo_optimization.meta_description}`);
  console.log(`\nContent Angle: ${sample.content_angle.primary_angle}`);
  if (sample.reddit_insights.user_quotes.length > 0) {
    console.log(`\nTop Reddit Quote: "${sample.reddit_insights.user_quotes[0].quote}"`);
  }
  console.log(`\nCTA: ${sample.cta}`);
}

// Main function
async function main() {
  try {
    console.log('═══════════════════════════════════════════════════════');
    console.log('    Story Prompt Generator for Content Creation');
    console.log('═══════════════════════════════════════════════════════\n');

    // Load data
    console.log('📂 Loading source files...');
    const rankedTopics = loadRankedTopics();
    const redditData = loadRedditData();

    console.log(`   ✓ Loaded ${rankedTopics.length} ranked topics`);
    console.log(`   ✓ Loaded ${redditData.length} Reddit posts`);

    if (rankedTopics.length === 0) {
      console.warn('\n⚠️  No ranked topics found. Please run: npm run rank');
      return;
    }

    // Generate story prompts
    console.log('\n📝 Generating story prompts...');
    const prompts = rankedTopics.map((topic, index) =>
      createStoryPrompt(topic, redditData, index)
    );

    console.log(`✓ Generated ${prompts.length} detailed writing briefs`);

    // Save to file
    const savedPrompts = saveStoryPrompts(prompts);

    // Display sample
    displaySamplePrompt(savedPrompts);

    // Summary statistics
    console.log('\n📈 Statistics:');
    console.log(`   Total prompts: ${savedPrompts.length}`);
    console.log(`   Average score: ${savedPrompts.reduce((s, p) => s + p.score, 0) / savedPrompts.length}.toFixed(2)`);
    console.log(`   Topics with Reddit data: ${savedPrompts.filter(p => p.reddit_insights.total_relevant_posts > 0).length}`);
    console.log(`   Average word count: ${Math.round(savedPrompts.reduce((s, p) => s + p.structure.total_word_count, 0) / savedPrompts.length)}`);

    console.log(`\n💡 Ready for content generation!`);
    console.log(`   Use story_prompts.json to guide your LLM in creating SEO-optimized articles.\n`);

    return savedPrompts;
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Export functions
module.exports = {
  loadRankedTopics,
  loadRedditData,
  createStoryPrompt,
  generateArticleStructure,
  generateSEOTips,
  saveStoryPrompts,
  main
};

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}
