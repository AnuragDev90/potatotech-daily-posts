const crypto = require('crypto');
const fs = require('fs');

// ═══════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════

// Generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

// Generate excerpt from content
function generateExcerpt(content, length = 150) {
  const text = content.replace(/<[^>]*>/g, ''); // Remove HTML tags
  return text.substring(0, length).replace(/[.!?]+$/, '') + '...';
}

// Calculate similarity score between two texts (simple algorithm)
function calculateSimilarity(text1, text2) {
  const normalize = (text) => {
    return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  };

  const words1 = normalize(text1);
  const words2 = normalize(text2);

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  const similarity = (intersection.size / union.size) * 100;
  return Math.round(similarity);
}

// Extract core facts from text (for angle selection)
function extractCoreFacts(text) {
  const facts = {
    hasNumbers: /\d+/.test(text),
    hasNames: /[A-Z][a-z]+/g.test(text),
    sentiment: detectSentiment(text),
    topics: extractTopics(text),
  };
  return facts;
}

// Detect sentiment (simple)
function detectSentiment(text) {
  const positive = ['good', 'great', 'amazing', 'excellent', 'awesome', 'better', 'improved'];
  const negative = ['bad', 'poor', 'terrible', 'worse', 'problem', 'issue', 'failed'];

  const textLower = text.toLowerCase();
  const posCount = positive.filter(word => textLower.includes(word)).length;
  const negCount = negative.filter(word => textLower.includes(word)).length;

  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

// Extract topics from text (simple keyword extraction)
function extractTopics(text) {
  const keywords = ['AI', 'iPhone', 'Android', 'startup', 'tech', 'gadget', 'app', 'software', 'hardware', 'cloud'];
  const found = keywords.filter(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
  return [...new Set(found)];
}

// Select unique angles based on content and target keywords
function selectUniqueAngle(content, targetKeywords = []) {
  const angles = [
    {
      name: 'Indian Focus',
      template: '[TOPIC] in India: What You Need to Know',
      description: 'How this impacts Indian users, pricing in INR, local availability',
    },
    {
      name: 'Comparison',
      template: '[TOPIC] vs Alternatives: Complete Buyer\'s Guide',
      description: 'Detailed comparison with competitors, pros/cons, value proposition',
    },
    {
      name: 'Tutorial',
      template: 'How to [USE TOPIC]: Step-by-Step Guide',
      description: 'Hands-on tutorial, implementation guide, code examples',
    },
    {
      name: 'Budget',
      template: '[TOPIC] for Budget-Conscious Developers',
      description: 'Cost analysis, affordable alternatives, ROI calculation',
    },
    {
      name: 'Review',
      template: '[TOPIC] Honest Review: Is It Worth Your Money?',
      description: 'Personal testing, pros/cons, real-world verdict',
    },
    {
      name: 'Future Impact',
      template: '[TOPIC]: What This Means for the Future',
      description: 'Implications, trends, predictions, industry impact',
    },
  ];

  // Random selection from angles
  const selectedAngle = angles[Math.floor(Math.random() * angles.length)];
  return selectedAngle;
}

// Format content as HTML with proper structure
function formatAsHTML(content, title, angle) {
  const sections = content.split('\n\n').filter(s => s.trim());

  let html = `<h2>${title}</h2>\n`;
  html += `<p><em>Focus: ${angle}</em></p>\n`;

  sections.forEach((section, index) => {
    // Auto-detect headers vs paragraphs
    if (section.length < 100 && !section.includes('.')) {
      html += `<h3>${section}</h3>\n`;
    } else {
      html += `<p>${section}</p>\n`;
    }

    // Add break after every 3 paragraphs for readability
    if ((index + 1) % 3 === 0) {
      html += `<hr style="margin: 30px 0;" />\n`;
    }
  });

  return html;
}

// Create featured image markup for WordPress
function createFeaturedImageMarkup(imageUrl) {
  return `<figure style="text-align: center; margin: 20px 0;">
    <img src="${imageUrl}" alt="Featured Image" style="max-width: 100%; height: auto;" />
  </figure>`;
}

// Log function
function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${type}] ${message}`;

  console.log(logMessage);

  // Also log to file
  fs.appendFileSync(process.env.LOG_FILE || 'automation.log', logMessage + '\n', {
    flag: 'a',
  });
}

// Generate unique ID
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// Save JSON file
function saveJSON(filename, data) {
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  log(`Saved: ${filename}`, 'FILE');
}

// Load JSON file
function loadJSON(filename) {
  try {
    const data = fs.readFileSync(filename, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    log(`Error loading ${filename}: ${error.message}`, 'ERROR');
    return null;
  }
}

// Validate WordPress configuration
function validateWordPressConfig(config) {
  const required = ['WORDPRESS_SITE', 'WORDPRESS_USERNAME', 'WORDPRESS_PASSWORD'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing WordPress config: ${missing.join(', ')}`);
  }

  return true;
}

// Validate Groq configuration
function validateGroqConfig(config) {
  if (!config.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY in .env file');
  }
  return true;
}

// Delay function (rate limiting)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Format bytes to readable size
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// ═══════════════════════════════════════════════════════
// Export all functions
// ═══════════════════════════════════════════════════════

module.exports = {
  generateSlug,
  generateExcerpt,
  calculateSimilarity,
  extractCoreFacts,
  detectSentiment,
  extractTopics,
  selectUniqueAngle,
  formatAsHTML,
  createFeaturedImageMarkup,
  log,
  generateId,
  saveJSON,
  loadJSON,
  validateWordPressConfig,
  validateGroqConfig,
  delay,
  formatBytes,
};
