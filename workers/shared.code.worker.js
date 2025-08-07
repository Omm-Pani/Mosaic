// =================================================================================
// File:         workers/shared.code.worker.js
// Version:      6.0 (Mosaic 2.0 - Enterprise Grade)
//
// Purpose:      This specialized worker handles the generation of shared, foundational
//               code. It has been significantly upgraded to function as a senior
//               architect, inferring intent and generating descriptive,
//               production-quality code that forms the application's backbone.
//
// V6.0 Change:  - **Persona Upgrade**: The AI now acts as an "Expert TypeScript &
//                 Database Architect" or "Expert Backend Developer & SQL Architect".
//               - **Intelligent Type Generation**: Strictly enforces the creation of
//                 detailed JSDoc comments for every property in every generated
//                 TypeScript interface, making the types self-documenting.
//               - **Relationship-Aware Data Access**: The data access layer generation
//                 is now instructed to analyze data model relationships and write
//                 more realistic placeholder SQL queries with appropriate JOINs.
//               - **Comprehensive Documentation**: Mandates full JSDoc documentation
//                 for every generated function, including @param and @returns tags.
// =================================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

// --- Gemini API Initialization ---
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

// --- Helper Functions ---
function sanitizeLLMOutput(rawCode) {
    if (!rawCode) return '';
    let cleanedCode = rawCode.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
    return cleanedCode.trim();
}

/**
 * Generates code for a shared module (types or data access).
 * @param {object} payload - The job payload from the graph manager.
 * @param {string} payload.taskId - The file path being generated (e.g., 'lib/types.ts').
 * @param {object} payload.buildPlan - The complete build plan containing all specs.
 */
