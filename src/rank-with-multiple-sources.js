const fs = require('fs');
const path = require('path');

// File paths
const TRENDS_FILE = path.join(__dirname, 'trending_topics.json');
const REDDIT_FILE = path.join(__dirname, 'reddit_data.json');
const OUTPUT_FILE = path.join(__dirname, 'ranked_topics.json');

// Configuration
const SCORE_THRESHOLD = 0.5;
const MAX_TOPICS = 100;
const MIN_REDDIT_ENGAGEMENT = 100; // Minimum upvotes + comments to consider

// Load JSON files
function loadTrendsData() {
  try {
    if (!fs.existsSync(TRENDS_FILE)) {
      console.warn(`⚠️  ${TRENDS_FILE} not found`);
      return { trends: [] };
    }

    const data = JSON.parse(fs.readFileSync(TRENDS_FILE, 'utf8'));
    return data.trends || data;
  } catch (error) {
    console.error(`❌ Error loading trends file: ${error.message}`);
    return [];
  }
}

function loadRedditData() {
  try {
    if (!fs.existsSync(REDDIT_FILE)) {
      console.warn(`⚠️  ${REDDIT_FILE} not found`);
      return { posts: [] };
    }

    const data = JSON.parse(fs.readFileSync(REDDIT_FILE, 'utf8'));
    return data.posts || data;
  } catch (error) {
    console.error(`❌ Error loading Reddit file: ${error.message}`);
    return [];
  }
}

// Calculate normalized scores
function calculateTrendScore(volume) {
  // Normalize volume: divide by 100,000
  return Math.min((volume || 0) / 100000, 1.0);
}

function calculateRedditScore(upvotes, comments) {
  // Calculate engagement: (upvotes + comments*0.5) / 5000
  const engagement = (upvotes || 0) + ((comments || 0) * 0.5);
  return Math.min(engagement / 5000, 1.0);
}

function calculateSpecificityScore(keyword) {
  // Specificity based on keyword length
  // Longer keywords = more specific (capped at 10 words)
  const wordCount = (keyword || '').split(' ').length;
  const maxWords = 10;
  return Math.min(wordCount / maxWords, 1.0);
}

// Calculate combined score
function calculateCombinedScore(trendScore, redditScore, specificityScore) {
  return (trendScore * 0.5) + (redditScore * 0.3) + (specificityScore * 0.2);
}

// Extract keywords from Reddit posts
function extractRedditKeywords(redditPosts) {
  const keywordMap = {};

  redditPosts.forEach(post => {
    // Extract keywords from title and comments
    const content = `${post.title} ${post.top_comment || ''}`.toLowerCase();
    const keywords = extractPhoneRelatedKeywords(content);

    keywords.forEach(keyword => {
      if (!keywordMap[keyword]) {
        keywordMap[keyword] = {
          upvotes: 0,
          comments: 0,
          redditCount: 0,
          subreddits: new Set()
        };
      }

      keywordMap[keyword].upvotes += post.score || 0;
      keywordMap[keyword].comments += post.comments_count || 0;
      keywordMap[keyword].redditCount += 1;
      keywordMap[keyword].subreddits.add(post.subreddit);
    });
  });

  return keywordMap;
}

// Extract phone-related keywords from text
function extractPhoneRelatedKeywords(text) {
  const phoneKeywords = [
    'iPhone', 'Samsung', 'Android', 'Pixel', 'OnePlus',
    'camera', 'battery', 'specs', 'price', 'review',
    'comparison', 'tutorial', 'display', 'processor', 'storage'
  ];

  const keywords = new Set();
  const words = text.split(/\s+/);

  // Extract individual keywords
  phoneKeywords.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      keywords.add(keyword);
    }
  });

  // Extract multi-word phrases (2-3 words)
  for (let i = 0; i < words.length - 1; i++) {
    const phrase2 = `${words[i]} ${words[i + 1]}`.toLowerCase();
    if (phrase2.includes('iphone') || phrase2.includes('galaxy') ||
        phrase2.includes('pixel') || phrase2.includes('battery') ||
        phrase2.includes('camera')) {
      keywords.add(phrase2);
    }

    if (i < words.length - 2) {
      const phrase3 = `${words[i]} ${words[i + 1]} ${words[i + 2]}`.toLowerCase();
      if (phrase3.length < 50) { // Reasonable phrase length
        keywords.add(phrase3);
      }
    }
  }

  return Array.from(keywords);
}

