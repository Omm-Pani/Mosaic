// =================================================================================
// File:         workers/fixer.worker.js
// Version:      2.0 (Mosaic 2.0)
//
// Purpose:      This worker handles the 'fix-code' job. When a piece of generated
//               code fails validation or testing, this worker is invoked to
//               attempt a repair using the Gemini LLM with the full context of
//               the error.
//
// V2.0 Change:  - The prompt is hardened with strict, prescriptive rules to guide
//                 the LLM in fixing common Next.js framework-level errors.
//               - The payload now includes the original description from the
//                 work graph to give the LLM better context on the file's intent.
// =================================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

function sanitizeLLMOutput(rawCode) {
    if (!rawCode) return '';
    return rawCode.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
}

/**
 * Attempts to fix faulty code using the Gemini LLM with full context.
 * @param {object} payload - The job payload.
 * @param {object} payload.fileToFix - The file object with { fileName, code }.
 * @param {string} payload.errorLog - The error message from the linter or tester.
 * @param {string} payload.originalDescription - The original description from the work graph.
 */
export async function fixCode(payload) {
    const { fileToFix, errorLog, originalDescription } = payload;
    const { fileName, code } = fileToFix;

    console.log(chalk.yellow(`[Fixer Worker] Attempting to fix error in ${fileName}...`));

    const prompt = `
=============================
ROLE: Expert Automated Code Repair Bot for Next.js & React
TASK: Your ONLY job is to fix the provided code file. You must rewrite the ENTIRE file to be correct, based on the error log and original intent.

>>> CRITICAL NEXT.JS RULES FOR THE FIX
1.  **Client Components:** Any component using hooks (\`useState\`, \`useEffect\`, etc.) or event handlers (\`onClick\`, \`onSubmit\`) MUST start with the \`'use client';\` directive.
2.  **Server Components:** Components that are \`async\` and fetch data directly MUST NOT use client-side hooks or event handlers. They get data by calling functions from \`@/lib/data\`.
3.  **Data Fetching:**
    -   **Server Components** MUST import from \`@/lib/data\` (e.g., \`const products = await data.getProducts();\`). DO NOT USE \`fetch\`.
    -   **Client Components** MUST use \`fetch\` to call API routes (e.g., \`fetch('/api/cart')\`).
4.  **Linking:** All navigation between pages MUST use the \`<Link href="...">\` component from \`next/link\`.
5.  **Return Full Code:** Your response must be ONLY the raw, complete, corrected code for the file. Do not add explanations, comments, or markdown.

=============================
CONTEXT: ORIGINAL INTENT
The file \`${fileName}\` was supposed to be:
"${originalDescription}"

=============================
THE FAULTY CODE TO FIX:
\`\`\`typescript
${code}
\`\`\`
=============================
THE ERROR LOG TO FIX:
\`\`\`
${errorLog}
\`\`\`
=============================
REWRITE AND PROVIDE THE COMPLETE, CORRECTED FILE NOW.
`.trim();

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const fixedCode = sanitizeLLMOutput(response.text());

        if (!fixedCode || fixedCode.length < 10) { // Basic sanity check
            throw new Error("Fixer LLM returned an empty or insufficient response.");
        }

        console.log(chalk.green(`[Fixer Worker] ✅ Successfully generated a fix for: ${fileName}`));
        return {
            fileName: fileName,
            code: fixedCode,
            status: 'fix_attempted'
        };
    } catch (error) {
        console.error(chalk.red(`[Fixer Worker] ❌ Failed to generate fix for ${fileName}:`), error);
        return {
            fileName: fileName,
            code: code, // Return original code on failure
            status: 'fix_failed'
        };
    }
}
