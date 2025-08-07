// =================================================================================
// File:         workers/guard.worker.js
// Version:      2.0 (Mosaic 2.0)
//
// Purpose:      This worker acts as a "Quality Guard". It handles the
//               'validate-code' job by performing static analysis (linting)
//               on the generated code before it's written to the environment.
//
// V2.0 Change:  - The worker's payload is simplified to just `fileName` and
//                 `code`, as it doesn't need the full build plan context.
//               - ESLint configuration is robust for modern Next.js + TypeScript.
// =================================================================================

import { ESLint } from 'eslint';
import chalk from 'chalk';

// --- ESLint Configuration ---
// This configuration is set up to correctly parse modern Next.js projects
// that use the `app` directory and TypeScript.
const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: {
        parser: '@typescript-eslint/parser',
        env: {
            browser: true,
            node: true,
            es2021: true,
        },
        extends: [
            'eslint:recommended',
            'plugin:react/recommended',
            'plugin:@typescript-eslint/recommended',
            'next/core-web-vitals' // Essential for Next.js specific rules
        ],
        plugins: ['react', '@typescript-eslint'],
        settings: {
            react: {
                version: 'detect', // Automatically detect the React version
            },
        },
        rules: {
            // Suppress common rules that can be noisy during generation
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            // Disable rule that looks for 'pages' dir, as we use 'app'
            '@next/next/no-html-link-for-pages': 'off',
        },
        parserOptions: {
            ecmaVersion: 2021,
            sourceType: 'module',
            ecmaFeatures: {
                jsx: true,
            },
        },
    },
});

/**
 * Validates a string of code using ESLint.
 * @param {object} payload - The job payload.
 * @param {string} payload.fileName - The name of the file for context.
 * @param {string} payload.code - The code to validate.
 * @returns {Promise<{status: string, errors: Array}>} Validation result.
 */
export async function validateCode(payload) {
    const { fileName, code } = payload;
    console.log(chalk.blue(`[Guard Worker] Starting validation for: ${fileName}`));

    if (!code || code.trim() === '') {
        console.log(chalk.yellow(`[Guard Worker] Skipped empty file: ${fileName}`));
        return { status: 'passed', errors: [] };
    }

    try {
        const results = await eslint.lintText(code, { filePath: fileName });
        const messages = results[0]?.messages || [];
        const errors = messages
            .filter(msg => msg.severity > 1) // Only count errors, not warnings
            .map(msg => `Linter [${msg.ruleId || 'general'}]: ${msg.message} (Line: ${msg.line}, Col: ${msg.column})`);

        if (errors.length > 0) {
            console.log(chalk.yellow(`[Guard Worker] Found ${errors.length} linting issues in ${fileName}.`));
            return { status: 'failed', errors: errors };
        }

        console.log(chalk.green(`[Guard Worker] ✅ Passed validation: ${fileName}`));
        return { status: 'passed', errors: [] };
    } catch (error) {
        console.error(chalk.red(`[Guard Worker] Linter crashed for ${fileName}:`), error);
        return { status: 'failed', errors: [`Linter crashed: ${error.message}`] };
    }
}
