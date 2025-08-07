# =================================================================================
# File:         agents/planner_agent.py
# Version:      2.3 (Mosaic 2.0)
#
# Purpose:      This agent is the primary "Master Planner" for Mosaic 2.0.
#
# V2.3 Change:  - CRITICAL FIX: Updated the prompt instructions for generating
#                 the `requirement_index.json`. The agent is now explicitly
#                 told to include the `uiSpecId` field for each page object.
#                 This resolves the Pydantic "Field required" validation error.
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

# =================================================================================
# --- Pydantic Schemas for Mosaic 2.0 Build Plan ---
# =================================================================================

# Represents requirement_index.json
class RequirementIndex(BaseModel):
    pages: List[Dict[str, Any]] = Field(..., description="Links all screens, flows, APIs, and specs.")

# Represents ui_specs.json
class UiSpecs(BaseModel):
    uiSpecs: List[Dict[str, Any]] = Field(..., description="Figma-style reusable layouts (fields, buttons, triggers).")

# Represents interaction_flows.json
class InteractionFlows(BaseModel):
    flows: List[Dict[str, Any]] = Field(..., description="Defines application logic: trigger -> action -> result.")

# Represents backend_apis.json
class BackendApis(BaseModel):
    apis: List[Dict[str, Any]] = Field(..., description="Defines API contracts with method, path, input/output, and auth rules.")

# Represents data_models.json
class DataModels(BaseModel):
    models: List[Dict[str, Any]] = Field(..., description="ORM-like schema declarations for database models.")

# Represents auth_rules.json
class AuthRules(BaseModel):
    roles: List[str]
    rules: List[Dict[str, Any]] = Field(..., description="Role-based access control matrix for pages and APIs.")

# Represents work_graph.json
class WorkGraphNode(BaseModel):
    id: str = Field(..., description="The file path or unique identifier of the node.")
    task: str = Field(..., description="The worker task to execute, e.g., 'generate-types'.")
    description: str = Field(..., description="A brief description of what this node accomplishes.")
    dependsOn: List[str] = Field(..., description="A list of node IDs that must be completed before this node can start.")

class WorkGraph(BaseModel):
    nodes: List[WorkGraphNode] = Field(..., description="The Directed Acyclic Graph (DAG) of all tasks.")

# The master output schema for this agent
class BuildPlanV2(BaseModel):
    requirement_index: RequirementIndex
    ui_specs: UiSpecs
    interaction_flows: InteractionFlows
    backend_apis: BackendApis
    data_models: DataModels
    auth_rules: AuthRules
    work_graph: WorkGraph

# =================================================================================
# --- Helper Functions ---
# =================================================================================

def print_to_stdout(data: Dict[str, Any]):
    """Prints a dictionary as a JSON string to standard output."""
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    """Prints a debug message to standard error."""
    sys.stderr.write(f"DEBUG (planner_agent_v2): {message}\n")
    sys.stderr.flush()

def get_gemini_model() -> genai.GenerativeModel:
    """Initializes and returns the Gemini Pro model client."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(
        "gemini-1.5-pro-latest",
        generation_config={"response_mime_type": "application/json"}
    )

def create_system_prompt(srs: Dict[str, Any]) -> str:
    """Creates the detailed system prompt for the Gemini LLM."""
    srs_json_string = json.dumps(srs, indent=2)
    plan_schema_string = json.dumps(BuildPlanV2.model_json_schema(), indent=2)

    return f"""
You are the "Mosaic 2.0 Master Planner," an expert system architect. Your task is to convert a high-level
Software Requirements Specification (SRS) into a complete, structured, and modular build plan.

Your output MUST be a single, valid JSON object that strictly adheres to the provided `BuildPlanV2` JSON Schema.

--- INPUT: Software Requirements Specification (SRS) ---
```json
{srs_json_string}
```

--- INSTRUCTIONS & SCHEMA ENFORCEMENT ---
1.  **Decompose the SRS**: Analyze the user stories, personas, and screens in the SRS. Decompose this information into the six modular specification files.
2.  **Strict Field Names**: You MUST use the exact field names as defined in the schema.
    -   For `requirement_index.pages`, each page object MUST have `id`, `path`, and `uiSpecId`. The `path` MUST be a file system path (e.g., `app/dashboard/page.tsx`).
    -   For `ui_specs.uiSpecs`, each spec object MUST have an `id`.
    -   For `backend_apis.apis`, each api object MUST have `id`, `method`, and a URL-style `path` (e.g., `/api/users`, NOT a file path like `app/api/users/route.ts`).
    -   For `work_graph.nodes`, each node object MUST have `id`, `task`, `description`, and `dependsOn`.
3.  **Generate the `work_graph.json`**: Create a Directed Acyclic Graph (DAG) of all the files that need to be generated.
    -   **Dependencies (`dependsOn`)**:
        -   `lib/types.ts` (task: `generate-types`) must have no dependencies.
        -   `lib/data.ts` (task: `generate-data-layer`) must depend on `lib/types.ts`.
        -   All backend API routes (e.g., `app/api/users/route.ts`) must depend on `lib/data.ts`.
        -   All frontend pages (e.g., `app/dashboard/page.tsx`) must depend on `lib/types.ts`.
        -   Prioritize the **HomePage** (`app/page.tsx`) by giving it the fewest dependencies possible.
    -   **Tasks (`task`)**: Assign a worker task name for each file type (e.g., `generate-types`, `generate-data-layer`, `generate-api-route`, `generate-frontend-page`).
4.  **Adhere to the Schema**: The final JSON object you return must contain all seven top-level keys and be perfectly valid against the schema below.

--- OUTPUT: JSON Schema for BuildPlanV2 ---
```json
{plan_schema_string}
```

Generate the complete `BuildPlanV2` JSON object now, strictly following the field name requirements.
"""

# =================================================================================
# --- Main Agent Logic ---
# =================================================================================

def main():
    """Main execution function for the agent."""
    try:
        inbound_data = json.loads(sys.stdin.read())
        srs = inbound_data.get("validatedRequirements")
        if not srs:
            raise ValueError("Input JSON must contain 'validatedRequirements' from the analyst_agent.")

        print_to_stderr("Initializing Mosaic 2.0 Master Planner...")
        model = get_gemini_model()
        prompt = create_system_prompt(srs)

        print_to_stderr("Calling Gemini to generate the full build plan and work graph...")
        response = model.generate_content(prompt)

        response_text = response.text.strip().replace("```json", "").replace("```", "")
        parsed_json = json.loads(response_text)

        print_to_stderr("Validating the generated build plan against the Pydantic schema...")
        validated_plan = BuildPlanV2.model_validate(parsed_json)

        print_to_stderr("Mosaic 2.0 Build Plan and Work Graph generated and validated successfully.")

        final_output = {
            "status": "PLAN_GENERATED_V2",
            "buildPlan": validated_plan.model_dump()
        }
        print_to_stdout(final_output)

    except (ValidationError, json.JSONDecodeError) as e:
        error_output = {
            "status": "PLANNER_AGENT_FAILED",
            "error": f"Failed to validate the LLM's JSON structure: {e}",
            "traceback": traceback.format_exc()
        }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = {
            "status": "PLANNER_AGENT_FAILED",
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
