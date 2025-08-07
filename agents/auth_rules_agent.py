# =================================================================================
# File:         agents/auth_rules_agent.py
# Version:      3.8 (Mosaic 3.0 - Context-Aware Self-Correction)
#
# Purpose:      This agent generates the `auth_rules.json` specification.
#
# V3.8 Change:  - Implemented a context-aware self-correction mechanism.
#               - The "fixer" prompt now includes the full original context
#                 (SRS, APIs, etc.) along with the error message.
# =================================================================================

import sys
import json
import os
import traceback
from typing import List, Dict, Any
import time

try:
    from pydantic import BaseModel, Field, ValidationError
    import google.generativeai as genai
    from dotenv import load_dotenv
except ImportError as e:
    sys.stderr.write(f"IMPORT ERROR: A required library is not installed. Please run 'pip install -r requirements.txt'. Details: {e}\n")
    sys.exit(1)

load_dotenv()

# --- Pydantic Schemas for Input and Output ---

class AuthRule(BaseModel):
    role: str
    canAccessPages: List[str] = Field(..., description="A list of page IDs the role can access.")
    canCallApis: List[str] = Field(..., description="A list of API IDs the role can call.")

class AuthRulesOutput(BaseModel):
    roles: List[str]
    rules: List[AuthRule] = Field(..., min_length=1)

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (auth_rules_agent): {message}\n")
    sys.stdout.flush()

def get_gemini_model(is_json_output: bool = True) -> genai.GenerativeModel:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    
    generation_config = {"response_mime_type": "application/json"} if is_json_output else None
    
    return genai.GenerativeModel(
        "gemini-1.5-pro-latest",
        generation_config=generation_config
    )

def create_system_prompt(srs: Dict[str, Any], api_specs: Dict[str, Any], req_index: Dict[str, Any]) -> str:
    srs_json_string = json.dumps(srs, indent=2)
    api_specs_string = json.dumps(api_specs, indent=2)
    req_index_string = json.dumps(req_index, indent=2)
    output_schema_string = json.dumps(AuthRulesOutput.model_json_schema(), indent=2)

    return f"""
You are a meticulous Security and Systems Architect specializing in Role-Based Access Control (RBAC).

--- INPUT 1: Software Requirements Specification (SRS) ---
```json
{srs_json_string}
```

--- INPUT 2: API Specifications ---
```json
{api_specs_string}
```

--- INPUT 3: Requirement (Page) Index ---
```json
{req_index_string}
```

--- INSTRUCTIONS ---
1.  **Identify Roles**: Extract all roles from SRS `personas` and add a `Public` role.
2.  **Map Page Access**: For each role, iterate through `requirement_index` and decide access.
3.  **Map API Access**: For each role, iterate through `backend_apis` and decide access.
4.  **CRUCIAL CHECK**: Your output MUST be a perfectly valid JSON object conforming to the schema.

--- OUTPUT: Your Final JSON Schema (Adhere to this STRICTLY) ---
```json
{output_schema_string}
```
"""

def create_contextual_fixer_prompt(srs: Dict[str, Any], api_specs: Dict[str, Any], req_index: Dict[str, Any], invalid_json: str, error: str) -> str:
    original_prompt = create_system_prompt(srs, api_specs, req_index)
    
    return f"""
You previously attempted to generate a JSON object based on the following instructions, but it failed with an error.

--- ORIGINAL INSTRUCTIONS ---
{original_prompt}

--- YOUR PREVIOUS FAILED OUTPUT ---
```json
{invalid_json}
```

--- VALIDATION ERROR ---
{error}

--- YOUR CORRECTED TASK ---
Please re-generate the entire JSON object from scratch, ensuring you fix the validation error while strictly adhering to all original instructions and the JSON schema. Return only the single, valid JSON object.
"""

# --- Main Agent Logic ---
def main():
    try:
        inbound_data = json.loads(sys.stdin.read())
        srs = inbound_data.get("validatedRequirements")
        api_specs = inbound_data.get("backendApis")
        req_index = inbound_data.get("requirementIndex")
        if not srs or not api_specs or not req_index:
            raise ValueError("Input must contain 'validatedRequirements', 'backendApis', and 'requirementIndex'.")

        print_to_stderr("Initializing Auth Rules Agent (v3.8)...")
        
        validated_data = None
        response_text = ""
        last_error = ""
        max_retries = 3
        
        prompt = create_system_prompt(srs, api_specs, req_index)

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    prompt = create_contextual_fixer_prompt(srs, api_specs, req_index, response_text, last_error)
                
                print_to_stderr(f"Calling Gemini to generate auth rules (Attempt {attempt + 1})...")
                model = get_gemini_model(is_json_output=False)
                response = model.generate_content(prompt)
                
                response_text = response.text.strip().replace("```json", "").replace("```", "")
                
                parsed_json = json.loads(response_text)
                validated_data = AuthRulesOutput.model_validate(parsed_json)
                print_to_stderr(f"Auth rules parsed and validated successfully on attempt {attempt + 1}.")
                break

            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                print_to_stderr(f"Attempt {attempt + 1} failed: {last_error}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                else:
                    raise e

        if validated_data is None:
            raise RuntimeError("Failed to generate and validate auth rules JSON after multiple retries.")

        print_to_stderr("Elaborate auth rules generated and validated successfully.")

        final_output = {
            "status": "AUTH_RULES_GENERATED",
            "authRules": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except (ValidationError, json.JSONDecodeError, RuntimeError) as e:
        error_output = { "status": "AUTH_RULES_AGENT_FAILED", "error": f"Failed after multiple retries: {e}", "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = { "status": "AUTH_RULES_AGENT_FAILED", "error": str(e), "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
