// =================================================================================
// File:         api_gateway/server.js
// Version:      5.0 (Mosaic - Observability & Local Debugging)
// Purpose:      API Gateway orchestrating the chain-of-agents for PRD → Plan → Build
//
// V5.0 Change:  - ENHANCEMENT: Added a `recordData` function to save the output
//                 of every agent call and the initial user prompt into a
//                 `generated_projects/{buildId}` subfolder. This provides a
//                 complete audit trail for debugging the planning phase.
// =================================================================================

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import Redis from "ioredis";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import chalk from "chalk";

// --- Path Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENTS_DIR = path.resolve(__dirname, "..", "agents");
const GENERATED_PROJECTS_DIR = path.resolve(
  __dirname,
  "..",
  "generated_projects"
);
const PORT = process.env.PORT || 5001;
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const ORCHESTRATION_QUEUE_NAME = "mosaic-v2-orchestration-jobs";
const PROGRESS_QUEUE_NAME = "mosaic-v2-progress";
const AGENT_TIMEOUT_MS = 180000;

await fs.mkdir(GENERATED_PROJECTS_DIR, { recursive: true });

// --- App Setup ---
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});
const redisConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const jobQueue = new Queue(ORCHESTRATION_QUEUE_NAME, {
  connection: redisConnection,
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// --- WebSocket Progress Sync ---
io.on("connection", (socket) => {
  console.log(chalk.cyan(`[Socket.IO] Client connected: ${socket.id}`));
  socket.on("disconnect", () => {
    console.log(chalk.cyan(`[Socket.IO] Client disconnected: ${socket.id}`));
  });
});
new Worker(
  PROGRESS_QUEUE_NAME,
  async (job) => {
    const { jobId, event, data } = job.data;
    if (jobId) io.to(jobId).emit(event, data);
  },
  { connection: redisConnection }
);

// =================================================================================
// --- AGENT EXECUTION & OBSERVABILITY UTILS ---
// =================================================================================

/**
 * Executes a Python agent as a separate process.
 * @param {string} agentName - The name of the agent script (e.g., 'analyst_agent').
 * @param {object} payload - The JSON payload to send to the agent's stdin.
 * @returns {Promise<object>} The parsed JSON output from the agent.
 */
function callPythonAgent(agentName, payload) {
  return new Promise((resolve, reject) => {
    const agentPath = path.join(AGENTS_DIR, `${agentName}.py`);
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    console.log(chalk.yellow(`Spawning agent: ${agentName}`));
    const py = spawn(pythonCmd, [agentPath]);

    let stdout = "",
      stderr = "";
    const timeout = setTimeout(() => {
      py.kill("SIGKILL");
      reject(
        new Error(
          `Agent '${agentName}' timed out after ${AGENT_TIMEOUT_MS / 1000}s.`
        )
      );
    }, AGENT_TIMEOUT_MS);

    py.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    py.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    py.on("error", (err) => {
      clearTimeout(timeout);
      reject(
        new Error(`Failed to spawn agent '${agentName}'. Error: ${err.message}`)
      );
    });

    py.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        try {
          const errorResult = JSON.parse(stdout);
          return reject(new Error(errorResult.error || stderr));
        } catch {
          return reject(
            new Error(
              `Agent '${agentName}' failed with code ${code}: ${stderr}`
            )
          );
        }
      }
      try {
        const result = JSON.parse(stdout);
        if (result.status && result.status.includes("FAILED")) {
          return reject(
            new Error(result.error || `Agent '${agentName}' reported failure.`)
          );
        }
        console.log(chalk.green(`Agent '${agentName}' executed successfully.`));
        resolve(result);
      } catch (e) {
        reject(
          new Error(
            `Invalid JSON from '${agentName}': ${stdout}. Error: ${e.message}`
          )
        );
      }
    });

    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

/**
 * Saves data to a specified file for observability and debugging.
 * @param {string} buildId - The unique ID for the build.
 * @param {string} subfolder - The subfolder within the build directory (e.g., 'prd', 'buildplan').
 * @param {string} fileName - The name of the file to save.
 * @param {object} data - The JSON data to write to the file.
 */
async function recordData(buildId, subfolder, fileName, data) {
  const dir = path.join(GENERATED_PROJECTS_DIR, buildId, subfolder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), JSON.stringify(data, null, 2));
  console.log(chalk.gray(`[Observability] Saved ${fileName} for ${buildId}`));
}

// =================================================================================
// --- API ENDPOINTS ---
// =================================================================================

const AnalyzeSchema = z.object({
  projectName: z.string().min(3),
  prompt: z.string().min(20),
});

app.post("/api/analyze", async (req, res) => {
  try {
    const payload = AnalyzeSchema.parse(req.body);
    const buildId = `${payload.projectName
      .toLowerCase()
      .replace(/\s+/g, "-")}-${Date.now()}`;
    // OBSERVABILITY: Record the initial user prompt
    await recordData(buildId, "prd", "1_user_prompt.json", payload);

    console.log(
      chalk.blue(`\n--- [${buildId}] GATE 1: ANALYZE REQUIREMENTS ---`)
    );
    const analysisResult = await callPythonAgent("analyst_agent", payload);
    // OBSERVABILITY: Record the validated SRS
    await recordData(buildId, "prd", "2_validated_srs.json", analysisResult);

    res.status(200).json({
      buildId,
      validatedRequirements: analysisResult.validatedRequirements,
    });
  } catch (error) {
    const errorMessage =
      error.message || "An unknown error occurred during analysis.";
    console.error(chalk.red.bold("[/api/analyze] Error:"), errorMessage);
    console.error(error.stack);
    res.status(500).json({ message: errorMessage });
  }
});

const PlanSchema = z.object({
  buildId: z.string(),
  validatedRequirements: z.object({}).passthrough(),
});

app.post("/api/plan", async (req, res) => {
  const { buildId, validatedRequirements } = PlanSchema.parse(req.body);
  const srs = validatedRequirements;
  let buildPlan = {};

  try {
    console.log(
      chalk.blue(`\n--- [${buildId}] GATE 2.1: ELABORATE DATA MODELS ---`)
    );
    const dataModelStubs = [
      { name: "User", description: "Represents a user or customer." },
      { name: "Product", description: "Represents a product for sale." },
      { name: "Order", description: "Represents a customer order." },
      { name: "Cart", description: "Represents a user shopping cart." },
    ];
    const dataModelPromises = dataModelStubs.map((model) =>
      callPythonAgent("data_model_agent", {
        validatedRequirements: srs,
        modelName: model.name,
        modelDescription: model.description,
      })
    );
    const dataModelResults = await Promise.all(dataModelPromises);
    buildPlan.dataModels = { models: dataModelResults.map((r) => r.dataModel) };
    // OBSERVABILITY: Record the generated data models
    await recordData(
      buildId,
      "buildplan",
      "data_models.json",
      buildPlan.dataModels
    );

    console.log(
      chalk.blue(`\n--- [${buildId}] GATE 2.2: ELABORATE API SPECS ---`)
    );
    const apiDetails = {
      "get-products": {
        id: "get-products",
        method: "GET",
        path: "/api/products",
        description: "Retrieve a list of all products.",
      },
      "get-product-by-id": {
        id: "get-product-by-id",
        method: "GET",
        path: "/api/products/:id",
        description: "Retrieve details for a single product.",
      },
      "add-to-cart": {
        id: "add-to-cart",
        method: "POST",
        path: "/api/cart",
        description: "Add a product to the user's shopping cart.",
      },
      checkout: {
        id: "checkout",
        method: "POST",
        path: "/api/checkout",
        description: "Process the user's cart and create an order.",
      },
      "get-inventory": {
        id: "get-inventory",
        method: "GET",
        path: "/api/admin/inventory",
        description: "Get inventory levels for products.",
      },
      "update-inventory": {
        id: "update-inventory",
        method: "PUT",
        path: "/api/admin/inventory",
        description: "Update inventory levels for a product.",
      },
      "get-orders": {
        id: "get-orders",
        method: "GET",
        path: "/api/admin/orders",
        description: "Retrieve a list of all customer orders.",
      },
    };
    const apiSpecPromises = Object.values(apiDetails).map((api) =>
      callPythonAgent("api_spec_agent", {
        validatedRequirements: srs,
        dataModels: buildPlan.dataModels,
        apiDetails: api,
      })
    );
    const apiSpecResults = await Promise.all(apiSpecPromises);
    buildPlan.backendApis = { apis: apiSpecResults.map((r) => r.apiSpec) };
    // OBSERVABILITY: Record the generated API specs
    await recordData(
      buildId,
      "buildplan",
      "backend_apis.json",
      buildPlan.backendApis
    );

    console.log(
      chalk.blue(`\n--- [${buildId}] GATE 2.3: ELABORATE UI SPECS ---`)
    );
    const uiSpecPromises = srs.screens.map((screen) =>
      callPythonAgent("ui_spec_agent", {
        validatedRequirements: srs,
        pageId: screen.name.replace(/\s+/g, ""),
        pageDescription: screen.function,
      })
    );
    const uiSpecResults = await Promise.all(uiSpecPromises);
    buildPlan.uiSpecs = { uiSpecs: uiSpecResults.map((r) => r.uiSpec) };
    // OBSERVABILITY: Record the generated UI specs
    await recordData(buildId, "buildplan", "ui_specs.json", buildPlan.uiSpecs);

    console.log(
      chalk.blue(`\n--- [${buildId}] GATE 2.4: ELABORATE INTERACTION FLOWS ---`)
    );
    const interactionFlowResult = await callPythonAgent(
      "interaction_flow_agent",
      {
        validatedRequirements: srs,
        uiSpecs: buildPlan.uiSpecs,
      }
    );
    buildPlan.interactionFlows = interactionFlowResult.interactionFlows;
    // OBSERVABILITY: Record the generated interaction flows
    await recordData(
      buildId,
      "buildplan",
      "interaction_flows.json",
      buildPlan.interactionFlows
    );

    console.log(
      chalk.blue(`\n--- [${buildId}] GATE 2.5: LINK REQUIREMENTS ---`)
    );
    const requirementIndexResult = await callPythonAgent(
      "requirement_index_agent",
      {
        validatedRequirements: srs,
        uiSpecs: buildPlan.uiSpecs,
        backendApis: buildPlan.backendApis,
        interactionFlows: buildPlan.interactionFlows,
      }
    );
    buildPlan.requirementIndex = requirementIndexResult.requirementIndex;
    // OBSERVABILITY: Record the generated requirement index
    await recordData(
      buildId,
      "buildplan",
      "requirement_index.json",
      buildPlan.requirementIndex
    );

    console.log(
      chalk.blue(`\n--- [${buildId}] GATE 2.6: GENERATE AUTH RULES ---`)
    );
    const authRulesResult = await callPythonAgent("auth_rules_agent", {
      validatedRequirements: srs,
      backendApis: buildPlan.backendApis,
      requirementIndex: buildPlan.requirementIndex,
    });
    buildPlan.authRules = authRulesResult.authRules;
    // OBSERVABILITY: Record the generated auth rules
    await recordData(
      buildId,
      "buildplan",
      "auth_rules.json",
      buildPlan.authRules
    );

    console.log(
      chalk.blue(
        `\n--- [${buildId}] GATE 2.7: VALIDATE & ENFORCE PLAN CONSISTENCY ---`
      )
    );
    buildPlan.workGraph = { nodes: [] };
    const validationResult = await callPythonAgent("plan_validator_agent", {
      ...buildPlan,
    });
    const validatedPlan = validationResult.validatedPlan;
    // OBSERVABILITY: Record the final validated plan
    await recordData(
      buildId,
      "buildplan",
      "validated_plan.json",
      validatedPlan
    );

    console.log(
      chalk.blue(`\n--- [${buildId}] GATE 2.8: GENERATE FINAL WORK GRAPH ---`)
    );
    const workGraphResult = await callPythonAgent("work_graph_agent", {
      buildPlan: validatedPlan,
    });
    validatedPlan.workGraph = workGraphResult.workGraph;
    // OBSERVABILITY: Record the final work graph
    await recordData(
      buildId,
      "buildplan",
      "work_graph.json",
      validatedPlan.workGraph
    );

    console.log(
      chalk.green(
        `\n--- [${buildId}] ✅ Full and Detailed Build Plan Ready ---`
      )
    );
    res.status(200).json({ buildId, buildPlan: validatedPlan });
  } catch (error) {
    const errorMessage =
      error.message ||
      "An unknown error occurred during the planning and elaboration phase.";
    console.error(chalk.red.bold("[/api/plan] Error:"), errorMessage);
    console.error(error.stack);
    res.status(500).json({ message: errorMessage });
  }
});

const ExecuteSchema = z.object({
  buildId: z.string(),
  socketId: z.string().optional(),
  buildPlan: z.object({}).passthrough(),
});

app.post("/api/execute", async (req, res) => {
  try {
    const payload = ExecuteSchema.parse(req.body);

    console.log("Reached execute: ", payload);
    const { buildId, socketId } = payload;

    console.log(chalk.blue(`\n--- [${buildId}] GATE 3: QUEUE EXECUTION ---`));
    const job = await jobQueue.add("execute-plan", payload, {
      jobId: buildId,
      removeOnComplete: true,
      removeOnFail: true,
    });

    if (socketId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.join(buildId);
        console.log(
          chalk.cyan(`[Socket.IO] Socket ${socketId} joined room ${buildId}`)
        );
      } else {
        console.log(
          chalk.yellow(
            `[Socket.IO] Warning: Socket ${socketId} not found for build ${buildId}.`
          )
        );
      }
    }

    res.status(202).json({ jobId: job.id, message: "Build queued." });
  } catch (error) {
    const errorMessage =
      error.message || "An unknown error occurred during execution queuing.";
    console.error(chalk.red.bold("[/api/execute] Error:"), errorMessage);
    console.error(error.stack);
    res.status(500).json({ message: errorMessage });
  }
});

// --- Start Server ---
httpServer.listen(PORT, () => {
  console.log(
    chalk.green.bold(
      `\n🚀 Mosaic API Gateway (V5.0 - Observability) running at http://localhost:${PORT}\n`
    )
  );
});
