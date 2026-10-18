const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  logsDir: path.join(__dirname, '..', 'logs'),
  scheduleTime: '0 8 * * *', // 8 AM every day
  orchestratorScript: path.join(__dirname, 'orchestrator.js'),
  maxLogFiles: 30, // Keep last 30 days of logs
  logFilePrefix: 'cron'
};

// ═══════════════════════════════════════════════════════════════
// LOGGING SETUP
// ═══════════════════════════════════════════════════════════════

class CronLogger {
  constructor(logsDir) {
    this.logsDir = logsDir;
    this.ensureLogsDir();
  }

  ensureLogsDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
      console.log(`✓ Created logs directory: ${this.logsDir}`);
    }
  }

  getLogFile() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logsDir, `${CONFIG.logFilePrefix}_${dateStr}.log`);
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}`;

    console.log(logEntry);

    // Append to log file
    try {
      fs.appendFileSync(this.getLogFile(), logEntry + '\n');
    } catch (error) {
      console.error(`Failed to write to log: ${error.message}`);
    }
  }

  info(message) {
    this.log(message, 'INFO');
  }

  warn(message) {
    this.log(message, 'WARN');
  }

  error(message) {
    this.log(message, 'ERROR');
  }

  success(message) {
    this.log(message, 'SUCCESS');
  }

  cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.logsDir)
        .filter(f => f.startsWith(CONFIG.logFilePrefix))
        .map(f => ({
          name: f,
          path: path.join(this.logsDir, f),
          time: fs.statSync(path.join(this.logsDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // Keep only the last 30 files
      if (files.length > CONFIG.maxLogFiles) {
        const filesToDelete = files.slice(CONFIG.maxLogFiles);
        filesToDelete.forEach(file => {
          try {
            fs.unlinkSync(file.path);
            this.log(`Cleaned up old log: ${file.name}`, 'DEBUG');
          } catch (error) {
            this.warn(`Failed to delete old log ${file.name}: ${error.message}`);
          }
        });
      }
    } catch (error) {
      this.error(`Failed to cleanup old logs: ${error.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CRON SCHEDULER
// ═══════════════════════════════════════════════════════════════

class CronScheduler {
  constructor(logsDir) {
    this.logger = new CronLogger(logsDir);
    this.task = null;
    this.isRunning = false;
    this.lastRunTime = null;
    this.lastRunStatus = null;
  }

  async start() {
    try {
      this.logger.info('╔════════════════════════════════════════════════════╗');
      this.logger.info('║   CONTENT AUTOMATION CRON SCHEDULER STARTING        ║');
      this.logger.info('╚════════════════════════════════════════════════════╝');

      this.logger.info(`Schedule: ${CONFIG.scheduleTime} (8 AM daily)`);
      this.logger.info(`Orchestrator: ${CONFIG.orchestratorScript}`);
      this.logger.info(`Logs: ${CONFIG.logsDir}`);

      // Setup cron job
      this.task = cron.schedule(CONFIG.scheduleTime, async () => {
        await this.runOrchestration();
      });

      this.logger.success('✓ Cron scheduler started successfully');
      this.logger.info('Press Ctrl+C to stop the scheduler');

      // Cleanup old logs on startup
      this.logger.cleanupOldLogs();

      // Log next run time
      this.logNextRunTime();

      return true;
    } catch (error) {
      this.logger.error(`Failed to start scheduler: ${error.message}`);
      throw error;
    }
  }

  async runOrchestration() {
    if (this.isRunning) {
      this.logger.warn('⚠️  Orchestration already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = new Date();

    try {
      this.logger.info('════════════════════════════════════════════════════');
      this.logger.info('RUNNING ORCHESTRATION (Scheduled)');
      this.logger.info('════════════════════════════════════════════════════');

      await this.executeOrchestrator();

      const duration = new Date() - startTime;
      this.logger.success(`✓ Orchestration completed in ${(duration / 1000 / 60).toFixed(1)} minutes`);
      this.lastRunTime = startTime;
      this.lastRunStatus = 'SUCCESS';

      // Cleanup logs after successful run
      this.logger.cleanupOldLogs();

      // Log next run time
      this.logNextRunTime();

    } catch (error) {
      const duration = new Date() - startTime;
      this.logger.error(`✗ Orchestration failed after ${(duration / 1000 / 60).toFixed(1)} minutes: ${error.message}`);
      this.lastRunTime = startTime;
      this.lastRunStatus = 'FAILED';

      // Log next run time anyway
      this.logNextRunTime();

    } finally {
      this.isRunning = false;
    }
  }

  executeOrchestrator() {
    return new Promise((resolve, reject) => {
      this.logger.info(`Spawning orchestrator process...`);

      const child = spawn('node', [CONFIG.orchestratorScript], {
        cwd: path.dirname(CONFIG.orchestratorScript),
        stdio: 'pipe',
        detached: false
      });

      let stdout = '';
      let stderr = '';

      // Capture stdout
      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            this.logger.info(`[ORCHESTRATOR] ${line}`);
            stdout += line + '\n';
          }
        });
      });

      // Capture stderr
      child.stderr.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            this.logger.error(`[ORCHESTRATOR] ${line}`);
            stderr += line + '\n';
          }
        });
      });

      // Handle process end
      child.on('close', (code) => {
        if (code === 0) {
          this.logger.success('✓ Orchestrator exited successfully');
          resolve();
        } else {
          this.logger.error(`✗ Orchestrator exited with code ${code}`);
          reject(new Error(`Orchestrator failed with exit code ${code}`));
        }
      });

      // Handle process error
      child.on('error', (error) => {
        this.logger.error(`Process error: ${error.message}`);
        reject(error);
      });
    });
  }

  logNextRunTime() {
    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);

    const timeUntil = next - now;
    const hoursUntil = Math.floor(timeUntil / (1000 * 60 * 60));
    const minutesUntil = Math.floor((timeUntil % (1000 * 60 * 60)) / (1000 * 60));

    this.logger.info(`⏰ Next run scheduled: ${next.toISOString().split('T')[0]} at 08:00 UTC (in ${hoursUntil}h ${minutesUntil}m)`);
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task.destroy();
      this.logger.info('✓ Cron scheduler stopped');
    }
  }

  getStatus() {
    return {
      running: this.isRunning,
      schedule: CONFIG.scheduleTime,
      lastRunTime: this.lastRunTime,
      lastRunStatus: this.lastRunStatus,
      logsDirectory: CONFIG.logsDir
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════

async function main() {
  const scheduler = new CronScheduler(CONFIG.logsDir);

  try {
    // Start the scheduler
    await scheduler.start();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\nShutting down gracefully...');
      scheduler.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n\nTerminating gracefully...');
      scheduler.stop();
      process.exit(0);
    });

    // Keep the process running
    // The cron job will run at scheduled times

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Export for use as module
module.exports = { CronScheduler, CronLogger };

// Run if called directly
if (require.main === module) {
  main();
}
