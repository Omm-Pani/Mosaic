# =================================================================================
# File:         agents/interaction_flow_agent.py
# Version:      4.3 (Mosaic 4.0 - Resilient Actions)
#
# Purpose:      This agent generates a comprehensive set of detailed interaction
#               flows, including advanced error handling and data mapping.
#
# V4.3 Change:  - CRITICAL FIX: Made the `targetState` field in the `Action` model
#                 optional. This resolves the Pydantic validation error when the
#                 LLM correctly omits the default target in favor of explicit
#                 `onSuccess` and `onFailure` states for an API call.
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

class SideEffect(BaseModel):
    apiCall: str

class DatabaseOperation(BaseModel):
    operation: str = Field(..., description="The type of database operation (e.g., 'CREATE', 'UPDATE', 'DELETE', 'CREATE_MANY').")
    model: str = Field(..., description="The name of the data model being operated on.")
    data: Optional[Dict[str, Any]] = Field(default=None, description="The data for the operation, with values mapped from state or payload.")
    target: Optional[str] = Field(default=None, description="The identifier for the record to be updated or deleted.")
    source: Optional[str] = Field(default=None, description="The source of data for a CREATE_MANY operation (e.g., 'cart.items').")

class Action(BaseModel):
    trigger: str = Field(..., description="The event that initiates the action, e.g., 'submit_checkout_form'.")
    # FIX: targetState is now optional to allow for API-driven success/failure states.
    targetState: Optional[str] = Field(default=None, description="The default state to transition to if no specific success/failure states are defined.")
    apiCall: Optional[str] = Field(default=None, description="The ID of the API to call during this transition.")
    payload: Optional[Dict[str, Any]] = Field(default=None, description="Defines how state data maps to the API request body.")
    databaseOperations: Optional[List[DatabaseOperation]] = Field(default=None, description="A description of the database changes expected from this action.")
    onSuccess: Optional[str] = Field(default=None, description="The state to transition to on API call success.")
    onFailure: Optional[str] = Field(default=None, description="The state to transition to on API call failure.")
    guard: Optional[str] = Field(default=None, description="A condition that must be true for the transition to be allowed (e.g., '{cart.items.length > 0}').")

class State(BaseModel):
    description: str = Field(..., description="A description of what is happening in this state.")
    onEnter: Optional[SideEffect] = Field(default=None, description="Action to be taken upon entering the state.")
    onExit: Optional[SideEffect] = Field(default=None, description="Action to be taken upon exiting the state.")
    actions: List[Action]
    final: Optional[bool] = Field(default=False, description="Is this a final state in the flow?")

class InteractionFlow(BaseModel):
    id: str = Field(..., description="A unique identifier for the flow, e.g., 'checkout_flow'.")
    description: str = Field(..., description="A high-level description of the user journey this flow represents.")
    startState: str = Field(..., description="The initial state of the flow.")
    states: Dict[str, State]

class InteractionFlowOutput(BaseModel):
    flows: List[InteractionFlow]

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (interaction_flow_agent): {message}\n")
    sys.stdout.flush()

def get_gemini_model() -> genai.GenerativeModel:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-pro-latest")

