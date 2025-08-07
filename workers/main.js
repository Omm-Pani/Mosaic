// =================================================================================
// File:         workers/main.js
// Version:      2.1 (Mosaic 2.0)
//
// Purpose:      Main entry point for the worker service.
//
// V2.1 Change:  - CRITICAL FIX: The worker now listens to the dedicated
//                 `mosaic-v2-tasks` queue. This ensures it only processes
//                 granular code generation jobs and will no longer see the
//                 'execute-plan' job meant for the orchestrator.
// =================================================================================

import 'dotenv/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import chalk from 'chalk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Import all specialized worker logic handlers ---
import { generateFrontendPage } from './frontend.page.worker.js';
import { generateBackendRoute } from './backend.route.worker.js';
import { generateSharedCode } from './shared.code.worker.js';
import { validateCode } from './guard.worker.js';
import { fixCode } from './fixer.worker.js';
import { testCode } from './tester.worker.js';

// --- Configuration & Connection Setup ---
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
// FIX: Listen to the dedicated task queue
const TASK_QUEUE_NAME = "mosaic-v2-tasks";
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY, 10) || 10;

/**
 * Performs a pre-flight health check to ensure the Gemini API is configured.
 */
async function performApiHealthCheck() {
    console.log(chalk.yellow('Performing pre-flight API health check...'));
    if (!process.env.GOOGLE_API_KEY) {
        console.error(chalk.red.bold('\nFATAL ERROR: GOOGLE_API_KEY is not defined.'));
        process.exit(1);
    }
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        await genAI.getGenerativeModel({ model: "gemini-pro" });
        console.log(chalk.green('API health check passed.'));
    } catch (error) {
        console.error(chalk.red.bold('\nFATAL ERROR: Failed to connect to Google Generative AI.'), error);
        process.exit(1);
    }
}

/**
 * Initializes and starts the main BullMQ worker process.
 */
function startWorker() {
    const redisConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

    console.log(chalk.blue(`Worker service connecting to Redis at ${chalk.cyan(REDIS_URL)}`));
    console.log(chalk.blue(`Listening for tasks on queue: ${chalk.cyan(TASK_QUEUE_NAME)} with concurrency ${CONCURRENCY}`));

    const mainWorker = new Worker(
        TASK_QUEUE_NAME, // FIX: Listen to the correct queue
        async (job) => {
            console.log(`[Main Worker] Received job '${chalk.cyan(job.name)}' (ID: ${job.id})`);
            
            switch (job.name) {
                case 'generate-types':
                case 'generate-data-layer':
                case 'generate-shared-util':
                    return await generateSharedCode(job.data);
                
                case 'generate-homepage':
                case 'generate-frontend-page':
                case 'generate-frontend-component':
                    return await generateFrontendPage(job.data);

                case 'generate-api-route':
                    return await generateBackendRoute(job.data);
                
                case 'validate-code':
                    return await validateCode(job.data);
                
                case 'fix-code':
                    return await fixCode(job.data);
                
                case 'test-code':
                    return await testCode(job.data);
                    
                default:
                    throw new Error(`Unknown job name: ${job.name}`);
            }
        },
        {
            connection: redisConnection,
            concurrency: CONCURRENCY
        }
    );

    mainWorker.on('completed', (job) => {
        console.log(chalk.green(`[Main Worker] Job '${chalk.cyan(job.name)}' (ID: ${job.id}) has completed.`));
    });

    mainWorker.on('failed', (job, err) => {
        console.error(chalk.red.bold(`[Main Worker] Job '${chalk.cyan(job.name)}' (ID: ${job.id}) has FAILED: ${err.message}`));
    });

    console.log(chalk.green.bold('Mosaic 2.0 Worker service is running.'));
}

// --- Main Execution ---
performApiHealthCheck().then(() => {
    startWorker();
});
