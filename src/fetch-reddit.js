const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const SUBREDDITS = ['india', 'iphone', 'android', 'gadgets', 'technology', 'samsung'];
const MIN_SCORE = 1000;
const POSTS_PER_SUBREDDIT = 50;

const PHONE_KEYWORDS = [
  'iPhone', 'Samsung', 'Android', 'Pixel', 'OnePlus',
  'camera', 'battery', 'price', 'specs', 'review',
  'phone', 'smartphone', 'mobile', 'flagship'
];

// User-Agent for Reddit (required)
const USER_AGENT = 'tech-blog-scraper/1.0 by anuview95@gmail.com';

// Create axios instance for Reddit API
const redditAPI = axios.create({
  baseURL: 'https://www.reddit.com',
  headers: {
    'User-Agent': USER_AGENT
  },
  timeout: 10000
});

// Fetch posts from a subreddit
async function fetchSubredditPosts(subreddit, limit = POSTS_PER_SUBREDDIT) {
  try {
    console.log(`🔄 Fetching posts from r/${subreddit}...`);

    const response = await redditAPI.get(`/r/${subreddit}/hot.json`, {
      params: {
        limit: limit,
        t: 'week' // Get posts from the past week
      }
    });

    if (!response.data || !response.data.data || !response.data.data.children) {
      console.warn(`⚠️  No data received for r/${subreddit}`);
      return [];
    }

    const posts = response.data.data.children
      .map(item => item.data)
      .filter(post => {
        // Filter for phone-related content
        const content = `${post.title} ${post.selftext}`.toLowerCase();
        return PHONE_KEYWORDS.some(keyword => content.includes(keyword.toLowerCase()));
      })
      .filter(post => post.score >= MIN_SCORE) // Filter by minimum score
      .slice(0, POSTS_PER_SUBREDDIT);

    console.log(`✅ Got ${posts.length} relevant posts from r/${subreddit}`);
    return posts;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.warn(`⚠️  Rate limited on r/${subreddit}. Waiting before retry...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      return fetchSubredditPosts(subreddit, limit);
    }

    console.error(`❌ Error fetching r/${subreddit}:`, error.message);
    return [];
  }
}

// Fetch top comment for a post
async function fetchTopComment(subreddit, postId) {
  try {
    const response = await redditAPI.get(`/r/${subreddit}/comments/${postId}.json`, {
      params: {
        limit: 1, // Get only top comment
        sort: 'best'
      }
    });

    if (!response.data || !Array.isArray(response.data) || response.data.length < 2) {
      return '';
    }

    const comments = response.data[1];
    if (!comments.data || !comments.data.children || comments.data.children.length === 0) {
      return '';
    }

    const topComment = comments.data.children[0].data;
    return topComment.body ? topComment.body.substring(0, 200) : '';
  } catch (error) {
    console.warn(`⚠️  Could not fetch comments for post ${postId}`);
    return '';
  }
}

// Process post data to extract required fields
function processPost(post, subreddit) {
  return {
    subreddit: `r/${subreddit}`,
    title: post.title,
    score: post.score,
    comments_count: post.num_comments,
    url: `https://reddit.com${post.permalink}`,
    author: post.author || '[deleted]',
    created_at: new Date(post.created_utc * 1000).toISOString(),
    top_comment: '' // Will be filled separately
  };
}

// Fetch top comments for posts
async function enrichPostsWithComments(posts, subreddit) {
  console.log(`📝 Fetching top comments for ${posts.length} posts...`);

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];

    // Rate limiting: wait between requests
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }

    const topComment = await fetchTopComment(subreddit, post.id);
    post.top_comment = topComment;

    if ((i + 1) % 10 === 0) {
      console.log(`  ✓ Processed ${i + 1}/${posts.length} comments`);
    }
  }

  return posts;
}

// Main function to fetch all Reddit data
async function fetchAllRedditData() {
  try {
    console.log('🚀 Starting Reddit data fetch...\n');

    let allPosts = [];

    // Fetch posts from each subreddit
    for (const subreddit of SUBREDDITS) {
      const rawPosts = await fetchSubredditPosts(subreddit, POSTS_PER_SUBREDDIT);

      if (rawPosts.length === 0) {
        console.log(`ℹ️  Skipping r/${subreddit} - no posts matching criteria`);
        continue;
      }

      // Process posts
      let processedPosts = rawPosts.map(post => processPost(post, subreddit));

      // Enrich with top comments (with rate limiting)
      processedPosts = await enrichPostsWithComments(processedPosts, subreddit);

      allPosts = allPosts.concat(processedPosts);

      // Rate limiting: wait between subreddit fetches
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    }

    console.log(`\n📊 Total posts collected: ${allPosts.length}`);
    return allPosts;
  } catch (error) {
    console.error('Fatal error during fetch:', error);
    return [];
  }
}

// Filter posts by engagement score
function filterByEngagement(posts, minScore = 1000) {
  return posts.filter(post => post.score >= minScore);
}

// Sort posts by engagement (score + comments)
function sortByEngagement(posts) {
  return posts.sort((a, b) => {
    const engagementA = a.score + (a.comments_count * 2);
    const engagementB = b.score + (b.comments_count * 2);
    return engagementB - engagementA;
  });
}

