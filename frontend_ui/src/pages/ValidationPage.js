// =================================================================================
// File:         frontend_ui/src/pages/ValidationPage.js
// Version:      2.0 (Mosaic 2.0)
//
// Purpose:      This page serves as the critical user validation gate. It displays
//               the structured Software Requirements Specification (SRS) generated
//               by the analyst_agent and requires the user to approve it before
//               the expensive planning and code generation phases can begin.
// =================================================================================
import React, { useState } from "react";
import {
  Loader,
  User,
  BookOpen,
  ScreenShare,
  CheckCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// --- Reusable UI Components ---

const AccordionItem = ({ title, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm transition-all hover:shadow-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center p-4 text-left font-semibold text-slate-800 hover:bg-slate-50 transition-colors rounded-t-lg"
      >
        <span className="pr-4">{title}</span>
        {isOpen ? (
          <ChevronDown className="text-slate-500 w-5 h-5 shrink-0" />
        ) : (
          <ChevronRight className="text-slate-500 w-5 h-5 shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="p-4 border-t border-slate-200 text-slate-600 bg-slate-50/50 rounded-b-lg">
          {children}
        </div>
      )}
    </div>
  );
};

const TabButton = ({ id, label, icon: Icon, activeTab, setActiveTab }) => (
  <button
    onClick={() => setActiveTab(id)}
    className={`flex items-center space-x-2 py-3 px-4 font-semibold transition-colors border-b-2 ${
      activeTab === id
        ? "border-blue-600 text-blue-600"
        : "border-transparent text-slate-500 hover:text-slate-700"
    }`}
  >
    <Icon className="w-5 h-5" />
    <span>{label}</span>
  </button>
);

// --- Display Components for each Tab ---

const UserPersonasDisplay = ({ personas = [] }) => (
  <div className="space-y-4">
    {personas.map((p, i) => (
      <AccordionItem
        key={i}
        title={
          <>
            <User className="inline-block mr-2 w-5 h-5 text-blue-500" />
            {p.name}
          </>
        }
        defaultOpen={i === 0}
      >
        <p className="text-base">{p.description}</p>
      </AccordionItem>
    ))}
  </div>
);

const UserStoriesDisplay = ({ stories = [] }) => (
  <div className="space-y-4">
    {stories.map((s, i) => (
      <AccordionItem key={i} title={s.story} defaultOpen={i === 0}>
        <div className="space-y-3 p-2">
          <div>
            <h4 className="font-semibold text-slate-700">
              Acceptance Criteria
            </h4>
            <ul className="list-disc list-inside text-slate-600 mt-2 space-y-1">
              {s.acceptanceCriteria?.map((ac, idx) => (
                <li key={idx}>{ac}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-slate-700">User Actions</h4>
            <ul className="list-disc list-inside text-slate-600 mt-2 space-y-1">
              {s.actions?.map((action, idx) => (
                <li key={idx}>
                  When a user {action.trigger}, they are taken to the '
                  {action.target_screen}'.
                </li>
              ))}
            </ul>
          </div>
        </div>
      </AccordionItem>
    ))}
  </div>
);

const ScreensDisplay = ({ screens = [] }) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
    <table className="w-full text-left">
      <thead className="bg-slate-50 text-sm text-slate-600">
        <tr>
          <th className="p-4 font-semibold">Screen Name</th>
          <th className="p-4 font-semibold">Function</th>
          <th className="p-4 font-semibold">Associated Personas</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200">
        {screens.map((screen, i) => (
          <tr key={i}>
            <td className="p-4 font-medium text-slate-800">{screen.name}</td>
            <td className="p-4 text-slate-600">{screen.function}</td>
            <td className="p-4">
              <div className="flex flex-wrap gap-2">
                {screen.associatedPersonas?.map((persona, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 text-sm font-medium rounded-full bg-slate-200 text-slate-700"
                  >
                    {persona}
                  </span>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// --- Main Page Component ---

const ValidationPage = ({ requirements, onApprove, isLoading }) => {
  const [activeTab, setActiveTab] = useState("stories");

  // Display a loading spinner if requirements are not yet available.
  if (isLoading && !requirements) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
        <Loader className="animate-spin w-12 h-12 text-blue-500" />
        <p className="mt-4 text-slate-500 font-semibold text-lg">
          AI is analyzing requirements...
        </p>
        <p className="text-slate-400">This may take a moment.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">
            1. Requirement Validation
          </h2>
          <p className="text-slate-500 mt-2">
            The AI has generated the following software requirements. Please
            review and approve to proceed to the architecture planning phase.
          </p>
        </div>
        <span className="text-sm font-semibold text-green-600 bg-green-100 px-3 py-1 rounded-full flex items-center shrink-0 ml-4">
          <CheckCircle className="w-4 h-4 mr-2" />
          Analysis Complete
        </span>
      </div>

      <div className="border-b border-slate-200 mt-8">
        <nav className="flex space-x-2 -mb-px">
          <TabButton
            id="stories"
            label="User Stories"
            icon={BookOpen}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
          <TabButton
            id="personas"
            label="User Personas"
            icon={User}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
          <TabButton
            id="screens"
            label="Screens"
            icon={ScreenShare}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
        </nav>
      </div>
      <div className="bg-slate-50 p-6 md:p-8 rounded-b-xl border border-t-0 border-slate-200">
        {activeTab === "personas" && (
          <UserPersonasDisplay personas={requirements?.personas} />
        )}
        {activeTab === "stories" && (
          <UserStoriesDisplay stories={requirements?.userStories} />
        )}
        {activeTab === "screens" && (
          <ScreensDisplay screens={requirements?.screens} />
        )}
      </div>

      <div className="flex justify-end items-center mt-8 border-t pt-6">
        <button
          onClick={onApprove}
          disabled={isLoading}
          className="bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 shadow-sm disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center transition-all"
        >
          {isLoading ? (
            <Loader className="animate-spin w-5 h-5 mr-3" />
          ) : (
            <CheckCircle className="w-5 h-5 mr-3" />
          )}
          Approve Requirements & Plan Architecture
        </button>
      </div>
    </div>
  );
};

export default ValidationPage;