def create_system_prompt(srs: Dict[str, Any], ui_specs: Dict[str, Any]) -> str:
    srs_json_string = json.dumps(srs, indent=2)
    ui_specs_string = json.dumps(ui_specs, indent=2)
    output_schema_string = json.dumps(InteractionFlowOutput.model_json_schema(), indent=2)

    return f"""
You are an expert Application Logic and User Experience Designer. Your task is to analyze the provided Software Requirements Specification (SRS) and define a comprehensive set of detailed interaction flows as expressive and robust state machines. You must generate ALL the key user journeys described in the SRS.

--- CONTEXT: Software Requirements Specification (SRS) ---
```json
{srs_json_string}
```

--- CONTEXT: UI Specifications ---
```json
{ui_specs_string}
```

--- INSTRUCTIONS ---
For each major user journey in the SRS (e.g., user checkout, admin inventory management), you must create a complete `InteractionFlow` object.

**State Machine Design Principles:**
1.  **Map All States**: For each flow, identify every single step a user takes. Each step is a `State`. Give it a clear `description`.
2.  **Explicit Error Handling**: When an `Action` triggers an `apiCall`, you MUST define both `onSuccess` and `onFailure` target states. The default `targetState` field can be omitted in this case. Design a dedicated error state (e.g., `PAYMENT_FAILED`) to handle the failure case.
3.  **Payload Mapping**: For any `Action` that calls an API, you MUST include a `payload` object that maps application state data to the API's request body.
4.  **Declarative Database Operations**: Alongside an `apiCall`, describe the expected database changes in the `databaseOperations` array.
5.  **Guard Conditions**: Use the `guard` property on an `Action` to define conditions that must be true for it to be available (e.g., `guard: "{{cart.items.length > 0}}"`).
6.  **Entry/Exit Actions**: Use `onEnter` and `onExit` for side effects, like fetching data automatically when a state becomes active.

**High-Quality Example (E-commerce Checkout Flow):**
```json
{{
  "id": "ecommerce_checkout_flow",
  "description": "Handles the entire user checkout process for an e-commerce site.",
  "startState": "VIEWING_CART",
  "states": {{
    "VIEWING_CART": {{
      "description": "User is viewing the items in their shopping cart.",
      "actions": [
        {{
          "trigger": "proceed_to_checkout",
          "targetState": "ENTERING_SHIPPING",
          "guard": "{{cart.items.length > 0}}"
        }}
      ]
    }},
    "ENTERING_PAYMENT": {{
      "description": "User is providing their payment information.",
      "actions": [
        {{
          "trigger": "submit_payment_details",
          "apiCall": "process_payment_and_create_order",
          "payload": {{ "cartId": "{{cart.id}}", "paymentToken": "{{paymentGateway.token}}" }},
          "onSuccess": "ORDER_CONFIRMATION",
          "onFailure": "PAYMENT_FAILED"
        }}
      ]
    }},
    "PAYMENT_FAILED": {{
      "description": "Displays a payment failure message.",
      "actions": [ {{ "trigger": "retry_payment", "targetState": "ENTERING_PAYMENT" }} ]
    }},
    "ORDER_CONFIRMATION": {{
      "description": "The order has been successfully placed.",
      "final": true,
      "actions": []
    }}
  }}
}}
```
**CRUCIAL CHECK**: Your final output MUST be a single JSON object containing a `flows` array. Each object in the array must be a complete, valid `InteractionFlow` object. Double-check all syntax, especially for missing commas.

--- OUTPUT: Your Final JSON Schema (Adhere to this STRICTLY) ---
```json
{output_schema_string}
```
"""

def create_contextual_fixer_prompt(srs: Dict[str, Any], ui_specs: Dict[str, Any], invalid_json: str, error: str) -> str:
    original_prompt = create_system_prompt(srs, ui_specs)
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
        ui_specs = inbound_data.get("uiSpecs")

        if not all([srs, ui_specs]):
            raise ValueError("Input must contain 'validatedRequirements' and 'uiSpecs'.")

        print_to_stderr("Initializing Interaction Flow Agent (v4.3)...")
        
        validated_data = None
        response_text = ""
        last_error = ""
        max_retries = 3
        
        prompt = create_system_prompt(srs, ui_specs)

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    prompt = create_contextual_fixer_prompt(srs, ui_specs, response_text, last_error)
                
                print_to_stderr(f"Calling Gemini to generate all interaction flows (Attempt {attempt + 1})...")
                model = get_gemini_model()
                response = model.generate_content(prompt)
                
                response_text = response.text.strip().replace("```json", "").replace("```", "")
                
                parsed_json = json.loads(response_text)
                validated_data = InteractionFlowOutput.model_validate(parsed_json)
                print_to_stderr(f"All interaction flows parsed and validated successfully on attempt {attempt + 1}.")
                break

            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                print_to_stderr(f"Attempt {attempt + 1} failed: {last_error}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                else:
                    raise e

        if validated_data is None:
            raise RuntimeError("Failed to generate and validate interaction flows JSON after multiple retries.")

        final_output = {
            "status": "INTERACTION_FLOWS_GENERATED",
            "interactionFlows": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except (ValidationError, json.JSONDecodeError, RuntimeError) as e:
        error_output = { "status": "INTERACTION_FLOW_AGENT_FAILED", "error": f"Failed after multiple retries: {e}", "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = { "status": "INTERACTION_FLOW_AGENT_FAILED", "error": str(e), "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
