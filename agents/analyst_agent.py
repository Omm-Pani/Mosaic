# =================================================================================
# File:         agents/analyst_agent.py
# Version:      3.8 (Mosaic 3.0 - Context-Aware Self-Correction)
#
# Purpose:      This agent acts as the "Product Analyst" in the Mosaic
#               pipeline. It transforms the user prompt into a structured SRS.
#
# V3.8 Change:  - Implemented a context-aware self-correction mechanism.
#               - The "fixer" prompt now includes the full original context
#                 (the user prompt) along with the error message.
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

# --- Pydantic Schemas for a Rich & Structured SRS ---

class Persona(BaseModel):
    name: str = Field(..., description="A descriptive name for the user persona, e.g., 'Admin', 'Guest User'.")
    description: str = Field(..., description="A brief description of this persona's goals and motivations.")

class UserAction(BaseModel):
    trigger: str = Field(..., description="The specific user action that initiates a transition, e.g., 'clicks on a product card', 'submits the checkout form'.")
    target_screen: str = Field(..., description="The screen the user is taken to after the action.")

class UserStory(BaseModel):
    story: str = Field(..., description="A user story in the classic format 'As a [persona], I can [action] so that [benefit].'")
    acceptanceCriteria: List[str] = Field(..., description="A list of specific, testable acceptance criteria for this user story.")
    actions: List[UserAction] = Field(..., description="A list of specific user actions and their resulting screen transitions related to this story.")

class ScreenDetail(BaseModel):
    name: str = Field(..., description="The unique name of the screen, e.g., 'Homepage', 'Dashboard'.")
    function: str = Field(..., description="A concise description of the screen's primary purpose and function.")
    associatedPersonas: List[str] = Field(..., description="A list of persona names who will interact with this screen.")

class ValidatedRequirements(BaseModel):
    projectName: str = Field(..., description="The name of the project, derived from user input.")
    personas: List[Persona]
    userStories: List[UserStory]
    screens: List[ScreenDetail]

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (analyst_agent): {message}\n")
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

def create_system_prompt(project_name: str, prompt_text: str) -> str:
    json_schema = json.dumps(ValidatedRequirements.model_json_schema(), indent=2)
    return f"""
You are an expert Product Analyst. Your task is to create a detailed Product Requirement Document (PRD)
based on the user's project brief. Your output MUST be a single, valid JSON object that strictly
adheres to the JSON Schema provided below.

USER REQUEST:
- Project Name: "{project_name}"
- Description: "{prompt_text}"

JSON SCHEMA FOR YOUR OUTPUT (ValidatedRequirements):
```json
{json_schema}
```
GENERATE THE STRUCTURED SRS JSON NOW.
"""

def create_contextual_fixer_prompt(project_name: str, prompt_text: str, invalid_json: str, error: str) -> str:
    """Creates a prompt that includes the original context and the error for the LLM to fix."""
    original_prompt = create_system_prompt(project_name, prompt_text)
    
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
        prompt_text = inbound_data.get("prompt", "")
        project_name = inbound_data.get("projectName", "Untitled Project")

        if not prompt_text:
            raise ValueError("Input 'prompt' cannot be empty.")

        print_to_stderr("Initializing Analyst Agent (v3.8)...")
        
        validated_data = None
        response_text = ""
        last_error = ""
        max_retries = 3
        
        prompt = create_system_prompt(project_name, prompt_text)

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    prompt = create_contextual_fixer_prompt(project_name, prompt_text, response_text, last_error)
                
                print_to_stderr(f"Calling Gemini to generate SRS (Attempt {attempt + 1})...")
                model = get_gemini_model(is_json_output=False)
                response = model.generate_content(prompt)
                
                response_text = response.text.strip().replace("```json", "").replace("```", "")
                
                parsed_json = json.loads(response_text)
                validated_data = ValidatedRequirements.model_validate(parsed_json)
                print_to_stderr(f"SRS parsed and validated successfully on attempt {attempt + 1}.")
                break

            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                print_to_stderr(f"Attempt {attempt + 1} failed: {last_error}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                else:
                    raise e

        if validated_data is None:
            raise RuntimeError("Failed to generate and validate SRS JSON after multiple retries.")

        print_to_stderr("SRS generated and validated successfully.")

        final_output = {
            "status": "VALIDATION_COMPLETE",
            "validatedRequirements": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except (ValidationError, json.JSONDecodeError, RuntimeError) as e:
        error_output = {
            "status": "ANALYST_AGENT_FAILED",
            "error": f"Failed after multiple retries: {e}",
            "traceback": traceback.format_exc()
        }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = {
            "status": "ANALYST_AGENT_FAILED",
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
