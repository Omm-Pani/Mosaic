# =================================================================================
# File:         agents/work_graph_agent.py
# Version:      6.0 (Mosaic 2.0 - With Review Step)
#
# Purpose:      This agent constructs the complete `work_graph.json` DAG.
#
# V6.0 Change:  - Integrated a new, mandatory "review" step for every generated
#                 code file.
#               - After each `generate-*` task, a corresponding `review-*` task
#                 is now added, which will be handled by the new architect.agent.
#               - The final `run-tests` task now depends on the successful
#                 completion of all review tasks.
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
class WorkGraphNode(BaseModel):
    id: str
    task: str
    description: str
    dependsOn: List[str]

class WorkGraphOutput(BaseModel):
    nodes: List[WorkGraphNode]

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (work_graph_agent): {message}\n")
    sys.stdout.flush()

def get_gemini_model() -> genai.GenerativeModel:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-pro-latest")

def create_system_prompt(build_plan: Dict[str, Any]) -> str:
    # This function is now simplified as the logic is handled programmatically.
    return "Generate the work graph based on the build plan."

def main():
    try:
        inbound_data = json.loads(sys.stdin.read())
        build_plan = inbound_data.get("buildPlan")
        if not build_plan:
            raise ValueError("Input must contain the full 'buildPlan' object.")

        print_to_stderr("Initializing Work Graph Agent (v6.0 - With Review Step)...")
        
        nodes = []
        
        # Phase 1: Environment & Foundational Code
        nodes.append({"id": "start-vm", "task": "start-vm", "description": "Start the development VM.", "dependsOn": []})
        nodes.append({"id": "lib/types.ts", "task": "generate-types", "description": "Generate TypeScript types.", "dependsOn": []})
        
        # Phase 2: Dependent Code Generation & Review
        review_tasks = []

        # Data Layer
        nodes.append({"id": "lib/data.ts", "task": "generate-data-layer", "description": "Generate the data access layer.", "dependsOn": ["lib/types.ts"]})
        
        # Generate and Review API Routes
        for api in build_plan.get("backendApis", {}).get("apis", []):
            file_path = api['path'].replace('/api/', 'app/api/') + '/route.ts'
            file_path = file_path.replace('{', '[').replace('}', ']')
            
            gen_id = f"generate:{file_path}"
            review_id = f"review:{file_path}"
            
            nodes.append({"id": gen_id, "task": "generate-api-route", "description": f"Generate API route for {api['id']}", "dependsOn": ["start-vm", "lib/data.ts"]})
            nodes.append({"id": review_id, "task": "review-code", "description": f"Review architecture of {file_path}", "dependsOn": [gen_id]})
            review_tasks.append(review_id)
            
        # Generate and Review Frontend Pages
        for page in build_plan.get("requirementIndex", {}).get("pages", []):
            file_path = page['path']
            
            gen_id = f"generate:{file_path}"
            review_id = f"review:{file_path}"

            nodes.append({"id": gen_id, "task": "generate-frontend-page", "description": f"Generate frontend page for {page['id']}", "dependsOn": ["start-vm", "lib/types.ts"]})
            nodes.append({"id": review_id, "task": "review-code", "description": f"Review architecture of {file_path}", "dependsOn": [gen_id]})
            review_tasks.append(review_id)
            
        # Phase 3: Final Testing
        nodes.append({"id": "run-tests", "task": "run-tests", "description": "Run integration and smoke tests.", "dependsOn": review_tasks})
        
        # Validate with Pydantic
        validated_data = WorkGraphOutput(nodes=nodes)

        print_to_stderr("Architectural review graph generated successfully.")

        final_output = {
            "status": "WORK_GRAPH_GENERATED",
            "workGraph": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except Exception as e:
        error_output = { "status": "WORK_GRAPH_AGENT_FAILED", "error": str(e), "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
