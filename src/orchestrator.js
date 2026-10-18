const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  logFile: path.join(__dirname, '..', 'orchestration.log'),
  reportFile: path.join(__dirname, '..', 'orchestration_report.json'),
  maxStaggerDelay: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  emailEnabled: process.env.EMAIL_ENABLED === 'true',
  emailConfig: {
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  },
  emailRecipient: process.env.EMAIL_RECIPIENT || process.env.EMAIL_USER,
  wordPressUrl: process.env.WORDPRESS_SITE,
  wordPressUser: process.env.WORDPRESS_USERNAME,
  wordPressPass: process.env.WORDPRESS_PASSWORD
};

// ═══════════════════════════════════════════════════════════════
// LOGGING UTILITIES
// ═══════════════════════════════════════════════════════════════

class Logger {
  constructor(logFile) {
    this.logFile = logFile;
    this.logs = [];
    this.errors = [];
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}`;

    console.log(logEntry);
    this.logs.push(logEntry);

    // Write to file immediately
    fs.appendFileSync(this.logFile, logEntry + '\n');
  }

  info(message) {
    this.log(message, 'INFO');
  }

  warn(message) {
    this.log(message, 'WARN');
  }

  error(message) {
    this.log(message, 'ERROR');
    this.errors.push(message);
  }

  success(message) {
    this.log(message, 'SUCCESS');
  }

  getLogs() {
    return this.logs.join('\n');
  }

  getErrors() {
    return this.errors;
  }
}

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR CLASS
// ═══════════════════════════════════════════════════════════════

class Orchestrator {
  constructor() {
    this.logger = new Logger(CONFIG.logFile);
    this.results = {
      startTime: new Date(),
      steps: [],
      summary: {
        totalSteps: 0,
        completedSteps: 0,
        failedSteps: 0,
        topicsProcessed: 0,
        articlesGenerated: 0,
        articlesPublished: 0,
        totalWords: 0,
        errors: []
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PIPELINE STEPS
  // ═══════════════════════════════════════════════════════════════

  async runStep(stepNumber, stepName, moduleFunction) {
    const stepStartTime = new Date();

    this.logger.info(`\n${'='.repeat(60)}`);
    this.logger.info(`STEP ${stepNumber}: ${stepName}`);
    this.logger.info(`${'='.repeat(60)}`);

    try {
      // Run the step
      const result = await moduleFunction();

      const duration = new Date() - stepStartTime;
      this.logger.success(`✓ ${stepName} completed in ${(duration / 1000).toFixed(1)}s`);

      this.results.steps.push({
        step: stepNumber,
        name: stepName,
        status: 'SUCCESS',
        startTime: stepStartTime,
        duration: duration,
        result: result
      });

      this.results.summary.completedSteps++;

      return result;
    } catch (error) {
      this.logger.error(`✗ ${stepName} failed: ${error.message}`);
      this.results.summary.failedSteps++;

      this.results.steps.push({
        step: stepNumber,
        name: stepName,
        status: 'FAILED',
        startTime: stepStartTime,
        error: error.message
      });

      return null;
    }
  }

  async executeOrchestration() {
    try {
      this.logger.info('\n╔════════════════════════════════════════════════════════╗');
      this.logger.info('║      DAILY CONTENT AUTOMATION ORCHESTRATOR              ║');
      this.logger.info('╚════════════════════════════════════════════════════════╝\n');

      const startTime = new Date();
      this.logger.info(`Started at: ${startTime.toISOString()}`);
      this.logger.info(`Configuration: WordPress (${CONFIG.wordPressUrl})`);

      // ──────────────────────────────────────────────────────────────
      // STEP 1: Fetch Google Trends
      // ──────────────────────────────────────────────────────────────

      await this.runStep(1, 'Fetch Google Trends', async () => {
        const trendModule = require('./fetch-google-trends.js');
        const trends = await trendModule.main();
        this.results.summary.topicsProcessed += (trends || []).length;
        return { topicsFound: (trends || []).length };
      });

      // ──────────────────────────────────────────────────────────────
      // STEP 2: Fetch Reddit Data
      // ──────────────────────────────────────────────────────────────

      await this.runStep(2, 'Fetch Reddit Data', async () => {
        const redditModule = require('./fetch-reddit.js');
        const reddit = await redditModule.main();
        return { postsFound: (reddit || []).length };
      });

      // ──────────────────────────────────────────────────────────────
      // STEP 3: Rank Topics with Multiple Sources
      // ──────────────────────────────────────────────────────────────

      await this.runStep(3, 'Rank Topics with Multiple Sources', async () => {
        const rankModule = require('./rank-with-multiple-sources.js');
        const ranked = await rankModule.main();
        return { topicsRanked: (ranked || []).length };
      });

      // ──────────────────────────────────────────────────────────────
      // STEP 4: Generate Story Prompts
      // ──────────────────────────────────────────────────────────────

      await this.runStep(4, 'Generate Story Prompts', async () => {
        const promptModule = require('./generate-story-prompts.js');
        const prompts = await promptModule.main();
        return { promptsGenerated: (prompts || []).length };
      });

      // ──────────────────────────────────────────────────────────────
      // STEP 5: Generate Articles with Ollama
      // ──────────────────────────────────────────────────────────────

      await this.runStep(5, 'Generate Content with Ollama', async () => {
        const genModule = require('./generate-posts-free.js');
        const articles = await genModule.main();

        if (articles) {
          this.results.summary.articlesGenerated = articles.length;
          this.results.summary.totalWords = articles.reduce((sum, a) => sum + a.word_count, 0);
        }

        return { articlesGenerated: articles ? articles.length : 0 };
      });

      // ──────────────────────────────────────────────────────────────
      // STEP 6: SEO Optimization
      // ──────────────────────────────────────────────────────────────

      await this.runStep(6, 'SEO Optimization', async () => {
        const seoModule = require('./seo-optimizer.js');
        const optimized = await seoModule.main();
        return { articlesOptimized: optimized ? optimized.length : 0 };
      });

      // ──────────────────────────────────────────────────────────────
      // STEP 7: Publish to WordPress (Staggered)
      // ──────────────────────────────────────────────────────────────

      await this.runStep(7, 'Publish to WordPress', async () => {
        const postModule = require('./post-to-wordpress.js');
        const published = await postModule.main();

        if (published) {
          this.results.summary.articlesPublished = published.length;
        }

        return { articlesPublished: published ? published.length : 0 };
      });

      // ──────────────────────────────────────────────────────────────
      // STEP 8: Update SEO Metadata in WordPress
      // ──────────────────────────────────────────────────────────────

      await this.runStep(8, 'Update WordPress SEO Metadata', async () => {
        const seoUpdateModule = require('./seo-wordpress-updater.js');
        const updated = await seoUpdateModule.main();
        return { postsUpdated: updated ? updated.length : 0 };
      });

      // ──────────────────────────────────────────────────────────────
      // ORCHESTRATION COMPLETE
      // ──────────────────────────────────────────────────────────────

      const endTime = new Date();
      const totalDuration = endTime - startTime;

      this.results.endTime = endTime;
      this.results.totalDuration = totalDuration;
      this.results.summary.totalSteps = this.results.steps.length;
      this.results.summary.errors = this.logger.getErrors();

      this.logger.info(`\n${'='.repeat(60)}`);
      this.logger.info('ORCHESTRATION COMPLETE');
      this.logger.info(`${'='.repeat(60)}`);
      this.logger.success(`Total duration: ${(totalDuration / 1000 / 60).toFixed(1)} minutes`);
      this.logger.info(`Completed steps: ${this.results.summary.completedSteps}/${this.results.summary.totalSteps}`);

      if (this.results.summary.failedSteps > 0) {
        this.logger.warn(`Failed steps: ${this.results.summary.failedSteps}`);
      }

      this.logger.info(`Articles generated: ${this.results.summary.articlesGenerated}`);
      this.logger.info(`Articles published: ${this.results.summary.articlesPublished}`);
      this.logger.info(`Total words generated: ${this.results.summary.totalWords.toLocaleString()}`);

      // Save report
      this.saveReport();

      // Send email
      if (CONFIG.emailEnabled) {
        await this.sendEmailReport();
      }

      return this.results;

    } catch (error) {
      this.logger.error(`Fatal error in orchestration: ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // REPORTING
  // ═══════════════════════════════════════════════════════════════

