// =================================================================================
// File:         workers/tester.worker.js
// Version:      2.0 (Mosaic 2.0)
//
// Purpose:      This worker performs simple functional "smoke tests" on the
//               running application by making HTTP requests to generated pages
//               and API endpoints.
//
// V2.0 Change:  - Logic remains similar but is now integrated into the DAG-based
//                 flow, triggered after the dev environment is live.
//               - Path mapping logic is robust for both API routes and Next.js
//                 app router pages.
// =================================================================================
import axios from 'axios';
import chalk from 'chalk';

/**
 * Tests a generated API endpoint or Frontend page.
 * @param {object} payload - The job payload.
 * @param {string} payload.fileToTest - The path of the file being tested (e.g., app/api/health/route.ts or app/products/page.tsx).
 * @param {string} payload.previewUrl - The base URL of the running VM.
 * @returns {Promise<{status: string, details: string}>} The test result.
 */
export async function testCode(payload) {
    const { fileToTest, previewUrl } = payload;
    let testPath;

    // --- Map file path to a testable URL path ---
    if (fileToTest.startsWith('app/api/')) {
        // Handle API routes: app/api/health/route.ts -> /api/health
        testPath = fileToTest
            .replace(/^app/, '')
            .replace(/\/route\.ts$/, '')
            // Replace dynamic segments like [id] with a placeholder '1' for testing
            .replace(/\[([^\]]+)\]/g, '1');
    } else if (fileToTest.endsWith('page.tsx')) {
        // Handle Page routes: app/products/[id]/page.tsx -> /products/1
        if (fileToTest === 'app/page.tsx') {
            testPath = '/';
        } else {
            testPath = fileToTest
                .replace(/^app/, '')
                .replace(/\/page\.tsx$/, '')
                .replace(/\[([^\]]+)\]/g, '1');
        }
    } else {
        // For any other file type (e.g., components, lib files), skip the functional test.
        return { status: 'passed', details: `Skipped (not a testable page or API route).` };
    }


    const fullUrl = `${previewUrl}${testPath}`;
    console.log(chalk.cyan(`[Tester Worker] Testing endpoint: GET ${fullUrl}`));

    try {
        const response = await axios.get(fullUrl, { timeout: 10000 });
        // A 2xx status code indicates success.
        if (response.status >= 200 && response.status < 300) {
            console.log(chalk.green(`[Tester Worker] ✅ PASSED: ${testPath} (Status: ${response.status})`));
            return { status: 'passed', details: `Endpoint returned status ${response.status}` };
        } else {
            // Any other status is considered a failure for this simple test.
            throw new Error(`Endpoint returned non-success status: ${response.status}`);
        }
    } catch (error) {
        const errorMessage = error.response ? `Status ${error.response.status}` : error.message;
        console.log(chalk.red(`[Tester Worker] ❌ FAILED: ${testPath} (${errorMessage})`));
        return { status: 'failed', details: `Test failed for GET ${testPath}. Error: ${errorMessage}` };
    }
}
