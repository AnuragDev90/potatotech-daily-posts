const axios = require("axios");
const fs = require("fs");
const { log, saveJSON, loadJSON } = require("./utils");
require("dotenv").config();

const WORDPRESS_URL = process.env.WORDPRESS_SITE;
const WORDPRESS_USER = process.env.WORDPRESS_USERNAME;
const WORDPRESS_PASS = process.env.WORDPRESS_PASSWORD;

// Keyword research data for each category
const KEYWORD_MAP = {
  1: { // iPhone News
    primary: "iPhone 16 Pro specifications",
    secondary: ["iPhone 16 price India", "iPhone 16 features", "iPhone 16 vs previous models"],
    difficulty: "High",
    volume: "50K+"
  },
  2: { // Android News
    primary: "Best Android phones 2026",
    secondary: ["Android 16 features", "Android phone reviews", "Android vs iOS"],
    difficulty: "Very High",
    volume: "100K+"
  },
  3: { // Samsung Galaxy
    primary: "Samsung Galaxy S25 specifications",
    secondary: ["Galaxy S25 review", "Galaxy S25 price India", "Galaxy S25 features"],
    difficulty: "Medium",
    volume: "40K+"
  },
  4: { // Google Pixel
    primary: "Google Pixel 10 specifications",
    secondary: ["Pixel 10 camera review", "Pixel 10 price", "Pixel vs iPhone camera"],
    difficulty: "Medium",
    volume: "30K+"
  },
  5: { // OnePlus & Budget
    primary: "Best budget phones under ₹30,000",
    secondary: ["OnePlus 13 review", "Budget phone comparison", "Best value phones 2026"],
    difficulty: "Low",
    volume: "20K+"
  },
  6: { // India Market
    primary: "Best smartphones in India 2026",
    secondary: ["Mobile prices in India", "Smartphone deals India", "Indian market phones"],
    difficulty: "Low",
    volume: "15K+"
  },
  7: { // Specs & Comparisons
    primary: "iPhone vs Samsung vs Pixel comparison",
    secondary: ["Phone specifications guide", "Smartphone comparison 2026"],
    difficulty: "Medium",
    volume: "25K+"
  },
  8: { // Mobile Photography
    primary: "Best smartphone cameras 2026",
    secondary: ["iPhone vs Pixel camera", "Smartphone photography tips", "Mobile camera comparison"],
    difficulty: "High",
    volume: "35K+"
  }
};

// Optimize post metadata for SEO
function optimizeMetadata(post, categoryId) {
  const keywords = KEYWORD_MAP[categoryId] || KEYWORD_MAP[7];
  
  // Generate SEO-friendly title (50-60 chars)
  const seoTitle = post.title.length > 60 
    ? post.title.substring(0, 57) + "..."
    : post.title;

  // Generate meta description (150-160 chars) with keyword
  const metaDescription = `${post.excerpt.substring(0, 120)}... Learn more about ${keywords.primary.toLowerCase()}.`.substring(0, 160);

  // Generate SEO-friendly slug
  const slug = seoTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return {
    title: seoTitle,
    meta_description: metaDescription,
    slug: slug,
    primary_keyword: keywords.primary,
    secondary_keywords: keywords.secondary
  };
}

// Generate JSON-LD Schema Markup
function generateSchemaMarkup(post, categoryId) {
  const baseUrl = WORDPRESS_URL.replace(/\/$/, "");
  
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": post.title,
    "description": post.excerpt,
    "image": post.featured_image_url || `${baseUrl}/wp-content/uploads/default.jpg`,
    "author": {
      "@type": "Organization",
      "name": "Potato Tech",
      "logo": {
        "@type": "ImageObject",
        "url": `${baseUrl}/logo.png`,
        "width": 600,
        "height": 60
      }
    },
    "publisher": {
      "@type": "Organization",
      "name": "The Pod Editors",
      "logo": {
        "@type": "ImageObject",
        "url": `${baseUrl}/logo.png`,
        "width": 600,
        "height": 60
      }
    },
    "datePublished": new Date().toISOString(),
    "dateModified": new Date().toISOString(),
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `${baseUrl}/posts/`
    }
  };

  // Add Product schema for phone reviews
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": post.title,
    "description": post.excerpt,
    "image": post.featured_image_url,
    "review": {
      "@type": "Review",
      "reviewRating": {
        "@type": "Rating",
        "ratingValue": 4.5,
        "bestRating": 5
      },
      "author": {
        "@type": "Person",
        "name": "Potato Tech"
      }
    }
  };

  // Add BreadcrumbList schema
  const categoryNames = {
    1: "iPhone News", 2: "Android News", 3: "Samsung Galaxy",
    4: "Google Pixel", 5: "OnePlus & Budget", 6: "India Market",
    7: "Specs & Comparisons", 8: "Mobile Photography"
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": baseUrl
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": categoryNames[categoryId] || "Posts",
        "item": `${baseUrl}/category/${categoryNames[categoryId]?.toLowerCase().replace(/ /g, "-")}`
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": post.title,
        "item": `${baseUrl}/post/${post.slug || "post"}`
      }
    ]
  };

  return {
    article: articleSchema,
    product: productSchema,
    breadcrumb: breadcrumbSchema
  };
}