export async function generateSharedCode(payload) {
    const { taskId, buildPlan, taskDescription } = payload;
    const { data_models, backend_apis } = buildPlan;

    let systemPrompt;

    // --- Dynamic Prompt Selection based on File Path (taskId) ---
    if (taskId.endsWith('lib/types.ts')) {
        // --- TYPE GENERATION MODE ---
        systemPrompt = `
=============================
ROLE: Expert TypeScript & Database Architect
TASK: Your ONLY job is to generate professional, production-ready TypeScript interfaces based on the provided data models. This file is the single source of truth for the application's data structures.

>>> CRITICAL RULES FOR PRODUCTION-GRADE TYPES
1.  **Comprehensive Generation**: Analyze the \`models\` from the \`data_models.json\` spec. For EACH model found, you MUST create and export a corresponding TypeScript \`interface\`.
2.  **Intelligent & Strict Type Mapping**:
    - Map custom data types to their most appropriate TypeScript equivalents:
      - 'uuid' -> \`string\`
      - 'hashed_string' -> \`string\`
      - 'datetime' -> \`string\` (ISO 8601 format)
      - 'timestamp' -> \`string\`
      - 'decimal' -> \`number\`
      - 'text' -> \`string\`
      - 'string[]' -> \`string[]\`
    - Represent 'enum' types as string literal types for maximum type safety (e.g., \`'pending' | 'processing' | 'shipped'\`).
    - Optional fields (where \`required: false\`) MUST be marked with a \`?\` in the interface (e.g., \`last_name?: string;\`).
3.  **Mandatory JSDoc Commentary**: For EACH property in EACH interface, you MUST write a clear, concise JSDoc comment explaining its purpose. This comment should be derived directly from the \`description\` field in the spec. This is a non-negotiable requirement for code quality and maintainability.
4.  **Relationships & Foreign Keys**: For fields that are foreign keys (e.g., \`user_id\`), ensure the JSDoc comment clearly states which model it references.
5.  **Clean Output**: Your response must be ONLY the raw, complete TypeScript code for the file. Do not add any explanations, markdown, or extra text outside of the code itself.

=============================
DATA MODELS SPEC (data_models.json):
\`\`\`json
${JSON.stringify(data_models, null, 2)}
\`\`\`
=============================
GENERATE THE COMPLETE, WELL-DOCUMENTED, AND PRODUCTION-READY '${taskId}' FILE NOW.
`;
    } else if (taskId.endsWith('lib/data.ts')) {
        // --- DATA ACCESS LAYER GENERATION MODE ---
        systemPrompt = `
=============================
ROLE: Expert Backend Developer & SQL Architect
TASK: Your ONLY job is to generate the full code for a production-grade data access layer ('data.ts'). This file is the critical bridge between the API routes and the database.

>>> CRITICAL RULES FOR PRODUCTION-GRADE DATA ACCESS
1.  **Imports**: You MUST import the 'db' client from './db' and all necessary generated types from './types'.
2.  **Function Generation**: Analyze the \`apis\` from the \`backend_apis.json\` spec. For EACH API endpoint, you MUST create and export a corresponding asynchronous data access function. The function name should be a clear, verb-first representation of the API ID (e.g., 'get-products' -> \`getProducts\`, 'get-product-by-id' -> \`getProductById\`).
3.  **Intelligent SQL Generation**:
    - Write placeholder SQL queries that are as realistic and performant as possible.
    - **Infer Relationships**: Analyze the \`relationships\` section of the provided data models. If fetching a resource would benefit from joined data (e.g., getting an order and the customer's name), you MUST write a query with the appropriate \`LEFT JOIN\`. For example, \`getOrderById\` should join the \`orders\` table with the \`users\` table.
    - **Security First**: All queries that accept parameters MUST use parameterized query syntax (e.g., \`$1\`, \`$2\`) to prevent SQL injection vulnerabilities. This is a critical security requirement.
4.  **Robust Error Handling**: Every single exported function MUST be wrapped in a \`try/catch\` block. The catch block should \`console.error\` the specific error and then re-throw a more generic, user-friendly error (e.g., \`throw new Error('Failed to fetch products.');\`).
5.  **Comprehensive Documentation**: For EACH function, you MUST write a detailed JSDoc block. This block must include:
    - A clear description of the function's purpose.
    - A \`@param\` tag for every argument, specifying its type and purpose.
    - A \`@returns\` tag describing the promise's resolved value.
6.  **Clean Output**: Your response must be ONLY the raw, complete TypeScript code for the file. Do not include any explanations, markdown, or other text.

=============================
DATA MODELS SPEC (for context on relationships and table structures):
\`\`\`json
${JSON.stringify(data_models, null, 2)}
\`\`\`

BACKEND APIS SPEC (to determine required functions):
\`\`\`json
${JSON.stringify(backend_apis, null, 2)}
\`\`\`
=============================
GENERATE THE COMPLETE, PROFESSIONAL, AND WELL-DOCUMENTED '${taskId}' FILE NOW.
`;
    } else {
        // Fallback for any other shared file
        systemPrompt = `
=============================
ROLE: Expert Full-Stack Developer
TASK: Write the complete code for the file specified by the path and description.
FILE PATH: ${taskId}
DESCRIPTION: ${taskDescription}
Your response must be ONLY the raw, complete code for the file. No explanations, no markdown.
=============================
`;
    }

    try {
        console.log(chalk.cyan(`[Shared Code Worker] Generating code for ${taskId}...`));
        const result = await model.generateContent(systemPrompt);
        const response = result.response;
        const sanitizedCode = sanitizeLLMOutput(response.text());

        if (!sanitizedCode) {
            throw new Error("LLM returned an empty response.");
        }

        console.log(chalk.green(`[Shared Code Worker] Successfully generated code for: ${taskId}`));
        return { fileName: taskId, code: sanitizedCode };

    } catch (error) {
        console.error(chalk.red(`[Shared Code Worker] Error generating ${taskId}:`), error);
        return { fileName: taskId, code: `// FAILED TO GENERATE FILE: ${error.message}` };
    }
}
