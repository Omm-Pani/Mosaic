# =================================================================================
# File:         agents/data_model_agent.py
# Version:      4.0 (Mosaic 4.0 - Advanced Schema)
#
# Purpose:      This agent generates a single, detailed data model schema with
#               advanced database constraints and relational patterns.
#
# V4.0 Change:  - Enhanced FieldDefinition to include `enum_values`, `default`,
#                 `indexed`, and `unique` for granular DB control.
#               - Updated prompt to enforce stricter normalization, introduce
#                 polymorphic relationships, and identify project archetypes
#                 to generate more domain-specific, robust schemas.
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

class FieldDefinition(BaseModel):
    type: str = Field(..., description="The data type of the field (e.g., 'uuid', 'string', 'text', 'integer', 'float', 'decimal', 'boolean', 'timestamp', 'enum', 'json', 'url', 'hashed_string', 'string[]').")
    description: str = Field(..., description="A clear explanation of the field's purpose.")
    required: bool = Field(default=True)
    enum_values: Optional[List[str]] = Field(default=None, description="A list of specific valid options for an enum field.")
    default: Optional[Any] = Field(default=None, description="A default value for the database column.")
    indexed: Optional[bool] = Field(default=False, description="Marks fields that should have a database index for faster lookups.")
    unique: Optional[bool] = Field(default=False, description="Enforces a uniqueness constraint on the field.")

class DataModel(BaseModel):
    name: str = Field(..., description="The name of the data model in PascalCase, e.g., 'User', 'Product', 'Tenant'.")
    description: str = Field(..., description="A summary of what this data model represents in the system.")
    fields: Dict[str, FieldDefinition] = Field(..., description="A dictionary of field names to their detailed definitions.")
    relationships: Dict[str, List[str]] = Field(default={}, description="Defines relationships like 'hasMany', 'belongsTo', and 'manyToMany'.")

class DataModelOutput(DataModel):
    pass

# --- Helper Functions ---
def print_to_stdout(data: Dict[str, Any]):
    sys.stdout.write(json.dumps(data, indent=2))
    sys.stdout.flush()

def print_to_stderr(message: str):
    sys.stderr.write(f"DEBUG (data_model_agent): {message}\n")
    sys.stdout.flush()

def get_gemini_model() -> genai.GenerativeModel:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("The GOOGLE_API_KEY environment variable is not set.")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-pro-latest")

def create_system_prompt(srs: Dict[str, Any], model_name: str, model_description: str) -> str:
    srs_json_string = json.dumps(srs, indent=2)
    output_schema_string = json.dumps(DataModelOutput.model_json_schema(), indent=2)

    return f"""
You are a world-class Lead Data Architect. Your mission is to produce a comprehensive, normalized, and scalable schema for a SINGLE data model.

--- INPUT: Software Requirements Specification (SRS) ---
```json
{srs_json_string}
```

--- YOUR FOCUSED TASK ---
- **Model Name:** `{model_name}`
- **Model Description:** `{model_description}`

--- INSTRUCTIONS ---
1.  **Project Archetype Identification**: First, classify the project (e.g., "SaaS," "E-commerce," "Analytics Platform," "Social App") based on the SRS to anticipate common data patterns.
2.  **Enforce Normalization**: Do NOT use complex nested JSON objects for fields. If you see a complex object, break it into a separate, related model. For example, instead of a `user` field with a nested address object, create a separate `Address` model that `belongsTo` the `User`.
3.  **Detailed Attribute Design**: For each field, define its `type`, `description`, and `required` status. Also add:
    - `indexed: true` for all foreign keys and frequently queried fields.
    - `unique: true` for fields like `email` or `username`.
    - `enum_values` and a `default` for `enum` type fields.
4.  **Polymorphic Relationships**: If a model can belong to multiple other types of models (e.g., a Comment can belong to a Post or a Product), implement a polymorphic relationship. This requires two fields: `commentable_id: uuid` and `commentable_type: string`.
5.  **CRUCIAL CHECK**: Your output MUST be a perfectly valid JSON object conforming to the schema.

--- OUTPUT: Your Final JSON Schema (Adhere to this STRICTLY) ---
```json
{output_schema_string}
```
"""

def create_contextual_fixer_prompt(srs: Dict[str, Any], model_name: str, model_description: str, invalid_json: str, error: str) -> str:
    original_prompt = create_system_prompt(srs, model_name, model_description)
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
        model_name = inbound_data.get("modelName")
        model_description = inbound_data.get("modelDescription")

        if not all([srs, model_name, model_description]):
            raise ValueError("Input must contain 'validatedRequirements', 'modelName', and 'modelDescription'.")

        print_to_stderr(f"Initializing Data Model Agent (v4.0) for model: {model_name}...")
        
        validated_data = None
        response_text = ""
        last_error = ""
        max_retries = 3
        
        prompt = create_system_prompt(srs, model_name, model_description)

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    prompt = create_contextual_fixer_prompt(srs, model_name, model_description, response_text, last_error)
                
                print_to_stderr(f"Calling Gemini for data model: {model_name} (Attempt {attempt + 1})...")
                model = get_gemini_model()
                response = model.generate_content(prompt)
                
                response_text = response.text.strip().replace("```json", "").replace("```", "")
                
                parsed_json = json.loads(response_text)
                validated_data = DataModelOutput.model_validate(parsed_json)
                print_to_stderr(f"Data model for {model_name} parsed and validated successfully on attempt {attempt + 1}.")
                break

            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                print_to_stderr(f"Attempt {attempt + 1} failed for model {model_name}: {last_error}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                else:
                    raise e

        if validated_data is None:
            raise RuntimeError(f"Failed to generate and validate data model JSON for {model_name} after multiple retries.")

        final_output = {
            "status": "DATA_MODEL_GENERATED",
            "dataModel": validated_data.model_dump()
        }
        print_to_stdout(final_output)

    except (ValidationError, json.JSONDecodeError, RuntimeError) as e:
        error_output = { "status": "DATA_MODEL_AGENT_FAILED", "error": f"Failed after multiple retries for model {model_name}: {e}", "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)
    except Exception as e:
        error_output = { "status": "DATA_MODEL_AGENT_FAILED", "error": str(e), "traceback": traceback.format_exc() }
        print_to_stdout(error_output)
        sys.exit(1)

if __name__ == "__main__":
    main()
