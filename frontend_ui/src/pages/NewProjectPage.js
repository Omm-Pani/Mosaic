// =================================================================================
// File:         frontend_ui/src/pages/NewProjectPage.js
// Version:      2.1 (Mosaic 2.0)
//
// Purpose:      This component serves as the initial screen for the user.
//
// V2.1 Change:  - CRITICAL FIX: Corrected the expected prop name from
//                 `onStartPlanGeneration` to `onStartAnalysis` to match the
//                 prop being passed down from App.js. This resolves the
//                 "onStartPlanGeneration is not a function" TypeError.
// =================================================================================

import React, { useState } from 'react';
import { Loader, Sparkles } from 'lucide-react';

const NewProjectPage = ({ onStartAnalysis, isLoading }) => {
    // Pre-filled with a sample prompt for user convenience
    const [projectName, setProjectName] = useState('SneakerHub E-commerce');
    const [prompt, setPrompt] = useState('A modern e-commerce platform for selling limited edition sneakers. Users should be able to browse by brand, see detailed product pages with multiple images, add items to a cart, and checkout securely. Also, include a basic admin dashboard for managing inventory and viewing orders.');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isLoading || !projectName.trim() || !prompt.trim()) return;
        // Correctly call the onStartAnalysis function passed from App.js
        onStartAnalysis({ projectName, prompt });
    };

    return (
        <div className="animate-fade-in max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-slate-800 mb-2">Create New Autonomous Project</h2>
            <p className="text-slate-500 mb-8">Start by describing your application. The AI will generate a complete build plan and dependency graph before execution.</p>

            <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
                <div className="space-y-6">
                    <div>
                        <label htmlFor="projectName" className="block text-sm font-semibold text-slate-700 mb-2">Project Name</label>
                        <input
                            id="projectName"
                            type="text"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            placeholder="e.g., SaaS Dashboard, E-commerce Store"
                            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="prompt" className="block text-sm font-semibold text-slate-700 mb-2">Describe Your Project</label>
                        <textarea
                            id="prompt"
                            rows="10"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Describe the project's business goals, key features, target users, and any specific technologies or styles you prefer..."
                            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow"
                            required
                        />
                    </div>

                    <div className="flex justify-end pt-4 border-t border-slate-200">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="bg-blue-600 text-white px-8 py-3 rounded-lg flex items-center font-semibold hover:bg-blue-700 transition-all shadow-sm disabled:bg-slate-400 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <Loader className="animate-spin w-5 h-5 mr-3" />
                            ) : (
                                <Sparkles className="w-5 h-5 mr-3" />
                            )}
                            Analyze Requirements
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default NewProjectPage;
