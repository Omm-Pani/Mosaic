// =================================================================================
// File:         workers/backend.route.worker.js
// Version:      6.0 (Mosaic 2.0 - Enterprise Grade)
//
// Purpose:      A specialized worker expert in generating Next.js API routes.
//               This version has been significantly upgraded to function as a
//               senior backend engineer, producing secure, validated, and
//               production-quality API endpoints.
//
// V6.0 Change:  - **Persona Upgrade**: The AI now acts as a "Senior Backend Engineer
//                 specializing in secure, production-grade Next.js APIs".
//               - **Security First**: The prompt now mandates the generation of
//                 explicit input validation for all POST/PUT request bodies and
//                 placeholder logic for authentication and role-based authorization,
//                 complete with proper 4xx error responses.
//               - **Structured Responses**: Strictly enforces a consistent JSON
//                 response structure for both success (`{ data: ... }`) and errors
//                 (`{ error: { message: '...' } }`), a crucial pattern for
//                 enterprise-grade APIs.
//               - **Robust Logic**: The generated code is expected to be more
//                 defensive, anticipating and handling potential issues gracefully.
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
 * Normalizes a path to use bracket syntax for dynamic segments.
 * This makes the worker resilient to inconsistencies from spec agents.
 * @param {string} path - The path to normalize.
 * @returns {string} The normalized path.
 */
function normalizePath(path) {
    if (!path) return '';
    // Converts both :param and {param} to [param] for consistent matching.
    return path
        .replace(/{([^{}]+)}/g, '[$1]')
        .replace(/:([^\/]+)/g, '[$1]');
}

/**
 * Generates code for a backend API route.
 * @param {object} payload - The job payload.
 * @param {string} payload.taskId - The file path of the route to generate.
 * @param {object} payload.buildPlan - The complete build plan.
 */
export async function generateBackendRoute(payload) {
    const { taskId, buildPlan } = payload;
    const { backend_apis, auth_rules } = buildPlan;

    const routePath = taskId.replace(/^app/, '').replace(/\/route\.ts$/, '').replace(/\/index$/, '');
    const normalizedTaskPath = normalizePath(routePath);

    const apiSpecs = backend_apis.apis.filter(api => {
        const normalizedSpecPath = normalizePath(api.path).replace(/\/$/, '');
        return normalizedSpecPath === normalizedTaskPath;
    });

    if (!apiSpecs || apiSpecs.length === 0) {
        throw new Error(`Could not find any API specifications for task: ${taskId} (normalized path: ${normalizedTaskPath})`);
    }

    const prompt = `
=============================
ROLE: Senior Backend Engineer specializing in secure, scalable, and production-grade Next.js APIs.
TASK: Write the complete, robust, and secure code for a Next.js API Route file based on the provided specifications. The generated code must be of the highest professional quality, suitable for a high-traffic application.

>>> CRITICAL RULES FOR PRODUCTION-GRADE API ROUTES
1.  **Imports**: Generate all necessary imports: \`NextResponse\` and \`NextRequest\` from \`next/server\`, and all required data access functions from \`@/lib/data\`.
2.  **One Function Per Method**: For EACH API spec provided for this file, you MUST export a corresponding \`async function\` for its HTTP method (e.g., \`export async function GET(req, { params })\`).
3.  **Secure Parameter Handling**:
    -   For dynamic routes (e.g., \`/api/products/[id]\`), correctly destructure the parameters from the handler's second argument: \`{ params }\`. You must validate that the parameter exists before using it.
    -   For query parameters, correctly extract them using \`req.nextUrl.searchParams.get('paramName')\`.
4.  **MANDATORY Input Validation**:
    -   For POST and PUT requests, you MUST parse the body using \`const body = await req.json();\`.
    -   You MUST then explicitly check for the presence and correct type of all required fields as defined in the spec's \`requestBody.required\` array.
    -   If validation fails, you MUST immediately return a \`NextResponse.json({ error: { message: 'Missing or invalid field: [field_name]' } }, { status: 400 });\`.
5.  **MANDATORY Authentication & Authorization Logic**:
    -   If the spec's \`auth.required\` is \`true\`, you MUST add placeholder logic to simulate checking for a user session (e.g., \`const session = await getSession(); // Placeholder for auth logic\`). If no session exists, return a 401 error.
    -   If \`allowedRoles\` is specified, you MUST add placeholder logic to check if the simulated user's role is included in the \`allowedRoles\` array. If not, return a 403 error.
    -   This security logic must be the first thing inside the handler function.
6.  **Structured & Consistent JSON Responses**:
    -   On success, ALL data MUST be wrapped in a \`data\` object: \`return NextResponse.json({ data: result }, { status: 200 });\`.
    -   On error (validation, auth, or server error), the error message MUST be wrapped in an \`error\` object: \`return NextResponse.json({ error: { message: 'Descriptive error message.' } }, { status: [code] });\`.
7.  **Robust Error Handling**: Every data access call or external service call MUST be wrapped in its own \`try/catch\` block. The catch block must log the detailed error for debugging (\`console.error\`) and return a standardized 500 error response to the client.
8.  **Clean, Commented Output**: Your response must be ONLY the raw, complete TypeScript code. Add comments where the logic is complex, especially for the placeholder auth checks and input validation sections. Do not add explanations or markdown.

=============================
API SPECIFICATIONS TO IMPLEMENT IN '${taskId}':
\`\`\`json
${JSON.stringify(apiSpecs, null, 2)}
\`\`\`

FULL AUTH RULES (for context on roles and permissions):
\`\`\`json
${JSON.stringify(auth_rules, null, 2)}
\`\`\`
=============================
GENERATE THE COMPLETE, SECURE, AND PRODUCTION-READY CODE FOR '${taskId}' NOW.
`;

    try {
        console.log(chalk.cyan(`[Backend Route Worker] Generating code for ${taskId} (methods: ${apiSpecs.map(s => s.method).join(', ')})...`));
        const result = await model.generateContent(prompt);
        const response = result.response;
        const finalCode = sanitizeLLMOutput(response.text());

        if (!finalCode) {
            throw new Error("LLM returned an empty response.");
        }

        console.log(chalk.green(`[Backend Route Worker] Successfully generated code for: ${taskId}`));
        return { fileName: taskId, code: finalCode };

    } catch (error) {
        console.error(chalk.red(`[Backend Route Worker] Error generating ${taskId}:`), error);
        return { fileName: taskId, code: `// FAILED TO GENERATE FILE: ${error.message}` };
    }
}
