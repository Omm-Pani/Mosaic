# =================================================================================
# File:         agents/requirement_index_agent.py
# Version:      1.5 (Mosaic 4.0 - Filesystem Aware)
#
# Purpose:      This agent links all previously generated specs into the master
#               `requirement_index.json` file.
#
# V1.5 Change:  - CRITICAL FIX: Re-architected the prompt to be a direct,
#                 algorithmic set of rules for converting URL routes into valid
#                 Next.js App Router file paths. This is a more robust approach
#                 to prevent the generation of invalid paths like `/products/:id`.
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

class RequirementPage(BaseModel):
    id: str = Field(..., description="Unique identifier for the page, e.g., 'LoginPage'.")
    path: str = Field(..., description="The Next.js file system path for the page, e.g., 'app/login/page.tsx'.")
    description: str = Field(..., description="A brief description of the page's purpose.")
    uiSpecId: str = Field(..., description="The ID of the UI spec used by this page.")
    flowIds: List[str] = Field(..., description="A list of interaction flow IDs relevant to this page.")
    apiIds: List[str] = Field(..., description="A list of API IDs called by this page.")
    dataBindings: List[str] = Field(..., description="A list of data model names used by this page.")

class RequirementIndexOutput(BaseModel):
    pages: List[RequirementPage]

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (requirement_index_agent): {message}\n")
    sys.stdout.flush()

def get_gemini_model() -> genai.GenerativeModel:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-pro-latest")

def create_system_prompt(srs: Dict[str, Any], ui_specs: Dict[str, Any], api_specs: Dict[str, Any], interaction_flows: Dict[str, Any]) -> str:
    srs_json_string = json.dumps(srs, indent=2)
    ui_specs_string = json.dumps(ui_specs, indent=2)
    api_specs_string = json.dumps(api_specs, indent=2)
    flows_string = json.dumps(interaction_flows, indent=2)
    output_schema_string = json.dumps(RequirementIndexOutput.model_json_schema(), indent=2)

    return f"""
You are an expert Systems Integrator for a Next.js application. Your critical task is to create a master index that links all system components together using valid file system paths.

--- CONTEXT ---
- SRS: {srs_json_string}
- UI Specs: {ui_specs_string}
- API Specs: {api_specs_string}
- Interaction Flows: {flows_string}

--- INSTRUCTIONS ---
1.  For each screen in the SRS, create a corresponding page object.
2.  **Generate Correct File Paths**: You MUST generate a valid Next.js App Router file system path in the `path` field by following these rules STRICTLY:
    - **Rule 1 (Root):** The root URL `/` MUST be converted to the file path `app/page.tsx`.
    - **Rule 2 (Static):** A static URL like `/about` MUST be converted to `app/about/page.tsx`.
    - **Rule 3 (Dynamic):** A dynamic URL like `/products/:id` MUST be converted to `app/products/[id]/page.tsx`.
    - **Rule 4 (Nested):** A nested URL like `/admin/inventory` MUST be converted to `app/admin/inventory/page.tsx`.
3.  **Link Specifications**:
    - Map the page to its `uiSpecId`.
    - Populate `flowIds` by analyzing which interaction flows are relevant to the page.
    - Link all relevant `apiIds` and `dataBindings`.
4.  **CRUCIAL CHECK**: Your output MUST be a perfectly valid JSON object conforming to the schema. The `path` fields are the most critical part.

--- OUTPUT: JSON Schema for RequirementIndexOutput ---
```json
{output_schema_string}
```
"""

def create_contextual_fixer_prompt(srs: Dict[str, Any], ui_specs: Dict[str, Any], api_specs: Dict[str, Any], interaction_flows: Dict[str, Any], invalid_json: str, error: str) -> str:
    original_prompt = create_system_prompt(srs, ui_specs, api_specs, interaction_flows)
    
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
Please re-generate the entire JSON object from scratch, ensuring you fix the validation error while strictly adhering to all original instructions and the JSON schema. Pay close attention to generating correct Next.js file paths. Return only the single, valid JSON object.
"""

# --- Main Agent Logic ---
def main():
    try:
        inbound_data = json.loads(sys.stdin.read())
        srs = inbound_data.get("validatedRequirements")
        ui_specs = inbound_data.get("uiSpecs")
        api_specs = inbound_data.get("backendApis")
        interaction_flows = inbound_data.get("interactionFlows")
        
        if not all([srs, ui_specs, api_specs, interaction_flows]):
            raise ValueError("Input must contain 'validatedRequirements', 'uiSpecs', 'backendApis', and 'interactionFlows'.")

        print_to_stderr("Initializing Requirement Index Agent (v1.5)...")
        
        validated_data = None
        response_text = ""
        last_error = ""
        max_retries = 3
        
        prompt = create_system_prompt(srs, ui_specs, api_specs, interaction_flows)

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    prompt = create_contextual_fixer_prompt(srs, ui_specs, api_specs, interaction_flows, response_text, last_error)
                
                print_to_stderr(f"Calling Gemini to generate requirement index (Attempt {attempt + 1})...")
                model = get_gemini_model()
                response = model.generate_content(prompt)
                
                response_text = response.text.strip().replace("```json", "").replace("```", "")
                
                parsed_json = json.loads(response_text)
                validated_data = RequirementIndexOutput.model_validate(parsed_json)
                print_to_stderr(f"Requirement index parsed and validated successfully on attempt {attempt + 1}.")
                break

            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                print_to_stderr(f"Attempt {attempt + 1} failed: {last_error}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                else:
                    raise e

        if validated_data is None:
            raise RuntimeError("Failed to generate and validate requirement index JSON after multiple retries.")

        final_output = {
            "status": "REQUIREMENT_INDEX_GENERATED",
            "requirementIndex": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except (ValidationError, json.JSONDecodeError, RuntimeError) as e:
        error_output = { "status": "REQUIREMENT_INDEX_AGENT_FAILED", "error": f"Failed after multiple retries: {e}", "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = { "status": "REQUIREMENT_INDEX_AGENT_FAILED", "error": str(e), "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
