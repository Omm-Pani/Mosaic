# =================================================================================
# File:         agents/api_spec_agent.py
# Version:      4.1 (Mosaic 4.0 - Explicit Prompt)
#
# Purpose:      This agent generates a single, detailed API endpoint contract
#               with developer-friendly features.
#
# V4.1 Change:  - Corrected the system prompt to be more direct and explicit,
#                 instructing the LLM to generate a JSON object conforming to the
#                 schema, not the schema itself. This resolves the Pydantic
#                 validation error.
# =================================================================================

import sys
import json
import os
import traceback
from typing import List, Dict, Any, Optional
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

class AuthInfo(BaseModel):
    required: bool = Field(..., description="Whether the endpoint requires authentication.")
    allowedRoles: Optional[List[str]] = Field(default=None, description="A list of roles allowed to access this endpoint.")

class PathParam(BaseModel):
    type: str = Field(..., description="The data type of the path parameter (e.g., 'uuid', 'string').")
    description: str = Field(..., description="A description of the parameter.")

class ApiResponse(BaseModel):
    statusCode: int = Field(..., description="The HTTP status code for this response.")
    description: str = Field(..., description="A description of what this response indicates.")
    schema: Dict[str, Any] = Field(default={}, description="The JSON schema for the response body.")

class BackendApi(BaseModel):
    id: str = Field(..., description="A unique identifier for the API in snake_case.")
    method: str = Field(..., description="The HTTP method (e.g., 'GET', 'POST', 'PUT', 'DELETE').")
    path: str = Field(..., description="The API route path, using colon syntax for parameters, e.g., '/api/projects/:id'.")
    description: str = Field(..., description="A detailed description of the endpoint's purpose.")
    auth: AuthInfo
    pathParams: Optional[Dict[str, PathParam]] = Field(default=None, description="Definitions for parameters in the URL path.")
    queryParams: Optional[Dict[str, Any]] = Field(default=None, description="The JSON schema for query parameters.")
    requestBody: Optional[Dict[str, Any]] = Field(default=None, description="The JSON schema for the request body.")
    successResponse: ApiResponse
    errorResponses: List[ApiResponse]

class BackendApiOutput(BackendApi):
    pass

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (api_spec_agent): {message}\n")
    sys.stdout.flush()

def get_gemini_model() -> genai.GenerativeModel:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-pro-latest")

def create_system_prompt(srs: Dict[str, Any], data_models: Dict[str, Any], api_details: Dict[str, str]) -> str:
    srs_json_string = json.dumps(srs, indent=2)
    models_json_string = json.dumps(data_models, indent=2)
    output_schema_string = json.dumps(BackendApiOutput.model_json_schema(), indent=2)

    return f"""
You are a top-tier API Architect. Your task is to design a complete and developer-friendly specification for a SINGLE API endpoint. Your output MUST be a single, valid JSON object that strictly adheres to the JSON Schema provided.

--- CONTEXT: Software Requirements Specification (SRS) ---
```json
{srs_json_string}
```

--- CONTEXT: Data Models ---
```json
{models_json_string}
```

--- YOUR FOCUSED TASK ---
- **API ID:** `{api_details['id']}`
- **HTTP Method:** `{api_details['method']}`
- **Path:** `{api_details['path']}`
- **Description:** `{api_details['description']}`

--- INSTRUCTIONS ---
1.  **Standardized Errors**: All error responses MUST use a standardized schema: `{{"error": {{"code": "ERROR_CODE", "message": "Error message."}}}}`.
2.  **Explicit Data Model References**: In `requestBody` and `successResponse` schemas, you MUST use `$ref` to point to the data models defined in the context (e.g., `{{"$ref": "#/definitions/Project"}}`). This ensures consistency.
3.  **Define Path Parameters**: If the `path` contains a parameter (e.g., `/api/projects/:id`), you MUST define it in the `pathParams` object with its type and description.
4.  **RPC-Style Actions**: For actions that are not simple CRUD operations (e.g., publishing a draft), design an RPC-style endpoint like `POST /api/posts/:id/publish`.
5.  **CRUCIAL CHECK**: Your output MUST be a perfectly valid JSON object conforming to the schema.

--- REQUIRED OUTPUT JSON SCHEMA (BackendApiOutput) ---
```json
{output_schema_string}
```
GENERATE THE API SPECIFICATION JSON OBJECT NOW.
"""

def create_contextual_fixer_prompt(srs: Dict[str, Any], data_models: Dict[str, Any], api_details: Dict[str, str], invalid_json: str, error: str) -> str:
    original_prompt = create_system_prompt(srs, data_models, api_details)
    return f"""
You previously attempted to generate a JSON object but it failed with an error.

--- ORIGINAL INSTRUCTIONS ---
{original_prompt}

--- YOUR PREVIOUS FAILED OUTPUT ---
```json
{invalid_json}
```

--- VALIDATION ERROR ---
{error}

--- YOUR CORRECTED TASK ---
Please re-generate the entire JSON object from scratch, fixing the validation error while strictly adhering to all original instructions and the JSON schema. Return only the single, valid JSON object.
"""

# --- Main Agent Logic ---
def main():
    try:
        inbound_data = json.loads(sys.stdin.read())
        srs = inbound_data.get("validatedRequirements")
        data_models = inbound_data.get("dataModels")
        api_details = inbound_data.get("apiDetails")

        if not all([srs, data_models, api_details]):
            raise ValueError("Input must contain 'validatedRequirements', 'dataModels', and 'apiDetails'.")

        print_to_stderr(f"Initializing API Spec Agent (v4.1) for API: {api_details.get('id')}...")
        
        validated_data = None
        response_text = ""
        last_error = ""
        max_retries = 3
        
        prompt = create_system_prompt(srs, data_models, api_details)

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    prompt = create_contextual_fixer_prompt(srs, data_models, api_details, response_text, last_error)
                
                print_to_stderr(f"Calling Gemini for API: {api_details.get('id')} (Attempt {attempt + 1})...")
                model = get_gemini_model()
                response = model.generate_content(prompt)
                
                response_text = response.text.strip().replace("```json", "").replace("```", "")
                
                parsed_json = json.loads(response_text)
                validated_data = BackendApiOutput.model_validate(parsed_json)
                print_to_stderr(f"API spec for {api_details.get('id')} parsed and validated successfully on attempt {attempt + 1}.")
                break

            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                print_to_stderr(f"Attempt {attempt + 1} failed for API {api_details.get('id')}: {last_error}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                else:
                    raise e

        if validated_data is None:
            raise RuntimeError(f"Failed to generate and validate API spec JSON for {api_details.get('id')} after multiple retries.")

        final_output = {
            "status": "API_SPEC_GENERATED",
            "apiSpec": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except (ValidationError, json.JSONDecodeError, RuntimeError) as e:
        error_output = { "status": "API_SPEC_AGENT_FAILED", "error": f"Failed after multiple retries for API {api_details.get('id')}: {e}", "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = { "status": "API_SPEC_AGENT_FAILED", "error": str(e), "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()