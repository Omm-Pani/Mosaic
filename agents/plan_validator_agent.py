# =================================================================================
# File:         agents/plan_validator_agent.py
# Version:      4.2 (Mosaic 4.0 - Corrected & Resilient)
#
# Purpose:      This agent acts as a "Spec Enforcer" and "Consistency Checker".
#
# V4.2 Change:  - CRITICAL FIX: The validation logic now correctly uses the
#                 `uiSpecId` field from the requirement index pages, rather than
#                 incorrectly deriving it from the page ID. This makes the
#                validator more robust and resilient to naming inconsistencies.
# =================================================================================

import sys
import json
import os
import traceback
from typing import List, Dict, Any

try:
    from pydantic import BaseModel, Field, ValidationError
except ImportError as e:
    sys.stderr.write(f"IMPORT ERROR: A required library is not installed. Please run 'pip install -r requirements.txt'. Details: {e}\n")
    sys.exit(1)

# --- Pydantic Schemas for Input Validation ---

class RequirementPage(BaseModel):
    id: str
    path: str
    uiSpecId: str
    apiIds: List[str] = Field(default=[])

class RequirementIndex(BaseModel):
    pages: List[RequirementPage]

class WorkGraphNode(BaseModel):
    id: str
    task: str
    description: str
    dependsOn: List[str]

class WorkGraph(BaseModel):
    nodes: List[WorkGraphNode]

class UiSpec(BaseModel):
    id: str
    spec: Dict[str, Any]

class UiSpecs(BaseModel):
    uiSpecs: List[UiSpec]

class BackendApi(BaseModel):
    id: str
    path: str

class BackendApis(BaseModel):
    apis: List[BackendApi]

class DataModel(BaseModel):
    name: str
    fields: Dict[str, Any]

class DataModels(BaseModel):
    models: List[DataModel]

class AuthRule(BaseModel):
    role: str
    canAccessPages: List[str]
    canCallApis: List[str]

class AuthRules(BaseModel):
    roles: List[str]
    rules: List[AuthRule]

class InteractionFlow(BaseModel):
    id: str
    startState: str
    states: Dict[str, Any]

class InteractionFlows(BaseModel):
    flows: List[InteractionFlow]

class BuildPlanInput(BaseModel):
    requirementIndex: RequirementIndex
    workGraph: WorkGraph
    uiSpecs: UiSpecs
    backendApis: BackendApis
    dataModels: DataModels
    authRules: AuthRules
    interactionFlows: InteractionFlows


# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (plan_validator): {message}\n")
    sys.stdout.flush()

# --- Main Validation Logic ---
def main():
    """Main execution function for the agent."""
    try:
        inbound_data = json.loads(sys.stdin.read())
        
        # The inbound data is the plan itself.
        raw_plan = inbound_data

        if not raw_plan:
            raise ValueError("Input plan cannot be empty.")

        print_to_stderr("Validating build plan structure with Pydantic...")
        # The Pydantic model now expects the exact structure of buildPlan
        plan = BuildPlanInput.model_validate(raw_plan)
        print_to_stderr("Build plan structure is valid.")

        errors = []
        warnings = []

        req_index = plan.requirementIndex.pages
        ui_specs = plan.uiSpecs.uiSpecs
        backend_apis = plan.backendApis.apis

        ui_spec_ids = {spec.id for spec in ui_specs}
        api_ids = {api.id for api in backend_apis}

        # 1. Validate that every page's uiSpecId points to a real UI spec.
        for page in req_index:
            # FIX: Use the explicit uiSpecId from the requirement index for validation.
            expected_ui_spec_id = page.uiSpecId
            if expected_ui_spec_id not in ui_spec_ids:
                errors.append(f"UI Spec Violation: Page '{page.id}' requires a UI spec with id '{expected_ui_spec_id}', which was not found.")

        # 2. Validate that every page's apiIds point to real APIs.
        for page in req_index:
            for api_id in page.apiIds:
                if api_id not in api_ids:
                     errors.append(f"API Spec Violation: Page '{page.id}' refers to a non-existent apiId: '{api_id}'.")

        # 3. Inject mandatory health check endpoint if it doesn't exist.
        health_check_path = '/api/health'
        if not any(api.path == health_check_path for api in backend_apis):
            warnings.append("Injecting missing system health check API.")
            raw_plan['backendApis']['apis'].append({
                "id": "api_health_check", "method": "GET", "path": health_check_path,
                "description": "System-injected health check endpoint.",
                "auth": {"required": False},
                "successResponse": {"statusCode": 200, "schema": {"status": "string"}},
                "errorResponses": []
            })

        if errors:
            raise ValueError("Plan consistency validation failed: " + "; ".join(errors))

        print_to_stderr("Plan validation passed with " + str(len(warnings)) + " warnings.")

        final_output = {
            "status": "PLAN_VALIDATED",
            "validatedPlan": raw_plan,
            "warnings": warnings
        }
        print_to_stdout(final_output)

    except ValidationError as e:
        error_output = {
            "status": "PLAN_VALIDATOR_FAILED",
            "error": f"The build plan is malformed. Details: {e}",
            "traceback": traceback.format_exc()
        }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = {
            "status": "PLAN_VALIDATOR_FAILED",
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
