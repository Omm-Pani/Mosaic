// =================================================================================
// File:         7_vm_template/lib/data.ts (GENERIC TEMPLATE)
// Version:      2.0
//
// Purpose:      This file establishes a generic, low-level database connection.
//               It is intended to be a blank slate for the code generation
//               workers.
//
// V2.0 Change:  - Refactored from a specific e-commerce implementation to a
//                 generic database client export. This allows code generation
//                 workers to implement any data model and logic required by the
//                 user's prompt, rather than being tied to sneakers.
// =================================================================================

import { Pool } from 'pg';

// Establish a database connection pool.
// The connection string (DATABASE_URL) is provided by the environment
// variables set in the docker-compose file by the Dev-Flow Manager.
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * ==============================================================================
 * --- FOR LLM CODE GENERATION WORKERS ---
 * ==============================================================================
 *
 * Use this 'db' object to interact with the database. You can execute
 * raw SQL queries like this:
 *
 * Example Query:
 *
 * async function getBlogPosts() {
 * try {
 * const result = await db.query('SELECT * FROM posts ORDER BY created_at DESC');
 * return result.rows;
 * } catch (error) {
 * console.error('Database Error:', error);
 * throw new Error('Failed to fetch blog posts.');
 * }
 * }
 *
 * You are responsible for generating all necessary data access functions
 * (e.g., getUsers, getProducts, createOrder) required by the API routes
 * and Server Components based on the project's OpenAPI specification and
 * user requirements.
 *
 * You must also generate the corresponding type definitions in 'lib/types.ts'.
 *
 * ==============================================================================
 */

export { db };
