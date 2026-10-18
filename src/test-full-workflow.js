const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// TEST FULL WORKFLOW - Generate & Post 5 Sample Articles
// ═══════════════════════════════════════════════════════════════

const WORDPRESS_URL = process.env.WORDPRESS_SITE || 'https://potatotech.in';
const WP_USERNAME = process.env.WORDPRESS_USERNAME;
const WP_PASSWORD = process.env.WORDPRESS_PASSWORD;

// Create WordPress API client
const wpAPI = axios.create({
  baseURL: `${WORDPRESS_URL}/wp-json/wp/v2`,
  auth: {
    username: WP_USERNAME,
    password: WP_PASSWORD
  },
  timeout: 10000
});

// Sample articles to post
const SAMPLE_ARTICLES = [
  {
    title: "iPhone 16 Battery Drain: Complete Fix Guide (2026)",
    content: `<h2>Understanding the iPhone 16 Battery Drain Issue</h2>
<p>The iPhone 16 battery drain issue has become a common complaint among users after recent iOS updates. Many users report that their battery drains significantly faster than before, sometimes losing 20-30% in just a few hours of normal use.</p>

<h2>What's Causing the Drain?</h2>
<p>According to user discussions on Reddit, there are several key factors contributing to the battery drain problem:</p>
<ul>
<li>Background app refresh running continuously</li>
<li>Location services enabled for multiple apps</li>
<li>High screen brightness settings</li>
<li>Heavy use of AI-powered features</li>
<li>Recent iOS update optimization issues</li>
</ul>

<h2>Real User Experiences</h2>
<p>"Try disabling Background App Refresh and location services. That fixed it for me completely," says one Reddit user with 1,250 upvotes.</p>
<p>"After the iOS update, my battery was dying in 2 hours. It was incredibly frustrating," another user reported.</p>

<h2>Step-by-Step Fixes</h2>
<h3>Fix 1: Disable Background App Refresh</h3>
<p>Go to Settings > General > Background App Refresh and toggle it off. This is the most mentioned fix on Reddit and has helped thousands of users.</p>

<h3>Fix 2: Turn Off Location Services</h3>
<p>Settings > Privacy > Location Services. Only enable this for apps that truly need it.</p>

<h3>Fix 3: Reduce Screen Brightness</h3>
<p>Enable Auto-brightness or manually reduce brightness in Settings > Display & Brightness.</p>

<h3>Fix 4: Disable AI Features Temporarily</h3>
<p>Some users report that disabling AI-powered features reduces drain significantly.</p>

<h2>When to Replace vs Fix</h2>
<p>If none of these fixes work after 2-3 days, it might be a hardware issue. Apple offers battery replacement for $69 under warranty.</p>

<h2>Conclusion</h2>
<p>Most iPhone 16 battery drain issues can be resolved through software settings adjustments. Start with the recommended fixes above, and if the problem persists, contact Apple Support. Share your experience in the comments below!</p>`,
    excerpt: "Expert guide to fixing iPhone 16 battery drain with real solutions from Reddit discussions and official Apple recommendations.",
    categories: [1],
    tags: ["iPhone 16", "battery drain", "fix", "tutorial"],
    featured_media: 0,
    status: 'draft'
  },
  {
    title: "Samsung Galaxy S25 vs iPhone 16: Detailed Comparison (2026)",
    content: `<h2>Overview: Two Flagship Phones, Different Philosophies</h2>
<p>The Samsung Galaxy S25 and iPhone 16 represent the pinnacle of smartphone technology in 2026. Both phones offer premium features, but they cater to different user preferences and ecosystems.</p>

<h2>Technical Specifications Comparison</h2>
<p><strong>Processor:</strong> Samsung Galaxy S25 uses the latest Snapdragon, while iPhone 16 uses Apple's custom A18 chip. In real-world tests, both perform equally well for daily tasks.</p>
<p><strong>Display:</strong> S25 features a 6.7" AMOLED with 120Hz, while iPhone 16 offers 6.3" OLED with ProMotion. The S25 has a larger screen, but iPhone 16's is sharper.</p>
<p><strong>Camera:</strong> S25: 200MP main, iPhone 16: 48MP main. Higher megapixels don't always mean better photos - iPhone's AI processing often wins in challenging conditions.</p>

<h2>Design and Build Quality</h2>
<p>The Samsung Galaxy S25 features a premium glass back and aluminum frame. iPhone 16 uses aerospace-grade titanium and ceramic shield. Both feel premium, but the iPhone feels more durable.</p>

<h2>Software and User Experience</h2>
<p>This is where the choice becomes personal. Android offers customization; iOS offers simplicity and security. As one Reddit user noted: "The customization on Android is unbeatable."</p>

<h2>Battery and Charging</h2>
<p>Samsung Galaxy S25: 4500mAh with 65W fast charging (full charge in 30 mins). iPhone 16: 3850mAh with 25W fast charging (full charge in 45 mins). The S25 wins on charging speed.</p>

<h2>Which Should You Buy?</h2>
<p><strong>Choose Samsung Galaxy S25 if you:</strong> Want a larger screen, value customization, or prefer fast charging.</p>
<p><strong>Choose iPhone 16 if you:</strong> Want a premium build, prefer simplicity, or use other Apple devices.</p>

<h2>Conclusion</h2>
<p>Both phones are excellent choices. Your decision should be based on your ecosystem preference and use case. Share your experience in the comments!</p>`,
    excerpt: "Complete side-by-side comparison of the Samsung Galaxy S25 and iPhone 16 with specs, design, camera quality, and performance analysis.",
    categories: [1],
    tags: ["Samsung", "iPhone", "comparison", "specs"],
    featured_media: 0,
    status: 'draft'
  },
  {
    title: "Google Pixel 10 AI Features Explained: Complete Breakdown",
    content: `<h2>Introduction to Pixel 10's AI Capabilities</h2>
<p>The Google Pixel 10 represents a significant leap in smartphone AI capabilities. Google has integrated AI into virtually every aspect of the phone, from photography to daily tasks.</p>

<h2>Magic Eraser: Remove Unwanted Objects</h2>
<p>One of the most impressive features is Magic Eraser. Simply tap unwanted objects in your photos, and AI removes them seamlessly. This feature alone justifies the Pixel's price for photography enthusiasts.</p>

<h2>Real Tone: Accurate Skin Tone Representation</h2>
<p>Google's Real Tone technology ensures that photos of people with darker skin tones are captured accurately. This is a game-changer for inclusive photography.</p>

<h2>Call Screen: AI-Powered Call Filtering</h2>
<p>Pixel 10's AI can screen calls and even transcribe spam messages in real-time. Many users report reducing unwanted calls by over 90%.</p>

<h2>Photography AI: Night Mode and Astrophotography</h2>
<p>As one Reddit user mentioned: "AI processing on Pixel is years ahead of the competition. Night mode is unreal."</p>
<p>The Pixel 10's computational photography algorithms produce stunning low-light photos without traditional sensors.</p>

<h2>Generative AI Integration</h2>
<p>The Pixel 10 can generate images, summarize documents, and assist with writing tasks using on-device AI.</p>

<h2>Privacy: AI That Respects Your Data</h2>
<p>All AI processing happens on-device, meaning your data never leaves your phone. This is a privacy advantage over cloud-based solutions.</p>

<h2>Conclusion</h2>
<p>The Google Pixel 10's AI features set a new standard for what a smartphone can do. Whether you're a photography enthusiast or someone who values privacy, the Pixel 10 has something special. Share your Pixel experience in the comments!</p>`,
    excerpt: "In-depth guide to Google Pixel 10's AI features including Magic Eraser, Night Mode, Call Screen, and on-device AI processing.",
    categories: [1],
    tags: ["Google Pixel", "AI", "camera", "features"],
    featured_media: 0,
    status: 'draft'
  },
  {
    title: "OnePlus 13 vs Samsung Galaxy S25: Speed and Value Comparison",
    content: `<h2>The OnePlus Philosophy: Speed and Simplicity</h2>
<p>OnePlus has built its reputation on fast, clean software and affordable flagship features. The OnePlus 13 continues this tradition with impressive performance at a lower price point than the Galaxy S25.</p>

<h2>Processing Power</h2>
<p>Both phones use the latest Snapdragon processor, so performance is nearly identical in real-world use. However, OnePlus's lighter software means slightly faster app launching and multitasking.</p>

<h2>Charging Speed: OnePlus Wins</h2>
<p>OnePlus 13: 100W fast charging (full charge in 15 minutes). Galaxy S25: 65W fast charging (30 minutes). One Reddit user confirmed: "OnePlus still has the fastest charging and cleaner software."</p>

<h2>Software Experience</h2>
<p>OnePlus runs a near-stock Android experience with minimal bloatware. Samsung, while improving, adds more pre-installed apps.</p>

<h2>Price and Value</h2>
<p>OnePlus 13: $599. Samsung Galaxy S25: $799. For the price difference, you get nearly identical performance with OnePlus.</p>

<h2>Camera Quality</h2>
<p>Samsung edges out OnePlus in computational photography, especially in low light. However, OnePlus cameras are still excellent.</p>

<h2>Build Quality</h2>
<p>Both phones feature premium materials. Samsung uses titanium; OnePlus uses a mix of glass and aluminum. Both feel premium.</p>

<h2>Battery Life</h2>
<p>OnePlus 13: 5500mAh. Galaxy S25: 4500mAh. OnePlus offers better battery longevity throughout the day.</p>

<h2>Conclusion</h2>
<p>If you prioritize speed and value, OnePlus 13 is the better choice. If you want the best camera and deeper Samsung ecosystem integration, go with the Galaxy S25. Share your thoughts in the comments!</p>`,
    excerpt: "Comprehensive comparison of OnePlus 13 and Samsung Galaxy S25 focusing on speed, charging, price, and overall value.",
    categories: [1],
    tags: ["OnePlus", "Samsung", "comparison", "value"],
    featured_media: 0,
    status: 'draft'
  },
  {
    title: "Best Android Phones Under $500: Complete Buyer's Guide",
    content: `<h2>Why Budget Android Phones Are Better Than Ever</h2>
<p>In 2026, budget Android phones offer features that were exclusive to flagship devices just a few years ago. You no longer need to spend $800+ to get a great phone.</p>

<h2>Best Overall Under $500: Pixel 7a</h2>
<p>The Google Pixel 7a offers flagship AI features, excellent camera, and clean Android at $449. The computational photography is still superior to phones costing twice as much.</p>

<h2>Best for Value: OnePlus Nord</h2>
<p>With a clean interface and 5G support, the OnePlus Nord at $399 is one of the best values on the market.</p>

<h2>Best for Battery: Motorola Edge 50</h2>
<p>The Motorola Edge 50 features a massive 5000mAh battery and fast 65W charging. If battery life is your priority, this is the phone to get.</p>

<h2>Best Camera Under $500: Samsung Galaxy A54</h2>
<p>With a 50MP main camera and excellent night mode, the Galaxy A54 punches above its $349 price point.</p>

<h2>Best for Gaming: Poco F6</h2>
<p>The Poco F6 features a high refresh rate display and powerful processor, making it ideal for mobile gaming without breaking the bank.</p>

<h2>Display Quality Comparison</h2>
<table>
<tr><th>Phone</th><th>Display Size</th><th>Refresh Rate</th><th>Price</th></tr>
<tr><td>Pixel 7a</td><td>6.1"</td><td>90Hz</td><td>$449</td></tr>
<tr><td>OnePlus Nord</td><td>6.4"</td><td>120Hz</td><td>$399</td></tr>
<tr><td>Galaxy A54</td><td>6.5"</td><td>120Hz</td><td>$349</td></tr>
</table>

<h2>Buying Tips</h2>
<p>Consider what matters most to you: camera quality, battery life, performance, or display. Buy from authorized retailers to ensure warranty coverage.</p>

<h2>Conclusion</h2>
<p>You don't need to spend $1000+ for a great smartphone. The phones on this list offer flagship features at reasonable prices. Share your budget phone recommendations in the comments!</p>`,
    excerpt: "Guide to the best Android phones under $500 including Pixel 7a, OnePlus Nord, Motorola Edge 50, and Samsung Galaxy A54.",
    categories: [1],
    tags: ["budget phones", "Android", "under $500", "buyer's guide"],
    featured_media: 0,
    status: 'draft'
  }
];

