const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const STORY_PROMPTS_FILE = path.join(__dirname, 'story_prompts.json');
const OUTPUT_FILE = path.join(__dirname, 'generated_posts.json');

// Ollama Configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral';
const MIN_WORD_COUNT = 3000;
const MAX_POSTS = parseInt(process.env.GENERATE_MAX_POSTS || '10', 10);

// Create axios instance for Ollama API
const ollamaAPI = axios.create({
  baseURL: OLLAMA_BASE_URL,
  timeout: 120000 // 2 minutes for long-form content
});

// Load story prompts
function loadStoryPrompts() {
  try {
    if (!fs.existsSync(STORY_PROMPTS_FILE)) {
      console.warn(`⚠️  ${STORY_PROMPTS_FILE} not found`);
      return [];
    }

    const data = JSON.parse(fs.readFileSync(STORY_PROMPTS_FILE, 'utf8'));
    return data.prompts || [];
  } catch (error) {
    console.error(`❌ Error loading story prompts: ${error.message}`);
    return [];
  }
}

// Create system instruction from story prompt
function createSystemInstruction(prompt) {
  const sections = prompt.structure.sections
    .map(s => `- ${s.heading}: ${s.instructions} (${s.word_count} words)`)
    .join('\n');

  const redditQuotes = prompt.reddit_insights.user_quotes
    .map(q => `"${q.quote}" (from ${q.source})`)
    .join('\n');

  const keywordVariations = prompt.seo_optimization.keyword_variations.join(', ');

  const internalLinks = prompt.seo_optimization.internal_link_targets.join(', ');

  return `You are an expert tech writer creating a comprehensive guide about "${prompt.keyword}".

TOPIC OVERVIEW:
- Primary keyword: ${prompt.keyword}
- Search intent: ${prompt.search_intent}
- Target audience: ${prompt.target_audience}
- Content angle: ${prompt.content_angle.primary_angle}
- Unique aspect: ${prompt.content_angle.unique_aspect}

ARTICLE STRUCTURE (${prompt.structure.total_word_count} words minimum, aim for 3,000+ words):
${sections}

SEO REQUIREMENTS:
- Primary keyword: "${prompt.keyword}"
- Keyword variations to naturally include: ${keywordVariations}
- Meta description (for reference): ${prompt.seo_optimization.meta_description}
- Schema type: ${prompt.seo_optimization.schema_type}
- Internal links to mention: ${internalLinks}

REAL USER INSIGHTS TO INCLUDE:
These are actual user quotes from Reddit discussions about this topic. Use them naturally in the article:
${redditQuotes}

COMMON THEMES FROM DISCUSSIONS:
${prompt.reddit_insights.common_themes.map(t => `- ${t.theme} (mentioned ${t.mentions} times)`).join('\n')}

WRITING INSTRUCTIONS:
- Tone: ${prompt.writing_instructions.tone}
- Perspective: ${prompt.writing_instructions.perspective}
- Length: Minimum 3,000 words (aim for 3,500+)
- Formatting: Use clear headings (H2, H3), bullet points, bold text for emphasis
- Specificity: ${prompt.writing_instructions.specificity}
- Citations: Attribute Reddit quotes with "As one user mentioned on Reddit:"
- CTA: End with: "${prompt.cta}"

CRITICAL REQUIREMENTS:
1. Write naturally - NOT as AI-generated content, but as expert advice
2. Include ALL sections from the structure above
3. Weave in the Reddit quotes naturally (at least 2-3 quotes)
4. Hit the word count target (minimum 3,000 words)
5. Use keyword variations naturally throughout (don't keyword stuff)
6. Include actionable information and step-by-step guidance
7. Address the search intent: "${prompt.search_intent}"
8. Target audience: "${prompt.target_audience}"

READABILITY CHECKLIST:
${prompt.seo_optimization.readability_tips.map(tip => `- ${tip}`).join('\n')}

BEGIN WRITING THE ARTICLE NOW.
Title: ${prompt.structure.title}
Make it comprehensive, helpful, and SEO-optimized.`;
}

// Create user message with additional context
function createUserMessage(prompt) {
  return `Write a comprehensive article titled "${prompt.structure.title}" following the system instructions provided.

  The article should be ${prompt.structure.total_word_count}+ words and thoroughly cover the search intent: "${prompt.search_intent}".

  Remember to:
  1. Include all sections from the structure
  2. Naturally incorporate the Reddit user quotes
  3. Use keyword variations throughout
  4. Target the audience: "${prompt.target_audience}"
  5. Follow the content angle: "${prompt.content_angle.primary_angle}"
  6. End with the specified CTA

  Write with authority and helpful tone. Start the article now.`;
}