// Find Reddit engagement for a trend keyword
function getRedditEngagementForKeyword(keyword, redditPosts) {
  let totalUpvotes = 0;
  let totalComments = 0;
  let matchingPosts = 0;
  const matchedSubreddits = new Set();

  redditPosts.forEach(post => {
    const content = `${post.title} ${post.top_comment || ''}`.toLowerCase();
    if (content.includes(keyword.toLowerCase())) {
      totalUpvotes += post.score || 0;
      totalComments += post.comments_count || 0;
      matchingPosts += 1;
      matchedSubreddits.add(post.subreddit);
    }
  });

  return {
    upvotes: totalUpvotes,
    comments: totalComments,
    posts: matchingPosts,
    subreddits: Array.from(matchedSubreddits)
  };
}

// Rank all topics
function rankTopics(trendTopics, redditPosts) {
  const rankedTopics = [];
  const processedKeywords = new Set();

  console.log('🔍 Processing trend topics...');

  // Process Google Trends topics
  trendTopics.forEach((trend, index) => {
    if (processedKeywords.has(trend.keyword)) {
      return; // Skip duplicates
    }
    processedKeywords.add(trend.keyword);

    // Get Reddit data for this keyword
    const redditEngagement = getRedditEngagementForKeyword(trend.keyword, redditPosts);

    // Calculate scores
    const trendScore = calculateTrendScore(trend.volume);
    const redditScore = calculateRedditScore(redditEngagement.upvotes, redditEngagement.comments);
    const specificityScore = calculateSpecificityScore(trend.keyword);
    const combinedScore = calculateCombinedScore(trendScore, redditScore, specificityScore);

    // Only include if score is above threshold
    if (combinedScore >= SCORE_THRESHOLD) {
      const sources = ['Google Trends'];
      if (redditEngagement.posts > 0) {
        sources.push(`Reddit (${redditEngagement.posts} posts)`);
      }

      rankedTopics.push({
        keyword: trend.keyword,
        score: parseFloat(combinedScore.toFixed(2)),
        trend_volume: trend.volume,
        reddit_engagement: redditEngagement.upvotes + (redditEngagement.comments * 0.5),
        reddit_posts: redditEngagement.posts,
        sources: sources,
        category: trend.category || 'General',
        trend_direction: trend.trend || 'stable',
        subreddits: redditEngagement.subreddits,
        scores: {
          trend: parseFloat(trendScore.toFixed(3)),
          reddit: parseFloat(redditScore.toFixed(3)),
          specificity: parseFloat(specificityScore.toFixed(3))
        }
      });
    }
  });

  console.log(`📊 Processed ${trendTopics.length} trends, ${rankedTopics.length} qualify`);

  // Sort by combined score (descending)
  rankedTopics.sort((a, b) => b.score - a.score);

  // Add ranks and limit to MAX_TOPICS
  return rankedTopics
    .slice(0, MAX_TOPICS)
    .map((topic, index) => ({
      rank: index + 1,
      ...topic
    }));
}

// Generate content angle suggestions
function generateContentAngle(topic) {
  const keyword = topic.keyword.toLowerCase();
  const angles = [];

  // Battery-related
  if (keyword.includes('battery')) {
    angles.push('Battery optimization guide');
    angles.push('Tips to improve battery life');
    angles.push('Comparison of battery performance');
  }

  // Camera-related
  if (keyword.includes('camera')) {
    angles.push('Camera comparison and features');
    angles.push('Photography tips and tricks');
    angles.push('Best camera settings guide');
  }

  // Price-related
  if (keyword.includes('price') || keyword.includes('cost')) {
    angles.push('Price comparison analysis');
    angles.push('Best deals and discounts');
    angles.push('Value for money assessment');
  }

  // Review-related
  if (keyword.includes('review')) {
    angles.push('Detailed product review');
    angles.push('Pros and cons analysis');
    angles.push('User experience breakdown');
  }

  // Comparison
  if (keyword.includes('vs') || keyword.includes('versus') || keyword.includes('comparison')) {
    angles.push('Side-by-side comparison');
    angles.push('Which one should you buy?');
    angles.push('Feature comparison analysis');
  }

  // Specs
  if (keyword.includes('spec')) {
    angles.push('Technical specifications breakdown');
    angles.push('Performance analysis');
    angles.push('Hardware features explained');
  }

  // Default angles
  if (angles.length === 0) {
    if (topic.reddit_posts > 0) {
      angles.push('Real user experiences and discussion');
      angles.push('Comprehensive guide based on user feedback');
    } else {
      angles.push('Trending topic analysis');
      angles.push('Everything you need to know');
    }
  }

  return angles[0] || 'Trending topic guide';
}