  saveReport() {
    try {
      const report = {
        timestamp: new Date().toISOString(),
        duration: this.results.totalDuration,
        summary: this.results.summary,
        steps: this.results.steps.map(step => ({
          step: step.step,
          name: step.name,
          status: step.status,
          duration: step.duration,
          error: step.error || null
        })),
        logs: this.logger.getLogs()
      };

      fs.writeFileSync(CONFIG.reportFile, JSON.stringify(report, null, 2));
      this.logger.success(`✓ Report saved to ${path.basename(CONFIG.reportFile)}`);
    } catch (error) {
      this.logger.error(`Failed to save report: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EMAIL NOTIFICATION
  // ═══════════════════════════════════════════════════════════════

  async sendEmailReport() {
    try {
      this.logger.info('Sending email report...');

      // Create transporter
      const transporter = nodemailer.createTransport(CONFIG.emailConfig);

      // Build email content
      const emailContent = this.generateEmailContent();

      // Send email
      const info = await transporter.sendMail({
        from: CONFIG.emailConfig.auth.user,
        to: CONFIG.emailRecipient,
        subject: `[${new Date().toLocaleDateString()}] Content Automation Report`,
        html: emailContent,
        text: this.generateEmailText()
      });

      this.logger.success(`✓ Email sent successfully (ID: ${info.messageId})`);
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
    }
  }

  generateEmailContent() {
    const summary = this.results.summary;
    const status = summary.failedSteps === 0 ? '✓ SUCCESS' : '⚠ PARTIAL SUCCESS';
    const duration = (this.results.totalDuration / 1000 / 60).toFixed(1);

    return `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .header { background: #007bff; color: white; padding: 20px; border-radius: 5px; }
          .summary { background: #f8f9fa; padding: 15px; margin: 20px 0; border-left: 4px solid #007bff; }
          .success { color: #28a745; }
          .warning { color: #ff9800; }
          .error { color: #dc3545; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f8f9fa; font-weight: bold; }
          .metric { font-size: 18px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>📊 Content Automation Report</h2>
          <p>Date: ${new Date().toLocaleDateString()}</p>
        </div>

        <div class="summary">
          <h3>Status: <span class="${summary.failedSteps === 0 ? 'success' : 'warning'}">${status}</span></h3>
          <p>Duration: <strong>${duration} minutes</strong></p>
        </div>

        <h3>📈 Key Metrics</h3>
        <table>
          <tr>
            <th>Metric</th>
            <th>Value</th>
          </tr>
          <tr>
            <td>Steps Completed</td>
            <td><span class="metric">${summary.completedSteps}/${summary.totalSteps}</span></td>
          </tr>
          <tr>
            <td>Topics Processed</td>
            <td><span class="metric">${summary.topicsProcessed}</span></td>
          </tr>
          <tr>
            <td>Articles Generated</td>
            <td><span class="metric">${summary.articlesGenerated}</span></td>
          </tr>
          <tr>
            <td>Articles Published</td>
            <td><span class="metric">${summary.articlesPublished}</span></td>
          </tr>
          <tr>
            <td>Total Words Generated</td>
            <td><span class="metric">${summary.totalWords.toLocaleString()}</span></td>
          </tr>
          ${summary.failedSteps > 0 ? `
          <tr>
            <td class="error">Failed Steps</td>
            <td class="error"><strong>${summary.failedSteps}</strong></td>
          </tr>
          ` : ''}
        </table>

        <h3>📋 Step Details</h3>
        <table>
          <tr>
            <th>Step</th>
            <th>Status</th>
            <th>Duration</th>
          </tr>
          ${this.results.steps.map(step => `
          <tr>
            <td>${step.step}. ${step.name}</td>
            <td><span class="${step.status === 'SUCCESS' ? 'success' : 'error'}">${step.status}</span></td>
            <td>${step.duration ? (step.duration / 1000).toFixed(1) + 's' : '-'}</td>
          </tr>
          `).join('')}
        </table>

        ${summary.errors.length > 0 ? `
        <h3>⚠️ Errors</h3>
        <div style="background: #ffe0e0; padding: 15px; border-left: 4px solid #dc3545;">
          ${summary.errors.map(err => `<p>• ${err}</p>`).join('')}
        </div>
        ` : ''}

        <hr style="margin: 30px 0;">
        <p><small>Full orchestration report saved to: orchestration_report.json</small></p>
      </body>
    </html>
    `;
  }

  generateEmailText() {
    const summary = this.results.summary;
    const duration = (this.results.totalDuration / 1000 / 60).toFixed(1);

    return `
CONTENT AUTOMATION REPORT
========================

Status: ${summary.failedSteps === 0 ? '✓ SUCCESS' : '⚠ PARTIAL SUCCESS'}
Date: ${new Date().toLocaleDateString()}
Duration: ${duration} minutes

KEY METRICS
-----------
Steps Completed: ${summary.completedSteps}/${summary.totalSteps}
Topics Processed: ${summary.topicsProcessed}
Articles Generated: ${summary.articlesGenerated}
Articles Published: ${summary.articlesPublished}
Total Words: ${summary.totalWords.toLocaleString()}

${summary.errors.length > 0 ? `
ERRORS
------
${summary.errors.map(e => '• ' + e).join('\n')}
` : ''}

View full report: orchestration_report.json
    `;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════

async function main() {
  const orchestrator = new Orchestrator();

  try {
    const results = await orchestrator.executeOrchestration();
    process.exit(results.summary.failedSteps === 0 ? 0 : 1);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { Orchestrator };