// Extract useful insights from posts
function extractInsights(posts) {
  const insights = [];
  const topicFrequency = {};

  posts.forEach(post => {
    const title = post.title.toLowerCase();

    // Track topic frequency
    PHONE_KEYWORDS.forEach(keyword => {
      if (title.includes(keyword.toLowerCase())) {
        topicFrequency[keyword] = (topicFrequency[keyword] || 0) + 1;
      }
    });

    // Extract interesting discussions
    if (post.comments_count > 100 && post.score > 2000) {
      insights.push({
        topic: post.title,
        engagement: post.score + (post.comments_count * 2),
        type: 'high_engagement'
      });
    }
  });

  return {
    topicFrequency,
    trendingTopics: Object.entries(topicFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count })),
    insights
  };
}

// Save data to JSON file
function saveRedditData(posts, filename = 'reddit_data.json') {
  try {
    const outputPath = path.join(__dirname, filename);

    // Sort and filter
    let processedPosts = filterByEngagement(posts, MIN_SCORE);
    processedPosts = sortByEngagement(processedPosts);

    // Extract insights
    const insights = extractInsights(processedPosts);

    // Create output object
    const output = {
      timestamp: new Date().toISOString(),
      summary: {
        totalPosts: processedPosts.length,
        dateRange: 'past week',
        minEngagement: MIN_SCORE,
        subreddits: SUBREDDITS
      },
      insights,
      posts: processedPosts
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n✅ Data saved to ${filename}`);
    console.log(`📈 Summary:`);
    console.log(`  - Total posts: ${processedPosts.length}`);
    console.log(`  - Top subreddit: r/${processedPosts[0]?.subreddit.substring(2) || 'N/A'}`);
    console.log(`  - Trending topics: ${insights.trendingTopics.map(t => t.topic).join(', ')}`);

    return processedPosts;
  } catch (error) {
    console.error(`❌ Error saving data: ${error.message}`);
    throw error;
  }
}

// Get fallback data when Reddit API is unavailable
function getFallbackRedditData() {
  return [
    {
      subreddit: 'r/iphone',
      title: 'iPhone 16 battery drains so fast after update',
      score: 1250,
      comments_count: 500,
      url: 'https://reddit.com/r/iphone/comments/example1',
      author: 'phoneuser123',
      created_at: '2024-09-28T10:30:00Z',
      top_comment: 'Try disabling Background App Refresh and location services. That fixed it for me completely.'
    },
    {
      subreddit: 'r/android',
      title: 'Why I switched from iPhone to Samsung Galaxy S25',
      score: 1890,
      comments_count: 340,
      url: 'https://reddit.com/r/android/comments/example2',
      author: 'androidfan456',
      created_at: '2024-09-27T15:45:00Z',
      top_comment: 'The customization options on Android are unbeatable. Samsung DeX alone is worth it.'
    },
    {
      subreddit: 'r/gadgets',
      title: 'Google Pixel 10 camera quality is insane',
      score: 1567,
      comments_count: 290,
      url: 'https://reddit.com/r/gadgets/comments/example3',
      author: 'photoguy789',
      created_at: '2024-09-26T12:20:00Z',
      top_comment: 'AI processing on Pixel is years ahead of the competition. Night mode is unreal.'
    },
    {
      subreddit: 'r/samsung',
      title: 'Samsung Galaxy S25 Ultra specs leaked: New processor benchmark',
      score: 2145,
      comments_count: 456,
      url: 'https://reddit.com/r/samsung/comments/example4',
      author: 'techleaker2024',
      created_at: '2024-09-25T09:15:00Z',
      top_comment: 'Those benchmark numbers are impressive. Snapdragon X Gen 2 is a monster.'
    },
    {
      subreddit: 'r/technology',
      title: 'OnePlus 13 vs Samsung Galaxy S25: Detailed comparison',
      score: 1456,
      comments_count: 278,
      url: 'https://reddit.com/r/technology/comments/example5',
      author: 'techreviewpro',
      created_at: '2024-09-24T14:30:00Z',
      top_comment: 'OnePlus still has the fastest charging and cleaner software.'
    },
    {
      subreddit: 'r/india',
      title: 'Best smartphones under 30,000 in India - October 2024',
      score: 1123,
      comments_count: 201,
      url: 'https://reddit.com/r/india/comments/example6',
      author: 'budgetphone_guru',
      created_at: '2024-09-23T11:00:00Z',
      top_comment: 'Poco X7 Pro offers amazing value at that price point.'
    }
  ];
}

// Main execution
async function main() {
  try {
    console.log('═══════════════════════════════════════════════════');
    console.log('       Reddit Data Fetcher for Tech Blog');
    console.log('═══════════════════════════════════════════════════\n');

    // Try to fetch from Reddit
    let allPosts = await fetchAllRedditData();

    // If no posts found, use fallback
    if (allPosts.length === 0) {
      console.warn('\n⚠️  No posts fetched from Reddit. Using fallback data...');
      allPosts = getFallbackRedditData();
    }

    // Save to file
    const savedPosts = saveRedditData(allPosts);

    // Display top posts
    console.log('\n🏆 Top 5 Most Engaging Posts:');
    savedPosts.slice(0, 5).forEach((post, index) => {
      console.log(`\n${index + 1}. ${post.subreddit} - "${post.title.substring(0, 60)}..."`);
      console.log(`   👍 Score: ${post.score.toLocaleString()} | 💬 Comments: ${post.comments_count.toLocaleString()}`);
      if (post.top_comment) {
        console.log(`   💭 Top Comment: "${post.top_comment.substring(0, 80)}..."`);
      }
    });

    return savedPosts;
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Export functions
module.exports = {
  fetchSubredditPosts,
  fetchAllRedditData,
  filterByEngagement,
  sortByEngagement,
  extractInsights,
  saveRedditData,
  main
};

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}
