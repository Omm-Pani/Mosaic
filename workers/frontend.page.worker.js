// =================================================================================
// File:         workers/frontend.page.worker.js
// Version:      6.0 (Mosaic 2.0 - Enterprise Grade)
//
// Purpose:      A specialized worker expert in generating Next.js page components.
//               This version has been radically upgraded to function as a
//               Principal-level engineer, capable of building complex, data-intensive,
//               and production-ready user interfaces similar to those found in
//               enterprise applications like Salesforce or Zscaler.
//
// V6.0 Change:  - **Persona Upgrade**: The AI now acts as a "Lead UI/UX Architect &
//                 Principal Engineer".
//               - **Complex App Focus**: The prompt is now explicitly tailored for
//                 building large-scale, data-intensive applications.
//               - **Advanced Architecture**: Mandates the creation of self-contained,
//                 modular components within the file, including dedicated components
//                 for loading (skeletons), errors, and empty states.
//               - **Sophisticated State Management**: Requires the use of React Suspense
//                 for declarative loading states and detailed client-side state
//                 management for forms, including validation and submission states.
//               - **Data-Intensive UI Patterns**: Includes specific instructions for
//                 building complex data tables with client-side sorting and filtering,
//                 and robust forms with validation.
//               - **Inference & Autonomy**: Instructs the agent to make sensible,
//                 professional choices when specs are ambiguous, favoring robust
//                 patterns over simple implementations.
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
 * Generates code for a frontend page component.
 * @param {object} payload - The job payload.
 * @param {string} payload.taskId - The file path of the page to generate.
 * @param {object} payload.buildPlan - The complete build plan.
 */