// Call Ollama API to generate article
async function generateArticleWithOllama(prompt) {
  try {
    console.log(`✍️  Generating: "${prompt.keyword}"`);

    const systemInstruction = createSystemInstruction(prompt);
    const userMessage = createUserMessage(prompt);

    const response = await ollamaAPI.post('/api/chat', {
      model: OLLAMA_MODEL,
      messages: [
        {
          role: 'system',
          content: systemInstruction
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      stream: false,
      options: {
        temperature: 0.7,
        top_k: 40,
        top_p: 0.9,
        num_ctx: 8000
      }
    });

    if (!response.data || !response.data.message || !response.data.message.content) {
      console.warn(`⚠️  Empty response from Ollama`);
      return null;
    }

    const content = response.data.message.content.trim();

    // Validate minimum word count
    const wordCount = content.split(/\s+/).length;
    if (wordCount < MIN_WORD_COUNT) {
      console.warn(`⚠️  Generated content too short (${wordCount} words, need ${MIN_WORD_COUNT})`);
      return null;
    }

    console.log(`   ✓ Generated ${wordCount} words`);

    return {
      content: content,
      wordCount: wordCount
    };
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to Ollama at ${OLLAMA_BASE_URL}`);
      console.error(`   Make sure Ollama is running: ollama serve`);
    } else if (error.response?.status === 404) {
      console.error(`❌ Model "${OLLAMA_MODEL}" not found in Ollama`);
      console.error(`   Install it with: ollama pull ${OLLAMA_MODEL}`);
    } else {
      console.error(`❌ Error generating article: ${error.message}`);
    }
    return null;
  }
}

// Extract metadata from content
function extractMetadata(prompt, content) {
  // Check which sections are covered
  const sectionsCovered = prompt.structure.sections
    .filter(section => {
      const sectionText = section.heading.toLowerCase();
      return content.toLowerCase().includes(sectionText);
    })
    .map(section => section.heading);

  // Extract key topics mentioned
  const keywordVariations = prompt.seo_optimization.keyword_variations;
  const keywordsMentioned = keywordVariations.filter(keyword =>
    content.toLowerCase().includes(keyword.toLowerCase())
  );

  // Count Reddit quotes used
  const redditQuotesCount = prompt.reddit_insights.user_quotes.filter(quote =>
    content.includes(quote.text.substring(0, 30))
  ).length;

  return {
    sections_included: sectionsCovered,
    sections_total: prompt.structure.sections.length,
    keywords_targeted: prompt.seo_optimization.keyword_variations.length,
    keywords_mentioned: keywordsMentioned.length,
    reddit_quotes_used: redditQuotesCount,
    reddit_quotes_available: prompt.reddit_insights.user_quotes.length
  };
}

// Create post object
function createPost(prompt, generated) {
  const metadata = extractMetadata(prompt, generated.content);

  // Extract intro section for preview
  const contentLines = generated.content.split('\n');
  const introEnd = contentLines.findIndex((line, idx) =>
    idx > 0 && /^#{2,}/.test(line)
  );
  const preview = contentLines.slice(0, introEnd > 0 ? introEnd : 3).join('\n');

  return {
    title: prompt.structure.title,
    content: generated.content,
    preview: preview.substring(0, 300) + '...',
    keyword: prompt.keyword,
    word_count: generated.wordCount,
    structure_used: `story_prompt_rank_${prompt.rank}`,
    seo_score: prompt.score,
    search_intent: prompt.search_intent,
    target_audience: prompt.target_audience,
    category: prompt.category,
    sections_included: metadata.sections_included,
    metadata: {
      meta_description: prompt.seo_optimization.meta_description,
      focus_keyword: prompt.seo_optimization.focus_keyword,
      keyword_variations: prompt.seo_optimization.keyword_variations,
      internal_links: prompt.seo_optimization.internal_link_targets,
      schema_type: prompt.seo_optimization.schema_type,
      content_angle: prompt.content_angle.primary_angle,
      credibility_boosters: prompt.content_angle.credibility_boosters
    },
    quality_metrics: {
      coverage: {
        sections: `${metadata.sections_included.length}/${metadata.sections_total}`,
        keywords: `${metadata.keywords_mentioned.length}/${metadata.keywords_targeted}`,
        reddit_quotes: `${metadata.reddit_quotes_used}/${metadata.reddit_quotes_available}`
      }
    },
    cta: prompt.cta,
    timestamp: new Date().toISOString(),
    source: 'ollama_with_story_prompts'
  };
}

// Save generated posts
function saveGeneratedPosts(posts) {
  try {
    const output = {
      timestamp: new Date().toISOString(),
      summary: {
        total_posts: posts.length,
        total_words: posts.reduce((sum, p) => sum + p.word_count, 0),
        avg_words_per_post: Math.round(posts.reduce((sum, p) => sum + p.word_count, 0) / posts.length),
        avg_seo_score: (posts.reduce((sum, p) => sum + p.seo_score, 0) / posts.length).toFixed(2),
        model: OLLAMA_MODEL,
        min_word_count: MIN_WORD_COUNT
      },
      posts: posts
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n✅ Generated posts saved to ${path.basename(OUTPUT_FILE)}`);
    console.log(`📊 Generated ${posts.length} articles (${output.summary.total_words.toLocaleString()} total words)`);

    return posts;
  } catch (error) {
    console.error(`❌ Error saving posts: ${error.message}`);
    throw error;
  }
}

// Display generation summary
function displaySummary(posts) {
  if (posts.length === 0) {
    console.log('\n⚠️  No articles generated');
    return;
  }

  console.log('\n📝 Generated Articles Summary:\n');

  posts.forEach((post, index) => {
    console.log(`${index + 1}. ${post.title}`);
    console.log(`   📊 Score: ${post.seo_score.toFixed(2)}`);
    console.log(`   📖 Words: ${post.word_count.toLocaleString()}`);
    console.log(`   🎯 Keyword: ${post.keyword}`);
    console.log(`   ✓ Sections: ${post.quality_metrics.coverage.sections}`);
    console.log(`   ✓ Keywords: ${post.quality_metrics.coverage.keywords}`);
    console.log(`   ✓ Reddit Quotes: ${post.quality_metrics.coverage.reddit_quotes}`);
    console.log('');
  });

  const totalWords = posts.reduce((sum, p) => sum + p.word_count, 0);
  const avgScore = (posts.reduce((sum, p) => sum + p.seo_score, 0) / posts.length).toFixed(2);

  console.log(`📈 Statistics:`);
  console.log(`   Total articles: ${posts.length}`);
  console.log(`   Total words: ${totalWords.toLocaleString()}`);
  console.log(`   Average score: ${avgScore}`);
  console.log(`   Average per article: ${Math.round(totalWords / posts.length).toLocaleString()} words`);
}

// Main function
async function main() {
  try {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Content Generation with Story Prompts & Ollama');
    console.log('═══════════════════════════════════════════════════════\n');

    // Load story prompts
    console.log('📂 Loading story prompts...');
    const prompts = loadStoryPrompts();

    if (prompts.length === 0) {
      console.warn('⚠️  No story prompts found');
      console.warn('   Run: npm run prompts');
      return;
    }

    console.log(`✓ Loaded ${prompts.length} story prompts`);
    console.log(`ℹ️  Generating top ${Math.min(MAX_POSTS, prompts.length)} articles\n`);

    // Check Ollama connection
    console.log(`🔌 Checking Ollama connection at ${OLLAMA_BASE_URL}...`);
    try {
      await ollamaAPI.get('/api/tags');
      console.log(`✓ Connected to Ollama (model: ${OLLAMA_MODEL})\n`);
    } catch (error) {
      console.error(`❌ Cannot connect to Ollama at ${OLLAMA_BASE_URL}`);
      console.error(`\n📝 To use this script, start Ollama:`);
      console.error(`   1. Install Ollama from https://ollama.ai`);
      console.error(`   2. Run: ollama serve`);
      console.error(`   3. In another terminal: ollama pull ${OLLAMA_MODEL}`);
      process.exit(1);
    }

    // Generate articles
    const generatedPosts = [];
    const postsToGenerate = prompts.slice(0, Math.min(MAX_POSTS, prompts.length));

    for (let i = 0; i < postsToGenerate.length; i++) {
      const prompt = postsToGenerate[i];

      console.log(`[${i + 1}/${postsToGenerate.length}]`);

      // Generate with Ollama
      const generated = await generateArticleWithOllama(prompt);

      if (generated) {
        const post = createPost(prompt, generated);
        generatedPosts.push(post);
        console.log(`   ✅ Saved\n`);
      } else {
        console.log(`   ⏭️  Skipped\n`);
      }

      // Rate limiting to avoid overwhelming Ollama
      if (i < postsToGenerate.length - 1) {
        console.log('⏳ Rate limiting (2 seconds)...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Save results
    if (generatedPosts.length > 0) {
      saveGeneratedPosts(generatedPosts);
      displaySummary(generatedPosts);

      console.log(`\n💡 Next steps:`);
      console.log(`   1. Review generated_posts.json for quality`);
      console.log(`   2. Run: npm run seo (to optimize)`);
      console.log(`   3. Run: npm run post (to publish to WordPress)`);
    } else {
      console.warn('\n⚠️  No articles were successfully generated');
      console.warn('   Check Ollama connection and try again');
    }

    return generatedPosts;
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Export functions
module.exports = {
  loadStoryPrompts,
  generateArticleWithOllama,
  createPost,
  saveGeneratedPosts,
  main
};

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}
