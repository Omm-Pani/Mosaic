// =================================================================================
// File:         frontend_ui/src/pages/PlanningPage.js
// Version:      2.0 (Mosaic 2.0)
//
// Purpose:      This page displays the final execution plan. Its primary feature
//               is the visualization of the `work_graph.json` as a Directed
//               Acyclic Graph (DAG) using React Flow.
//
// V2.0 Change:  - The `planToFlow` helper function has been completely rewritten
//                 to parse the new `work_graph.json` structure.
//               - It now creates a node for each task in the graph and draws
//                 edges based on the `dependsOn` array, accurately visualizing
//                 the build dependencies.
// =================================================================================

import React, { useMemo } from "react";
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { Loader, CheckCircle, GitFork, FileCode } from "lucide-react";

// --- DAG Visualization Logic ---

// Helper function to transform the work_graph into nodes and edges for React Flow
const planToFlow = (plan) => {
  if (!plan?.work_graph?.nodes) return { nodes: [], edges: [] };

  const { nodes: graphNodes } = plan.work_graph;
  const nodes = [];
  const edges = [];

  // Use a simple layout algorithm (e.g., layered)
  const levels = {};
  const nodeMap = new Map(graphNodes.map((n) => [n.id, { ...n, level: -1 }]));

  // Basic topological sort to determine levels
  function assignLevel(nodeId, level) {
    const node = nodeMap.get(nodeId);
    if (node.level >= level) return;
    node.level = level;
    node.dependsOn.forEach((depId) => assignLevel(depId, level - 1));
  }
  graphNodes.forEach((n) => {
    if (n.dependsOn.length === 0) assignLevel(n.id, 0);
  });
  graphNodes.forEach((n) => assignLevel(n.id, n.level > -1 ? n.level : 1));

  nodeMap.forEach((node) => {
    if (!levels[node.level]) levels[node.level] = [];
    levels[node.level].push(node.id);
  });

  // Create React Flow nodes with positions
  Object.entries(levels).forEach(([level, ids]) => {
    ids.forEach((id, index) => {
      nodes.push({
        id,
        data: {
          label: (
            <div className="flex items-center">
              <FileCode size={14} className="mr-2 flex-shrink-0" />
              <span>{id}</span>
            </div>
          ),
        },
        position: { x: parseInt(level) * 250, y: index * 80 },
        style: {
          background: "#ffffff",
          borderColor: "#3b82f6",
          borderWidth: 1,
          padding: "10px 15px",
        },
      });
    });
  });

  // Create React Flow edges
  graphNodes.forEach((node) => {
    node.dependsOn.forEach((depId) => {
      edges.push({
        id: `e-${depId}-${node.id}`,
        source: depId,
        target: node.id,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
        style: { stroke: "#93c5fd" },
      });
    });
  });

  return { nodes, edges };
};

const PlanningPage = ({ plan, onApprove, isLoading }) => {
  // Memoize the flow data to prevent recalculation on every render
  const flowData = useMemo(() => planToFlow(plan), [plan]);

  if (isLoading && !plan) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
        <Loader className="animate-spin w-12 h-12 text-blue-500" />
        <p className="mt-4 text-slate-500 font-semibold text-lg">
          AI architect is generating the build plan...
        </p>
        <p className="text-slate-400">
          This includes all specs and the dependency graph.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in h-full flex flex-col">
      <div className="shrink-0">
        <h2 className="text-3xl font-bold text-slate-800">
          2. Execution Plan & Dependency Graph
        </h2>
        <p className="text-slate-500 mt-2 mb-6">
          The AI has generated the following dependency graph
          (`work_graph.json`). Tasks will be executed in parallel when their
          dependencies are met. Review and approve to begin the build.
        </p>
      </div>

      <div className="border bg-white rounded-xl p-4 shadow-sm flex-grow">
        <div className="w-full h-full bg-slate-50 rounded-lg border">
          <ReactFlow
            nodes={flowData.nodes}
            edges={flowData.edges}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap nodeStrokeWidth={3} zoomable pannable />
            <Controls />
            <Background color="#e2e8f0" gap={16} />
          </ReactFlow>
        </div>
      </div>

      <div className="flex justify-end items-center mt-8 border-t pt-6 shrink-0">
        <button
          onClick={onApprove}
          disabled={!plan || isLoading}
          className="bg-green-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-green-700 shadow-sm disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center transition-all"
        >
          {isLoading ? (
            <>
              <Loader className="animate-spin w-5 h-5 mr-3" /> Queuing Build...
            </>
          ) : (
            <>
              <CheckCircle className="w-5 h-5 mr-3" /> Approve & Build Project
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default PlanningPage;
