// =================================================================================
// File:         frontend_ui/src/pages/PipelinePage.js
// Version:      2.0 (Mosaic 2.0)
//
// Purpose:      This is the final screen, displaying the real-time progress of
//               the DAG-based build pipeline and the live application preview.
//
// V2.0 Change:  - The logic now tracks the status of each individual file (node)
//                 from the work graph.
//               - It updates the status of a node (e.g., from 'active' to
//                 'completed') based on WebSocket events from the orchestrator.
//               - This provides a granular, real-time view of the build process.
// =================================================================================

import React, { useState, useEffect, useRef } from 'react';
import { Loader, CheckCircle, AlertTriangle, Clock } from 'lucide-react';

const PipelineStep = ({ stage }) => {
    // Define styles for different statuses
    const statusStyles = {
        completed: 'bg-green-100 text-green-800',
        active: 'bg-blue-100 text-blue-800 animate-pulse',
        error: 'bg-red-100 text-red-800',
        pending: 'bg-slate-100 text-slate-500',
    };
    const iconStyles = {
        completed: <CheckCircle className="w-5 h-5 text-green-500"/>,
        active: <Loader className="w-5 h-5 text-blue-500 animate-spin"/>,
        error: <AlertTriangle className="w-5 h-5 text-red-600"/>,
        pending: <Clock className="w-5 h-5 text-slate-400"/>,
    };

    const appliedStyle = statusStyles[stage.status] || statusStyles.pending;
    const appliedIcon = iconStyles[stage.status] || iconStyles.pending;

    return (
        <li className={`flex items-center space-x-4 p-3 rounded-lg transition-all ${appliedStyle}`}>
            <div className="w-5 h-5 shrink-0 flex items-center justify-center">{appliedIcon}</div>
            <span className="font-medium text-sm truncate" title={stage.step}>{stage.step}</span>
        </li>
    );
};

const PipelinePage = ({ socket, buildId }) => {
    const [pipeline, setPipeline] = useState([]);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [isComplete, setIsComplete] = useState(false);
    const pipelineEndRef = useRef(null);

    // Scroll to the bottom of the log list as new messages arrive
    useEffect(() => {
        pipelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [pipeline]);

    useEffect(() => {
        if (!socket || !buildId) return;

        // Start with an initial "queued" state
        setPipeline([{ step: `Build Queued (ID: ${buildId})`, status: 'active' }]);

        const handleProgress = (data) => {
             setPipeline(prev => {
                const newPipeline = [...prev];
                const stepId = data.step; // e.g., "Generating: app/page.tsx"

                // Find if this step already exists
                const existingIndex = newPipeline.findIndex(p => p.step === stepId);

                if (existingIndex !== -1) {
                    // Update existing step status
                    newPipeline[existingIndex].status = data.status;
                } else {
                    // Add new step
                    newPipeline.push({ step: stepId, status: data.status });
                }
                
                // Mark previous 'active' steps as 'completed' if the new step is also 'active'
                if (data.status === 'active') {
                    return newPipeline.map(p => (p.status === 'active' && p.step !== stepId) ? { ...p, status: 'completed' } : p);
                }

                return newPipeline;
            });
        };

        const handleJobComplete = (data) => {
            setPreviewUrl(data.previewUrl);
            setIsComplete(true);
            setPipeline(prev => [...prev.map(p => p.status === 'active' ? {...p, status: 'completed'} : p), { step: 'Deployment Complete!', status: 'completed' }]);
        };
        
        const handleJobError = (data) => {
             setPipeline(prev => [...prev.map(p => p.status === 'active' ? {...p, status: 'error'} : p), { step: `Build Failed: ${data.error}`, status: 'error' }]);
             setIsComplete(true); // Stop on failure
        }

        socket.on('progress', handleProgress);
        socket.on('job-complete', handleJobComplete);
        socket.on('job-error', handleJobError);

        return () => {
            socket.off('progress', handleProgress);
            socket.off('job-complete', handleJobComplete);
            socket.off('job-error', handleJobError);
        };
    }, [buildId, socket]);

    return (
        <div className="animate-fade-in grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
            <div className="lg:col-span-1 flex flex-col">
                 <h2 className="text-3xl font-bold text-slate-800 mb-6">3. Live Build Pipeline</h2>
                 <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-grow overflow-hidden">
                    <div className="h-full overflow-y-auto pr-2">
                        <ul className="space-y-3">
                            {pipeline.map((stage, i) => ( <PipelineStep key={i} stage={stage}/> ))}
                            <div ref={pipelineEndRef} />
                        </ul>
                    </div>
                </div>
            </div>
            <div className="lg:col-span-2 h-full flex flex-col">
                 <h2 className="text-3xl font-bold text-slate-800 mb-6">Live Application Preview</h2>
                 <div className="bg-slate-800 rounded-xl shadow-2xl overflow-hidden border-4 border-slate-800 flex-grow">
                    <div className="bg-slate-200 h-full flex items-center justify-center">
                        {isComplete && previewUrl ? (
                            <iframe src={previewUrl} title="Live Preview" className="w-full h-full bg-white"></iframe>
                        ) : (
                            <div className="text-center text-slate-500 p-8">
                                <Loader className="animate-spin w-8 h-8 mx-auto mb-4"/>
                                <h3 className="font-semibold text-lg">AI is building your application...</h3>
                                <p className="text-sm">File generation status will appear on the left.</p>
                            </div>
                        )}
                        {isComplete && !previewUrl && (
                             <div className="text-center text-red-600 p-8">
                                <AlertTriangle className="w-8 h-8 mx-auto mb-4"/>
                                <h3 className="font-semibold text-lg">Build Failed</h3>
                                <p className="text-sm">The build process encountered an error. Check the logs for details.</p>
                            </div>
                        )}
                    </div>
                 </div>
            </div>
        </div>
    );
};

export default PipelinePage;
