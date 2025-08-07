# =================================================================================
# File:         agents/ui_spec_agent.py
# Version:      4.0 (Mosaic 4.0 - Advanced UI)
#
# Purpose:      This agent generates a single, detailed UI specification with
#               dynamic and responsive capabilities.
#
# V4.0 Change:  - Enhanced UiComponent to include `renderIf` for conditional
#                 rendering and `repeatFor` for data-driven looping.
#               - Updated prompt to guide the agent to first define reusable
#                 components (e.g., AppLayout, DataTable) and then compose
#                 pages from them, promoting a DRY UI architecture.
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

class UiComponent(BaseModel):
    component: str = Field(..., description="The type of component, e.g., 'Page', 'DataTable', 'AppLayout'.")
    description: str = Field(..., description="A description of this component's purpose.")
    layout: Optional[Dict[str, Any]] = Field(default={}, description="Responsive layout properties, e.g., {'mobile': {...}, 'desktop': {...}}.")
    props: Optional[Dict[str, Any]] = Field(default={}, description="Component properties. Use {data.field} for data binding.")
    content: Optional[str] = Field(default=None, description="Text content. Use {data.field} for data binding.")
    children: Optional[List['UiComponent']] = Field(default=[])
    eventTrigger: Optional[str] = Field(default=None, description="An event this component can trigger.")
    renderIf: Optional[str] = Field(default=None, description="A condition for conditional rendering, e.g., '{user.isAdmin}'.")
    repeatFor: Optional[str] = Field(default=None, description="Defines data-driven looping, e.g., 'product in products'.")

UiComponent.model_rebuild()

class UiSpec(BaseModel):
    id: str = Field(..., description="A unique identifier for the UI specification.")
    spec: UiComponent = Field(..., description="The root component of the page's UI hierarchy.")

class UiSpecOutput(UiSpec):
    pass

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (ui_spec_agent): {message}\n")
    sys.stdout.flush()

def get_gemini_model() -> genai.GenerativeModel:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-pro-latest")

def create_system_prompt(srs: Dict[str, Any], page_id: str, page_description: str) -> str:
    srs_json_string = json.dumps(srs, indent=2)
    output_schema_string = json.dumps(UiSpecOutput.model_json_schema(), indent=2)

    return f"""
You are a Senior UI/UX Architect specializing in component-based design systems. Your task is to translate a Software Requirements Specification (SRS) into a detailed, hierarchical UI specification for a SINGLE page.

--- INPUT: Software Requirements Specification (SRS) ---
```json
{srs_json_string}
```

--- YOUR FOCUSED TASK ---
- **Page ID:** `{page_id}`
- **Page Description:** `{page_description}`

--- INSTRUCTIONS ---
1.  **Component-First Design**: First, think about common, reusable components that might be needed (e.g., `AppLayout`, `DataTable`, `ModalDialog`). Then, compose the page-level spec by referencing these components.
2.  **Responsive Layout**: Use the `layout` property to define responsive styles for different breakpoints (e.g., `{{"mobile": {{"flexDirection": "column"}}, "desktop": {{"flexDirection": "row"}}}}`).
3.  **Conditional Rendering**: Use the `renderIf` property to specify conditions under which a component should be displayed (e.g., `renderIf: "{{user.isAdmin}}"`).
4.  **Data-Driven Looping**: For lists of items, use the `repeatFor` property to explicitly define the data source and item variable for the loop (e.g., `repeatFor: "product in products"`).
5.  **CRUCIAL CHECK**: Your output MUST be a perfectly valid JSON object conforming to the schema.

--- OUTPUT: Your Final JSON Schema (Adhere to this STRICTLY) ---
```json
{output_schema_string}
```
"""

def create_contextual_fixer_prompt(srs: Dict[str, Any], page_id: str, page_description: str, invalid_json: str, error: str) -> str:
    original_prompt = create_system_prompt(srs, page_id, page_description)
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
        page_id = inbound_data.get("pageId")
        page_description = inbound_data.get("pageDescription")

        if not all([srs, page_id, page_description]):
            raise ValueError("Input must contain 'validatedRequirements', 'pageId', and 'pageDescription'.")

        print_to_stderr(f"Initializing UI Spec Agent (v4.0) for page: {page_id}...")
        
        validated_data = None
        response_text = ""
        last_error = ""
        max_retries = 3
        
        prompt = create_system_prompt(srs, page_id, page_description)

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    prompt = create_contextual_fixer_prompt(srs, page_id, page_description, response_text, last_error)
                
                print_to_stderr(f"Calling Gemini for UI spec: {page_id} (Attempt {attempt + 1})...")
                model = get_gemini_model()
                response = model.generate_content(prompt)
                
                response_text = response.text.strip().replace("```json", "").replace("```", "")
                
                parsed_json = json.loads(response_text)
                validated_data = UiSpecOutput.model_validate(parsed_json)
                print_to_stderr(f"UI spec for {page_id} parsed and validated successfully on attempt {attempt + 1}.")
                break

            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                print_to_stderr(f"Attempt {attempt + 1} failed for page {page_id}: {last_error}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                else:
                    raise e

        if validated_data is None:
            raise RuntimeError(f"Failed to generate and validate UI spec JSON for {page_id} after multiple retries.")

        final_output = {
            "status": "UI_SPEC_GENERATED",
            "uiSpec": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except (ValidationError, json.JSONDecodeError, RuntimeError) as e:
        error_output = { "status": "UI_SPEC_AGENT_FAILED", "error": f"Failed after multiple retries for page {page_id}: {e}", "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = { "status": "UI_SPEC_AGENT_FAILED", "error": str(e), "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