// Generate internal links suggestions
function suggestInternalLinks(allPosts, currentPost, categoryId) {
  const suggestions = [];

  // Find posts in same category (highest priority)
  const sameCategory = allPosts.filter(
    p => p.categories && p.categories.includes(categoryId) && p.slug !== currentPost.slug
  );

  // Find posts with related keywords
  const keywords = KEYWORD_MAP[categoryId]?.secondary || [];
  const relatedKeywords = allPosts.filter(p => {
    const content = (p.title + p.excerpt).toLowerCase();
    return keywords.some(k => content.includes(k.toLowerCase())) && p.slug !== currentPost.slug;
  });

  // Combine and limit to 5
  const combined = [...sameCategory, ...relatedKeywords];
  const unique = Array.from(new Map(combined.map(p => [p.slug, p])).values());

  for (let i = 0; i < Math.min(5, unique.length); i++) {
    suggestions.push({
      target_post: unique[i].title,
      anchor_text: unique[i].title.substring(0, 50),
      url: `/posts/${unique[i].slug}`
    });
  }

  return suggestions;
}

// Optimize images for SEO
function optimizeImageMetadata(post, categoryId) {
  if (!post.featured_image_url) return null;

  const categoryNames = {
    1: "iPhone", 2: "Android", 3: "Samsung Galaxy",
    4: "Google Pixel", 5: "OnePlus Budget", 6: "India Smartphone",
    7: "Phone Comparison", 8: "Smartphone Camera"
  };

  const altText = `${categoryNames[categoryId]} - ${post.title.substring(0, 40)} - Smartphone review and specifications`;

  return {
    url: post.featured_image_url,
    alt_text: altText,
    title: post.title.substring(0, 50),
    filename: post.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .substring(0, 50) + ".jpg",
    targetSize: "100KB",
    targetDimensions: "1200x630px"
  };
}

// Main SEO optimization function
async function optimizeAllPosts() {
  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("🔍 SEO Optimizer - Optimizing Posts for Google Ranking");
    console.log("═══════════════════════════════════════════════════════\n");

    // Load generated posts
    const posts = loadJSON("generated_posts.json");
    
    if (!posts || posts.length === 0) {
      console.error("❌ No posts found. Run: npm run generate");
      process.exit(1);
    }

    console.log(`📝 Processing ${posts.length} posts for SEO optimization...\n`);

    const seoOptimizedPosts = posts.map((post, index) => {
      const categoryId = post.categories?.[0] || 7;
      
      // Optimize metadata
      const metadata = optimizeMetadata(post, categoryId);
      
      // Generate schema markup
      const schema = generateSchemaMarkup(post, categoryId);
      
      // Suggest internal links
      const internalLinks = suggestInternalLinks(posts, post, categoryId);
      
      // Optimize image
      const imageOpt = optimizeImageMetadata(post, categoryId);

      const optimized = {
        ...post,
        seo: {
          title: metadata.title,
          meta_description: metadata.meta_description,
          slug: metadata.slug,
          primary_keyword: metadata.primary_keyword,
          secondary_keywords: metadata.secondary_keywords,
          schema_markup: schema,
          internal_links: internalLinks,
          image_optimization: imageOpt,
          keyword_difficulty: KEYWORD_MAP[categoryId]?.difficulty,
          search_volume: KEYWORD_MAP[categoryId]?.volume
        }
      };

      if ((index + 1) % 5 === 0) {
        console.log(`  ✅ Optimized ${index + 1}/${posts.length} posts`);
      }

      return optimized;
    });

    // Save optimized posts
    saveJSON("seo-optimized-posts.json", seoOptimizedPosts);

    // Generate SEO Report
    console.log("\n📊 SEO Optimization Report:");
    console.log(`   Total Posts: ${seoOptimizedPosts.length}`);
    console.log(`   Schema Markup Added: ${seoOptimizedPosts.filter(p => p.seo.schema_markup).length}`);
    console.log(`   Internal Links Suggested: ${seoOptimizedPosts.reduce((sum, p) => sum + p.seo.internal_links.length, 0)}`);
    console.log(`   Images Optimized: ${seoOptimizedPosts.filter(p => p.seo.image_optimization).length}`);

    // Breakdown by category
    console.log("\n📂 Optimization by Category:");
    const byCategory = {};
    seoOptimizedPosts.forEach(p => {
      const catId = p.categories?.[0] || 7;
      byCategory[catId] = (byCategory[catId] || 0) + 1;
    });

    const categoryNames = {
      1: "iPhone News", 2: "Android News", 3: "Samsung Galaxy",
      4: "Google Pixel", 5: "OnePlus & Budget", 6: "India Market",
      7: "Specs & Comparisons", 8: "Mobile Photography"
    };

    Object.entries(byCategory).forEach(([catId, count]) => {
      const difficulty = KEYWORD_MAP[catId]?.difficulty || "Unknown";
      console.log(`   ${categoryNames[catId]}: ${count} posts (${difficulty})`);
    });

    console.log("\n💾 Saved to: seo-optimized-posts.json");
    console.log("✨ Next: Update WordPress posts with optimized metadata\n");
    console.log("═══════════════════════════════════════════════════════\n");

    log(`SEO optimized ${seoOptimizedPosts.length} posts`, "SUCCESS");

  } catch (error) {
    log(`SEO Optimization error: ${error.message}`, "ERROR");
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

optimizeAllPosts();