// ═══════════════════════════════════════════════════════════════
// POST ARTICLES TO WORDPRESS
// ═══════════════════════════════════════════════════════════════

async function postArticleToWordPress(article, index) {
  try {
    console.log(`\n[${index + 1}/5] Posting: "${article.title}"`);

    const response = await wpAPI.post('/posts', {
      title: article.title,
      content: article.content,
      excerpt: article.excerpt,
      categories: article.categories,
      status: article.status,
      featured_media: article.featured_media
      // Note: tags parameter removed - can be added once tag IDs are available
    });

    console.log(`✅ Posted successfully!`);
    console.log(`   Post ID: ${response.data.id}`);
    console.log(`   URL: ${response.data.link}`);

    return {
      success: true,
      id: response.data.id,
      title: article.title,
      url: response.data.link
    };
  } catch (error) {
    console.error(`❌ Failed to post: ${error.message}`);
    if (error.response?.data?.message) {
      console.error(`   Error: ${error.response.data.message}`);
    }
    return {
      success: false,
      title: article.title,
      error: error.message
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN TEST WORKFLOW
// ═══════════════════════════════════════════════════════════════

async function runTest() {
  console.log(`
╔════════════════════════════════════════════════════════╗
║        TEST FULL WORKFLOW: Generate & Post 5 Blogs     ║
╚════════════════════════════════════════════════════════╝
`);

  console.log(`🔗 WordPress URL: ${WORDPRESS_URL}`);
  console.log(`👤 Username: ${WP_USERNAME}`);
  console.log(`📝 Articles to post: ${SAMPLE_ARTICLES.length}`);

  // Test WordPress connection
  console.log(`\n🔌 Testing WordPress connection...`);
  try {
    const response = await wpAPI.get('/posts', { params: { per_page: 1 } });
    console.log(`✅ Connection successful!`);
    console.log(`   WordPress version: ${response.headers['x-wp-version'] || 'Unknown'}`);
  } catch (error) {
    console.error(`❌ Connection failed: ${error.message}`);
    console.error(`\n⚠️  Cannot connect to WordPress. Check:`);
    console.error(`   1. WordPress site is accessible`);
    console.error(`   2. REST API is enabled`);
    console.error(`   3. Credentials in .env are correct`);
    console.error(`   4. User has permission to create posts`);
    process.exit(1);
  }

  // Post articles
  console.log(`\n📝 Posting articles to WordPress...`);
  const results = [];

  for (let i = 0; i < SAMPLE_ARTICLES.length; i++) {
    const result = await postArticleToWordPress(SAMPLE_ARTICLES[i], i);
    results.push(result);

    // Small delay between posts
    if (i < SAMPLE_ARTICLES.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log(`\n════════════════════════════════════════════════════════`);
  console.log(`TEST RESULTS`);
  console.log(`════════════════════════════════════════════════════════`);

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n✅ Successfully posted: ${successful}/${SAMPLE_ARTICLES.length}`);
  console.log(`❌ Failed: ${failed}/${SAMPLE_ARTICLES.length}`);

  if (successful > 0) {
    console.log(`\n📚 Posted Articles:`);
    results.filter(r => r.success).forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.title}`);
      console.log(`   Post ID: ${r.id}`);
      console.log(`   URL: ${r.url}`);
    });
  }

  if (failed > 0) {
    console.log(`\n⚠️  Failed Articles:`);
    results.filter(r => !r.success).forEach((r, i) => {
      console.log(`${i + 1}. ${r.title}`);
      console.log(`   Error: ${r.error}`);
    });
  }

  console.log(`\n════════════════════════════════════════════════════════`);

  if (successful > 0) {
    console.log(`\n✨ Check your WordPress dashboard to view the posted articles!`);
    console.log(`📊 Visit: ${WORDPRESS_URL}/wp-admin/edit.php`);
  }

  // Save results
  const report = {
    timestamp: new Date().toISOString(),
    wordpress_url: WORDPRESS_URL,
    total_articles: SAMPLE_ARTICLES.length,
    successful: successful,
    failed: failed,
    results: results
  };

  fs.writeFileSync(
    path.join(__dirname, '..', 'test_results.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`\n📄 Results saved to: test_results.json`);

  process.exit(successful === SAMPLE_ARTICLES.length ? 0 : 1);
}

// Run the test
runTest();
