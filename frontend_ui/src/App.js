// =================================================================================
// File:         frontend_ui/src/App.js
// Version:      3.0 (Mosaic 2.0)
//
// Purpose:      This is the root component and state manager for the Mosaic 2.0 UI.
//
// V3.0 Change:  - CRITICAL FIX: The component's state and handlers have been
//                 refactored to match the backend's two-step API.
//               - `handleStartAnalysis` now calls `/api/analyze` and transitions
//                 to the new `ValidationPage`.
//               - `handleStartPlanning` is a new handler called from `ValidationPage`
//                 which calls `/api/plan` to generate the final build plan.
// =================================================================================

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { LayoutDashboard, AlertCircle } from 'lucide-react';

// Import Page Components
import NewProjectPage from './pages/NewProjectPage.js';
import ValidationPage from './pages/ValidationPage.js';
import PlanningPage from './pages/PlanningPage.js';
import PipelinePage from './pages/PipelinePage.js';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

const App = () => {
    // State to manage the current view (page) shown to the user
    const [view, setView] = useState('newProject');

    // Central state object to hold all data throughout the workflow
    const [jobData, setJobData] = useState({
        buildId: null,
        projectName: '',
        prompt: '',
        validatedRequirements: null,
        buildPlan: null,
    });

    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const socketRef = useRef(null);

    // --- WebSocket Connection Management ---
    useEffect(() => {
        socketRef.current = io(API_BASE_URL);
        socketRef.current.on('connect', () => console.log('Socket.IO connected:', socketRef.current.id));
        socketRef.current.on('disconnect', () => console.log('Socket.IO disconnected.'));
        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, []);

    // --- Workflow Step Handlers ---

    const handleStartAnalysis = async (projectData) => {
        setError(null);
        setIsLoading(true);
        setJobData(prev => ({ ...prev, ...projectData, validatedRequirements: null, buildPlan: null }));
        setView('validation'); // Switch to validation view to show loading state

        try {
            const response = await axios.post(`${API_BASE_URL}/api/analyze`, projectData);
            setJobData(prev => ({
                ...prev,
                buildId: response.data.buildId,
                validatedRequirements: response.data.validatedRequirements,
            }));
        } catch (err) {
            setError(err.response?.data?.message || 'Requirement analysis failed.');
            setView('newProject');
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartPlanning = async () => {
        setError(null);
        setIsLoading(true);
        setView('planning'); // Switch to planning view to show loading state

        try {
            const payload = {
                buildId: jobData.buildId,
                validatedRequirements: jobData.validatedRequirements,
            };
            const response = await axios.post(`${API_BASE_URL}/api/plan`, payload);
            setJobData(prev => ({ ...prev, buildPlan: response.data.buildPlan }));
        } catch (err) {
            setError(err.response?.data?.message || 'Architectural planning failed.');
            setView('validation'); // Go back to validation on failure
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartExecution = async () => {
        setError(null);
        setIsLoading(true);
        setView('pipeline');

        try {
            const payload = {
                buildId: jobData.buildId,
                socketId: socketRef.current.id,
                buildPlan: jobData.buildPlan,
            };
            await axios.post(`${API_BASE_URL}/api/execute`, payload);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to start the build process.');
            setView('planning');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleStartOver = () => {
        setView('newProject');
        setJobData({
            buildId: null,
            projectName: '',
            prompt: '',
            validatedRequirements: null,
            buildPlan: null,
        });
        setError(null);
        setIsLoading(false);
    };

    // --- View Renderer ---
    const renderView = () => {
        switch (view) {
            case 'validation':
                return <ValidationPage
                            requirements={jobData.validatedRequirements}
                            onApprove={handleStartPlanning}
                            isLoading={isLoading}
                        />;
            case 'planning':
                return <PlanningPage
                            plan={jobData.buildPlan}
                            onApprove={handleStartExecution}
                            isLoading={isLoading}
                        />;
            case 'pipeline':
                return <PipelinePage
                            socket={socketRef.current}
                            buildId={jobData.buildId}
                        />;
            case 'newProject':
            default:
                return <NewProjectPage
                            onStartAnalysis={handleStartAnalysis}
                            isLoading={isLoading}
                        />;
        }
    };

    return (
        <div className="bg-slate-100 min-h-screen font-sans text-slate-800 flex flex-col md:flex-row">
            <Sidebar onNavigate={handleStartOver} />
            <main className="flex-1 p-6 md:p-8 lg:p-10 overflow-y-auto h-screen">
                {error && (
                    <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4 rounded-r-lg flex items-center shadow-md" role="alert">
                        <AlertCircle className="w-6 h-6 mr-3 text-red-500"/>
                        <div>
                            <p className="font-bold">An Error Occurred</p>
                            <p>{error}</p>
                        </div>
                    </div>
                )}
                {renderView()}
            </main>
        </div>
    );
};

// --- Sidebar Component ---
const Sidebar = ({ onNavigate }) => (
    <aside className="w-full md:w-20 lg:w-64 bg-white border-r border-slate-200 p-4 flex flex-row md:flex-col items-center lg:items-start shrink-0">
        <div className="flex items-center justify-center lg:justify-start w-auto md:w-full mb-0 md:mb-10">
            <div className="bg-slate-900 text-white w-10 h-10 flex items-center justify-center rounded-lg font-bold text-xl shadow-lg shrink-0">M</div>
            <h1 className="hidden lg:block text-xl font-bold ml-3 text-slate-800">Mosaic 2.0</h1>
        </div>
        <nav className="w-full ml-4 md:ml-0">
            <ul>
                <li>
                    <button onClick={onNavigate} className="w-full flex items-center justify-center lg:justify-start p-3 rounded-lg bg-blue-100 text-blue-700 font-semibold text-sm hover:bg-blue-200 transition-colors">
                        <LayoutDashboard className="w-5 h-5 shrink-0" />
                        <span className="hidden lg:inline ml-3">New Project</span>
                    </button>
                </li>
            </ul>
        </nav>
    </aside>
);

export default App;
