// =================================================================================
// File:         orchestrator/orchestrator.js
// Version:      2.1 (Mosaic 2.0)
//
// Purpose:      This is the main entry point for the orchestrator service.
//
// V2.1 Change:  - CRITICAL FIX: The worker now listens to the dedicated
//                 `mosaic-v2-orchestration-jobs` queue. This ensures it only
//                 processes the high-level 'execute-plan' job and avoids
//                 conflicts with the code generation workers.
// =================================================================================

import 'dotenv/config';
import { Worker } from "bullmq";
import Redis from "ioredis";
import chalk from 'chalk';
import { executeBuildPipeline } from "./work_graph_manager.js";

// --- Configuration & Connection Setup ---
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
// FIX: Listen to the dedicated orchestration queue
const ORCHESTRATION_QUEUE_NAME = "mosaic-v2-orchestration-jobs";

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

console.log(chalk.blue(`Orchestrator connecting to Redis at ${chalk.yellow(REDIS_URL)}`));
console.log(chalk.blue(`Listening for jobs on queue: ${chalk.cyan(ORCHESTRATION_QUEUE_NAME)}`));

// --- BullMQ Worker Definition ---
const worker = new Worker(
  ORCHESTRATION_QUEUE_NAME, // FIX: Listen to the correct queue
  async (job) => {
    if (job.name === 'execute-plan') {
        const { buildId } = job.data;
        console.log(chalk.green.bold(`\n--- [${buildId}] Starting Execution via Work Graph Manager ---`));

        try {
            const finalResult = await executeBuildPipeline(job.data);
            console.log(chalk.green.bold(`\n--- [${buildId}] Finished Job ---`));
            return { status: "completed", ...finalResult };
        } catch (error) {
            console.error(chalk.red.bold(`\n--- [${buildId}] Critical Error during build pipeline ---`));
            console.error(error);
            throw error;
        }
    }
  },
  { connection }
);

// --- Worker Event Listeners for Logging ---
worker.on("completed", (job, result) => {
  console.log(chalk.green(`Job ${job.id} has completed. Preview available at: ${result?.previewUrl || 'N/A'}`));
});

worker.on("failed", (job, err) => {
  console.error(chalk.red.bold(`Job ${job.id} has FAILED: ${err.message}`));
});

console.log(chalk.bold.green('Mosaic 2.0 Orchestrator is running.'));
