// =================================================================================
// File:         orchestrator/work_graph_manager.js
// Version:      3.0 (Mosaic - Observability & Local Debugging)
// Purpose:      Core task scheduler for Mosaic.
//
// V3.0 Change:  - ENHANCEMENT: Added a `saveCodeLocally` function. After any
//                 `generate-*` task completes, the resulting code is now saved
//                 to a local `src` directory inside the `generated_projects/{buildId}`
//                 folder. This creates a complete, runnable copy of the app locally
//                 for debugging purposes.
// =================================================================================

import { Queue, QueueEvents } from "bullmq";
import Redis from "ioredis";
import chalk from "chalk";
import FormData from "form-data";
import axios from "axios";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

// --- Configuration & Constants ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GENERATED_PROJECTS_DIR = path.resolve(
  __dirname,
  "..",
  "generated_projects"
);
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const TASK_QUEUE_NAME = "mosaic-v2-tasks";
const PROGRESS_QUEUE_NAME = "mosaic-v2-progress";
const DEV_FLOW_MANAGER_URL =
  process.env.DEV_FLOW_MANAGER_URL || "http://localhost:8000";

// --- Service Connections ---
const redisConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const taskQueue = new Queue(TASK_QUEUE_NAME, { connection: redisConnection });
const progressQueue = new Queue(PROGRESS_QUEUE_NAME, {
  connection: redisConnection,
});
const taskQueueEvents = new QueueEvents(TASK_QUEUE_NAME, {
  connection: redisConnection,
});
taskQueueEvents.setMaxListeners(200);

// --- Helper Functions ---
async function emitProgress(buildId, message, status = "active", details = "") {
  if (!buildId) return;
  const logMessage = `[${buildId}] Progress: ${message} ${
    details ? `(${details})` : ""
  }`;
  console.log(chalk.gray(logMessage));
  await progressQueue.add("progress-event", {
    jobId: buildId,
    event: "progress",
    data: { step: message, status, details },
  });
}

async function callWorker(jobName, payload) {
  const job = await taskQueue.add(jobName, payload, {
    attempts: 2,
    backoff: { type: "exponential", delay: 1000 },
  });
  return await job.waitUntilFinished(taskQueueEvents);
}

// --- DevOps, File Streaming & Local Saving Logic ---

/**
 * Saves generated code to a local directory for debugging.
 * @param {string} buildId - The unique ID for the build.
 * @param {string} fileName - The relative path of the file (e.g., 'app/page.tsx').
 * @param {string} code - The code content to write.
 */
async function saveCodeLocally(buildId, fileName, code) {
  const localPath = path.join(GENERATED_PROJECTS_DIR, buildId, "src", fileName);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, code);
  console.log(
    chalk.magenta(`[Local Save] Saved ${fileName} for local debugging.`)
  );
}

async function executeDevOpsTask(node, buildId) {
  switch (node.task) {
    case "start-vm":
      console.log(
        chalk.blue(
          `[DevOps] Calling Dev-Flow Manager to start VM for ${buildId}...`
        )
      );
      const response = await axios.post(
        `${DEV_FLOW_MANAGER_URL}/start-environment`,
        {
          session_id: buildId,
        }
      );
      console.log(
        chalk.green(
          `[DevOps] VM started. Preview URL: ${response.data.preview_url}`
        )
      );
      return {
        status: "completed",
        details: `VM started. Preview at ${response.data.preview_url}`,
        previewUrl: response.data.preview_url,
      };
    default:
      console.log(chalk.blue(`[DevOps] Skipping unhandled task: ${node.task}`));
      return { status: "completed", details: `Skipped task: ${node.task}` };
  }
}

async function streamFileToVM(buildId, fileName, code) {
  const form = new FormData();
  form.append("session_id", buildId);
  form.append("relative_path", fileName);
  form.append("file", Buffer.from(code), {
    filename: fileName,
    contentType: "application/octet-stream",
  });

  await axios.post(`${DEV_FLOW_MANAGER_URL}/upload-file`, form, {
    headers: form.getHeaders(),
  });
  console.log(
    chalk.magenta(`[Streaming] Successfully streamed ${fileName} to VM.`)
  );
}

export async function executeBuildPipeline(jobData) {
  const { buildId, buildPlan } = jobData;
  const { workGraph } = buildPlan;
  let previewUrl = null;

  await emitProgress(buildId, "Initializing Parallel Build...", "active");

  const snakeCaseBuildPlan = {
    requirement_index: buildPlan.requirementIndex,
    work_graph: buildPlan.workGraph,
    ui_specs: buildPlan.uiSpecs,
    backend_apis: buildPlan.backendApis,
    data_models: buildPlan.dataModels,
    auth_rules: buildPlan.authRules,
    interaction_flows: buildPlan.interactionFlows,
  };

  const nodes = new Map(
    workGraph.nodes.map((node) => [node.id, { ...node, status: "pending" }])
  );
  const inDegree = new Map(workGraph.nodes.map((node) => [node.id, 0]));
  const adj = new Map(workGraph.nodes.map((node) => [node.id, []]));

  for (const node of nodes.values()) {
    for (const depId of node.dependsOn) {
      if (adj.has(depId)) {
        adj.get(depId).push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
      }
    }
  }

  let queue = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  let completedCount = 0;
  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);
    await emitProgress(
      buildId,
      `Starting batch of ${batch.length} parallel tasks...`,
      "active"
    );

    const promises = batch.map(async (nodeId) => {
      const node = nodes.get(nodeId);
      node.status = "running";
      await emitProgress(
        buildId,
        `> Starting: ${node.id}`,
        "active",
        `Task: ${node.task}`
      );

      try {
        if (node.task.startsWith("generate-")) {
          const workerPayload = {
            buildId,
            taskId: node.id,
            taskDescription: node.description,
            buildPlan: snakeCaseBuildPlan,
          };
          const result = await callWorker(node.task, workerPayload);

          // Save the generated code locally for debugging
          await saveCodeLocally(buildId, result.fileName, result.code);

          // Stream the file to the live VM environment
          await streamFileToVM(buildId, result.fileName, result.code);
        } else {
          const result = await executeDevOpsTask(node, buildId);
          if (result.previewUrl) previewUrl = result.previewUrl;
        }

        node.status = "completed";
        await emitProgress(buildId, `✓ Completed: ${node.id}`, "completed");
        completedCount++;

        for (const dependentId of adj.get(nodeId) || []) {
          inDegree.set(dependentId, inDegree.get(dependentId) - 1);
          if (inDegree.get(dependentId) === 0) {
            queue.push(dependentId);
          }
        }
      } catch (error) {
        node.status = "failed";
        const errorMessage = error.response?.data?.detail || error.message;
        await emitProgress(
          buildId,
          `✗ FAILED: ${node.id}`,
          "error",
          errorMessage
        );
        throw new Error(
          `Task ${node.id} (${node.task}) failed: ${errorMessage}`
        );
      }
    });

    await Promise.all(promises);
  }

  if (completedCount !== nodes.size) {
    throw new Error(
      "Build failed: Not all tasks in the work graph were completed."
    );
  }

  await emitProgress(
    buildId,
    `✓ Application deployed. Preview available.`,
    "completed"
  );

  return { buildId, previewUrl };
}
