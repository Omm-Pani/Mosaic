// =================================================================================
// File Path: 5_frontend_react/src/index.js
// Version: 1.0
// Generated: Wednesday, June 25, 2025, 11:15 AM IST
//
// Purpose: This is the main entry point for the React application. It renders
// the root App component into the DOM. This version includes the fix for the
// ES Module import resolution error.
// =================================================================================
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // Assuming you will create this for Tailwind directives
import App from './App.js'; // FIX: Added .js extension to the import path

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