// Save ranked topics to JSON
function saveRankedTopics(rankedTopics) {
  try {
    // Create output object
    const output = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTopics: rankedTopics.length,
        topicScoreRange: rankedTopics.length > 0 ? {
          highest: rankedTopics[0].score,
          lowest: rankedTopics[rankedTopics.length - 1].score
        } : null,
        scoreThreshold: SCORE_THRESHOLD,
        weightings: {
          trends: '50%',
          reddit: '30%',
          specificity: '20%'
        }
      },
      topics: rankedTopics.map(topic => ({
        rank: topic.rank,
        keyword: topic.keyword,
        score: topic.score,
        trend_volume: topic.trend_volume,
        reddit_engagement: topic.reddit_engagement,
        sources: topic.sources,
        category: topic.category,
        angle: generateContentAngle(topic),
        subreddits: topic.subreddits.slice(0, 3), // Top 3 subreddits
        trend_direction: topic.trend_direction
      }))
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n✅ Ranked topics saved to ${path.basename(OUTPUT_FILE)}`);

    return rankedTopics;
  } catch (error) {
    console.error(`❌ Error saving ranked topics: ${error.message}`);
    throw error;
  }
}

// Display top topics
function displayTopTopics(rankedTopics, limit = 10) {
  console.log(`\n🏆 Top ${Math.min(limit, rankedTopics.length)} Ranked Topics:\n`);

  rankedTopics.slice(0, limit).forEach((topic, index) => {
    console.log(`${topic.rank}. ${topic.keyword}`);
    console.log(`   📊 Score: ${topic.score.toFixed(2)}`);
    console.log(`   📈 Trends: ${topic.trend_volume.toLocaleString()} searches`);
    console.log(`   💬 Reddit: ${topic.reddit_posts} posts (${topic.reddit_engagement.toFixed(0)} engagement)`);
    console.log(`   📝 Angle: ${generateContentAngle(topic)}`);
    console.log(`   🔗 Sources: ${topic.sources.join(', ')}`);
    console.log('');
  });
}

// Get statistics
function getStatistics(rankedTopics, originalTrends, redditPosts) {
  const stats = {
    totalTrends: originalTrends.length,
    totalRedditPosts: redditPosts.length,
    rankedTopics: rankedTopics.length,
    avgScore: rankedTopics.length > 0
      ? (rankedTopics.reduce((sum, t) => sum + t.score, 0) / rankedTopics.length).toFixed(2)
      : 0,
    topicsWithReddit: rankedTopics.filter(t => t.reddit_posts > 0).length,
    categoryBreakdown: {}
  };

  rankedTopics.forEach(topic => {
    const cat = topic.category || 'General';
    stats.categoryBreakdown[cat] = (stats.categoryBreakdown[cat] || 0) + 1;
  });

  return stats;
}

// Main function
async function main() {
  try {
    console.log('═══════════════════════════════════════════════════════');
    console.log('    Multi-Source Topic Ranking System');
    console.log('═══════════════════════════════════════════════════════\n');

    // Load data
    console.log('📂 Loading source files...');
    const trendTopics = loadTrendsData();
    const redditPosts = loadRedditData();

    console.log(`   ✓ Loaded ${trendTopics.length || 0} trends`);
    console.log(`   ✓ Loaded ${redditPosts.length || 0} Reddit posts`);

    if (!trendTopics || trendTopics.length === 0) {
      console.warn('\n⚠️  No trend topics found. Please run: npm run trends');
      return;
    }

    // Rank topics
    const rankedTopics = rankTopics(trendTopics, redditPosts);

    // Get statistics
    const stats = getStatistics(rankedTopics, trendTopics, redditPosts);
    console.log('\n📈 Ranking Statistics:');
    console.log(`   Total trends analyzed: ${stats.totalTrends}`);
    console.log(`   Reddit posts analyzed: ${stats.totalRedditPosts}`);
    console.log(`   Topics that qualified: ${stats.rankedTopics}`);
    console.log(`   Average score: ${stats.avgScore}`);
    console.log(`   Topics with Reddit discussion: ${stats.topicsWithReddit}`);
    console.log(`   Category breakdown:`, stats.categoryBreakdown);

    // Save to file
    const savedTopics = saveRankedTopics(rankedTopics);

    // Display top topics
    displayTopTopics(savedTopics, 10);

    console.log(`\n💡 Use ranked_topics.json to guide your content creation strategy!`);
    console.log(`   Focus on high-scoring topics that align with user interests.\n`);

    return savedTopics;
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Export functions
module.exports = {
  loadTrendsData,
  loadRedditData,
  rankTopics,
  calculateCombinedScore,
  saveRankedTopics,
  main
};

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}
