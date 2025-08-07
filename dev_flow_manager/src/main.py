# =================================================================================
# File:         dev_flow_manager/src/main.py
# Version:      3.0 (Mosaic - Enhanced Diagnostics)
#
# Purpose:      This FastAPI application serves as the Dev-Flow Manager.
#
# V3.0 Change:  - ENHANCEMENT: Added a diagnostic step. If the application
#                 container is not found after startup, the code now automatically
#                 runs `docker-compose logs` to fetch the container's internal
#                 logs. This output is then included in the final error message,
#                 allowing for much faster debugging of container startup failures.
# =================================================================================

import asyncio
import os
import shutil
import logging
import docker
import aiofiles
import uvicorn
from fastapi import FastAPI, WebSocket, HTTPException, UploadFile, File, Form
from fastapi.websockets import WebSocketDisconnect
from pydantic import BaseModel
from docker.errors import DockerException
from pathlib import Path
import traceback

# --- Basic Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Initialize FastAPI App ---
app = FastAPI(
    title="Mosaic 3.0 Dev-Flow Manager",
    description="Manages isolated Docker environments for application generation, preview, and healing.",
    version="3.0.0"
)

# --- Docker Client Initialization ---
try:
    docker_client = docker.from_env()
except DockerException:
    logger.error("Docker is not running or accessible. Please ensure the Docker daemon is active.")
    docker_client = None

# --- Constants ---
BASE_DIR = Path(__file__).resolve().parent
PROJECTS_ROOT_DIR = BASE_DIR.parent.parent / "generated_projects"
VM_TEMPLATE_DIR = BASE_DIR.parent.parent / "templates"

os.makedirs(PROJECTS_ROOT_DIR, exist_ok=True)

# --- Pydantic Models for API Data Contracts ---
class StartEnvRequest(BaseModel):
    session_id: str

class StartEnvResponse(BaseModel):
    session_id: str
    preview_url: str
    logs_ws_url: str

class FileUploadResponse(BaseModel):
    session_id: str
    file_path: str
    status: str

# =================================================================================
# --- Core Docker & File Management Logic ---
# =================================================================================

async def start_vm_environment(session_id: str) -> str:
    """Initializes and starts the Docker containers for a given session."""
    if not docker_client:
        raise HTTPException(status_code=503, detail="Docker service is not available.")

    project_path = PROJECTS_ROOT_DIR / session_id
    if project_path.exists():
        logger.warning(f"Session {session_id} already exists. Cleaning up before restart.")
        await stop_vm_environment(session_id)

    shutil.copytree(VM_TEMPLATE_DIR, project_path, dirs_exist_ok=True)
    
    env_file_path = project_path / ".env"
    async with aiofiles.open(env_file_path, 'w') as env_file:
        await env_file.write(f"SESSION_ID={session_id}\n")
    logger.info(f"Created .env file for session {session_id}")

    logger.info(f"Starting docker-compose for session {session_id}...")
    process = await asyncio.create_subprocess_exec(
        "docker-compose", "up", "-d", "--build",
        cwd=str(project_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()

    if process.returncode != 0:
        error_msg = stderr.decode()
        logger.error(f"Failed to start docker-compose for session {session_id}: {error_msg}")
        raise HTTPException(status_code=500, detail=f"Docker Compose failed: {error_msg}")

    logger.info(f"Successfully started environment for session {session_id}")
    
    await asyncio.sleep(5)
    
    container_name = f"mosaic-vm-{session_id}"
    try:
        container = docker_client.containers.get(container_name)
        container.reload()
        
        port_data = container.ports.get('3000/tcp')
        if not port_data:
            raise HTTPException(status_code=500, detail="Container started but Next.js port 3000 is not exposed.")
            
        host_port = port_data[0]['HostPort']
        return f"http://localhost:{host_port}"
    except docker.errors.NotFound:
        # --- START DIAGNOSTIC FIX ---
        logger.error(f"Container '{container_name}' not found. Fetching logs for diagnostics...")
        log_process = await asyncio.create_subprocess_exec(
            "docker-compose", "logs", "--no-color",
            cwd=str(project_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        log_stdout, log_stderr = await log_process.communicate()
        container_logs = log_stdout.decode() or log_stderr.decode()
        
        error_detail = f"Container '{container_name}' not found after startup. It may have crashed. Container Logs:\n---\n{container_logs}\n---"
        logger.error(error_detail)
        # --- END DIAGNOSTIC FIX ---
        raise HTTPException(status_code=404, detail=error_detail)


async def stop_vm_environment(session_id: str) -> None:
    """Stops and removes all Docker containers and project files for a session."""
    project_path = PROJECTS_ROOT_DIR / session_id
    if project_path.exists():
        logger.warning(f"Stopping environment for session {session_id}...")
        process = await asyncio.create_subprocess_exec(
            "docker-compose", "down", "--volumes", "--remove-orphans",
            cwd=str(project_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await process.communicate()
        shutil.rmtree(project_path)
        logger.info(f"Cleaned up environment for session {session_id}")

# =================================================================================
# --- API Endpoints ---
# =================================================================================
@app.post("/start-environment", response_model=StartEnvResponse)
async def start_environment_endpoint(req: StartEnvRequest):
    try:
        preview_url = await start_vm_environment(req.session_id)
        return StartEnvResponse(
            session_id=req.session_id,
            preview_url=preview_url,
            logs_ws_url=f"/ws/logs/{req.session_id}"
        )
    except Exception as e:
        logger.error(f"Critical error in /start-environment for {req.session_id}: {e}\n{traceback.format_exc()}")
        # The detail from the custom HTTPException will be passed through here
        error_detail = getattr(e, 'detail', str(e))
        raise HTTPException(status_code=getattr(e, 'status_code', 500), detail=error_detail)


@app.post("/upload-file", response_model=FileUploadResponse)
async def upload_file_endpoint(session_id: str = Form(...), relative_path: str = Form(...), file: UploadFile = File(...)):
    project_path = PROJECTS_ROOT_DIR / session_id
    if not project_path.exists():
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")

    file_path = project_path / "src" / relative_path
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    try:
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        return FileUploadResponse(
            session_id=session_id,
            file_path=relative_path,
            status="uploaded"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {e}")

# WebSocket endpoint for streaming logs (implementation can be added if needed)
@app.websocket("/ws/logs/{session_id}")
async def websocket_logs_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    # This is a placeholder for a real log streaming implementation
    try:
        while True:
            await websocket.send_text(f"Log stream for {session_id} is not yet implemented.")
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        logger.info(f"Log stream for {session_id} disconnected.")


# --- Runnable Server Block ---
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
