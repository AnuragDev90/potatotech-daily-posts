const fs = require('fs');
const { runTests } = require('./test-groq-models');

// ═══════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║     🧪 WORDPRESS BLOG AUTOMATION TEST RUNNER          ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  console.log('📋 This test runner will:');
  console.log('   1. Test 3 OpenAI models (gpt-3.5-turbo, gpt-4o, gpt-4-turbo)');
  console.log('   2. Generate 5 sample articles');
  console.log('   3. Validate quality against 9-point checklist');
  console.log('   4. Compare model performance');
  console.log('   5. Save results to test_results.json\n');

  console.log('⏱️  Estimated time: 15-20 minutes\n');

  console.log('Starting tests...\n');

  try {
    // Run tests
    const results = await runTests();

    // Print detailed summary
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║              ✅ TESTS COMPLETE                        ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log('📊 RESULTS SUMMARY\n');

    console.log(`Total Articles Tested:  ${results.total_articles}`);
    console.log(`✅ Passed:              ${results.passed}`);
    console.log(`❌ Failed:              ${results.failed}`);

    const passRate = ((results.passed / results.total_articles) * 100).toFixed(1);
    console.log(`Success Rate:           ${passRate}%\n`);

    // Model breakdown
    console.log('📈 MODEL COMPARISON\n');

    for (const [model, stats] of Object.entries(results.model_comparison)) {
      const modelName = model;

      console.log(`${modelName.padEnd(15)} | Articles: ${stats.articles.toString().padStart(2)} | ` +
                  `Avg time: ${stats.avg_time.toString().padStart(4)} min | ` +
                  `Avg words: ${stats.avg_words.toString().padStart(4)} | ` +
                  `Success: ${stats.success_rate}`);
    }

    console.log(`\n🎯 RECOMMENDATION\n`);
    console.log(results.recommendation);

    // Detailed results
    if (results.articles.length > 0) {
      console.log(`\n📄 DETAILED RESULTS\n`);

      results.articles.forEach((article, index) => {
        const status = article.overall_result === 'PASS' ? '✅' : '❌';
        console.log(`${status} [${index + 1}/${results.articles.length}] ${article.keyword.substring(0, 40)}`);
        console.log(`   Model: ${article.model_friendly.padEnd(10)} | Words: ${article.word_count.toString().padStart(4)} | ` +
                   `Time: ${article.generation_time.padEnd(12)} | Status: ${article.overall_result}`);
      });
    }

    console.log(`\n📁 Full results saved to: test_results.json\n`);

    // Recommendations for next steps
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║                  📋 NEXT STEPS                        ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    if (results.passed === results.total_articles) {
      console.log('✅ All tests passed! Your system is ready.\n');
      console.log('To run full automation:\n');
      console.log('   1. Generate story prompts:');
      console.log('      npm run prompts\n');
      console.log('   2. Run complete pipeline:');
      console.log('      npm run orchestrate:openai\n');
      console.log('   3. Schedule daily runs:');
      console.log('      npm run cron\n');
    } else {
      console.log('⚠️  Some tests failed. Review test_results.json for details.\n');
      console.log('Common issues:\n');
      console.log('   • Word count too low → Increase openaiMaxTokens');
      console.log('   • Image fails → Check internet/Pollinations API');
      console.log('   • Quality issues → Adjust temperature settings\n');
      console.log('After fixing issues, run tests again:\n');
      console.log('   node src/run-tests.js\n');
    }

    console.log('Documentation:\n');
    console.log('   • GROQ_MODEL_TESTING_GUIDE.md     → Full testing guide');
    console.log('   • ORCHESTRATOR_GROQ_GUIDE.md      → Pipeline automation');
    console.log('   • GROQ_POLLINATIONS_GUIDE.md      → API documentation\n');

    // Exit with appropriate code
    process.exit(results.passed === results.total_articles ? 0 : 1);

  } catch (error) {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║              ❌ TEST FAILED                            ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.error('Error:', error.message);
    console.log('\nTroubleshooting:\n');
    console.log('   1. Check .env has OPENAI_API_KEY');
    console.log('   2. Verify internet connection');
    console.log('   3. Check OpenAI API status');
    console.log('   4. Review error message above\n');

    process.exit(1);
  }
}

// Run
main();
