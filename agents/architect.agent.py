# =================================================================================
# File:         agents/architect.agent.py (New)
# Version:      1.0
#
# Purpose:      This new agent acts as an automated "Code Architect" and "Reviewer".
#               It uses an LLM to perform a code review on generated files,
#               checking them against a comprehensive checklist of architectural
#               best practices for Next.js applications. This is far more
#               powerful than a simple linter.
# =================================================================================

import sys
import json
import os
import traceback
from typing import List, Dict, Any

try:
    from pydantic import BaseModel, Field, ValidationError
    import google.generativeai as genai
    from dotenv import load_dotenv
except ImportError as e:
    sys.stderr.write(f"IMPORT ERROR: A required library is not installed. Please run 'pip install -r requirements.txt'. Details: {e}\n")
    sys.exit(1)

load_dotenv()

# --- Pydantic Schemas ---
class ReviewResult(BaseModel):
    status: str = Field(..., description="Either 'passed' or 'failed'.")
    errors: List[str] = Field(..., description="A list of architectural violations found. Empty if status is 'passed'.")

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (architect.agent): {message}\n")
    sys.stdout.flush()

def get_gemini_model() -> genai.GenerativeModel:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    # Note: We expect a structured JSON response, so we configure the model accordingly.
    return genai.GenerativeModel(
        "gemini-1.5-pro-latest",
        generation_config={"response_mime_type": "application/json"}
    )

def create_review_prompt(file_name: str, file_content: str) -> str:
    output_schema = json.dumps(ReviewResult.model_json_schema(), indent=2)
    return f"""
You are a world-class Principal Software Architect and automated code reviewer for Next.js applications.
Your sole task is to analyze the provided code file and determine if it violates any of the critical architectural rules listed below.

--- ARCHITECTURAL CHECKLIST ---
1.  **Strict Client/Server Separation**:
    -   Does the file export an `async function` (a Server Component) that ALSO illegally uses client-side hooks like `useState`, `useEffect`, or `useRouter`? This is a major violation.
    -   Does the file contain any interactive elements (e.g., `onClick`, `onChange`) in a component that is NOT explicitly marked with `'use client';` at the very top? This is a violation.
2.  **State Management & UX**:
    -   If the code fetches data, does it handle the loading state? (e.g., with a Suspense boundary or conditional rendering). A lack of loading state is a violation.
    -   If the code fetches data, does it handle a potential error state? A lack of a try/catch or error boundary is a violation.
    -   If the code renders a list, does it handle the empty state (when the list has 0 items)? A lack of an empty state check is a violation.
3.  **Imports and Dependencies**:
    -   Does the code import from a generic path like `'@/components/ui/...'`? This is a violation, as all components should be self-contained within the file or imported from a clearly defined shared layout.
4.  **Security (for API Routes)**:
    -   If this is an API route that modifies data (POST, PUT, DELETE), does it have placeholder logic for authentication and authorization checks? A lack of these checks is a security violation.
    -   Does it perform input validation on the request body? A lack of validation is a violation.

--- FILE TO REVIEW ---
**File Name:** `{file_name}`
```typescript
{file_content}
```

--- YOUR TASK ---
Review the code against the checklist. Respond with ONLY a valid JSON object conforming to the following schema.
- If the code passes all checks, return `{{"status": "passed", "errors": []}}`.
- If the code fails any check, return `{{"status": "failed", "errors": ["A clear, one-sentence description of the violation."]}}`. List all violations you find.

--- OUTPUT SCHEMA ---
```json
{output_schema}
```
"""

def main():
    try:
        inbound_data = json.loads(sys.stdin.read())
        file_name = inbound_data.get("fileName")
        code = inbound_data.get("code")

        if not file_name or not code:
            raise ValueError("Input must contain 'fileName' and 'code'.")

        print_to_stderr(f"Reviewing file: {file_name}")
        prompt = create_review_prompt(file_name, code)
        model = get_gemini_model()
        response = model.generate_content(prompt)

        parsed_json = json.loads(response.text)
        validated_data = ReviewResult.model_validate(parsed_json)
        
        final_output = {
            "status": "REVIEW_COMPLETE",
            "reviewResult": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except Exception as e:
        error_output = { "status": "ARCHITECT_AGENT_FAILED", "error": str(e), "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