export async function generateFrontendPage(payload) {
    const { taskId, buildPlan } = payload;
    const { requirement_index, ui_specs, interaction_flows } = buildPlan;

    const normalizedTaskPath = normalizePath(taskId.replace(/\/page\.tsx$/, ''));
    const pageSpec = requirement_index.pages.find(p => {
        const normalizedPagePath = normalizePath(p.path.replace(/\/page\.tsx$/, ''));
        return normalizedPagePath === normalizedTaskPath;
    });

    if (!pageSpec) {
        throw new Error(`Could not find Page Specification for task: ${taskId} (Normalized: ${normalizedTaskPath})`);
    }
    
    const relatedUiSpec = ui_specs.uiSpecs.find(s => s.id === pageSpec.uiSpecId);
    const relatedFlows = interaction_flows.flows.filter(f => pageSpec.flowIds.includes(f.id));

    const prompt = `
=============================
ROLE: Lead UI/UX Architect & Principal Engineer, specializing in building complex, data-intensive, and highly scalable enterprise applications like Salesforce, Zscaler, or Grafana using Next.js and React.

TASK: Your mission is to write the complete, production-ready code for a single Next.js Page file. You must interpret the provided specifications not as rigid constraints, but as a blueprint. You are expected to infer intent, apply advanced software design patterns, and produce code that is robust, maintainable, and provides a superior user experience.

>>> CRITICAL PRINCIPLES FOR ENTERPRISE-GRADE UI
1.  **Code as a Self-Contained Module**: The generated file must be entirely self-contained. All necessary sub-components (e.g., Skeleton Loaders, Error Displays, Interactive Forms, Data Tables) MUST be defined within the same file. The default export will be the main page component.

2.  **MANDATORY & Strict Component Architecture**:
    -   **Page as Server Component**: The default export MUST be an \`async\` React Server Component. Its sole responsibilities are fetching initial data from the data layer (\`@/lib/data\`) and managing the layout of the page. It CANNOT use hooks or handle user events.
    -   **Interactivity via Client Components**: Any UI element that requires user interaction (\`onClick\`, \`onChange\`, \`onSubmit\`) or state (\`useState\`, \`useEffect\`) MUST be encapsulated in its own dedicated Client Component, clearly marked with the \`'use client';\` directive. The main page component will then render these Client Components, passing data and functions as props. This separation is non-negotiable.

3.  **MANDATORY & Sophisticated State Management**:
    -   **Declarative Loading with Suspense**: For any data-fetching operation, you MUST wrap the component that consumes the data in a React \`<Suspense>\` boundary.
    -   **Skeleton Components**: The \`fallback\` for Suspense MUST be a dedicated Skeleton Component that visually mimics the layout of the content being loaded. For example, a list of products should have a \`ProductCardSkeleton\` component that shows grey placeholder boxes.
    -   **Robust Error Handling**: If a data fetch can fail, you MUST use an Error Boundary or a \`try/catch\` block within the Server Component to catch the error. You MUST then render a dedicated \`ErrorDisplay\` component that shows a user-friendly message and a "Try Again" button.
    -   **Meaningful Empty States**: If a list of data can be empty, you MUST render a dedicated \`EmptyState\` component. This component should include an icon, a clear message (e.g., "No orders found"), and a relevant call-to-action button (e.g., "Create New Order").

4.  **Data-Intensive Component Patterns**:
    -   **Complex Forms**: For any form, create a Client Component that manages its state using \`useState\`. This includes state for form data, validation errors, and submission status (e.g., 'idle', 'submitting', 'success', 'error'). Perform client-side validation for immediate feedback.
    -   **Advanced Data Tables**: For any UI spec requiring a list or table of data, generate a Client Component that renders the data. If the dataset is large, you MUST implement client-side controls for sorting and text-based filtering, managed with \`useState\` and \`useMemo\`.

5.  **Uncompromising Code Quality & Accessibility**:
    -   **TypeScript First**: Use TypeScript for all props, state, and function signatures. Import all necessary types from \`@/lib/types\`.
    -   **JSDoc Everywhere**: Every component and every complex function MUST have a detailed JSDoc block explaining its purpose, props (\`@param\`), and return values (\`@returns\`).
    -   **Accessibility as a Feature**: All images MUST have descriptive \`alt\` tags. All form inputs MUST be wrapped in a \`<label>\` or have an \`aria-label\`. Interactive elements must be keyboard-navigable.
    -   **Styling**: Use TailwindCSS to create a clean, professional, and fully responsive UI.

6.  **Autonomy and Inference**: If a specification is ambiguous, you are to make the most sensible engineering decision based on the context of building a complex, production-grade enterprise application. Prioritize robustness, user experience, and maintainability.

7.  **Clean Output**: Your response must be ONLY the raw, complete, and runnable JSX/TSX code for the file. Do not add explanations, markdown, or any text outside the code.

=============================
PAGE SPECIFICATION TO IMPLEMENT:
File Path: ${taskId}
\`\`\`json
${JSON.stringify(pageSpec, null, 2)}
\`\`\`

RELATED UI SPEC:
\`\`\`json
${JSON.stringify(relatedUiSpec, null, 2)}
\`\`\`

RELATED INTERACTION FLOWS:
\`\`\`json
${JSON.stringify(relatedFlows, null, 2)}
\`\`\`
=============================
GENERATE THE COMPLETE, ROBUST, AND ENTERPRISE-GRADE CODE FOR '${taskId}' NOW.
`;

    try {
        console.log(chalk.cyan(`[Frontend Page Worker] Generating code for ${taskId}...`));
        const result = await model.generateContent(prompt);
        const response = result.response;
        const finalCode = sanitizeLLMOutput(response.text());

        if (!finalCode) {
            throw new Error("LLM returned an empty response.");
        }

        console.log(chalk.green(`[Frontend Page Worker] Successfully generated code for: ${taskId}`));
        return { fileName: taskId, code: finalCode };

    } catch (error) {
        console.error(chalk.red(`[Frontend Page Worker] Error generating ${taskId}:`), error);
        return { fileName: taskId, code: `// FAILED TO GENERATE FILE: ${error.message}` };
    }
}
