// frontend/components/Board.tsx
"use client";
import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import useSWR from "swr";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { useAuth } from "../contexts/AuthContext";

type Task = {
  id: string;
  title: string;
  description?: string;
  column: "todo" | "inprogress" | "done" | "unsure";
  createdAt: number;
  order: number;
  boardId: string;
};

type BoardType = {
  id: string;
  name: string;
  teamId: string | null;
  ownerId: string;
  isPersonal: boolean;
  createdAt: number;
};

const COLUMNS = [
  { id: "todo", title: "To Do" },
  { id: "inprogress", title: "In Progress" },
  { id: "done", title: "Done" },
  { id: "unsure", title: "Unsure" },
];

// Create axios instance with auth
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const fetcher = (url: string) => api.get(url).then(r => r.data);

interface BoardProps {
  boardId: string;
  onBack: () => void;
}

export default function Board({ boardId, onBack }: BoardProps) {
  const { user } = useAuth();
  const { data: tasks, mutate } = useSWR<Task[]>(`/boards/${boardId}/tasks`, fetcher);
  const { data: board } = useSWR<BoardType>(`/boards/${boardId}`, fetcher);
  
  const [socketConnected, setSocketConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // WebSocket - Simplified like your original
  useEffect(() => {
    const token = localStorage.getItem('token');
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    
    const ws = new WebSocket(`${wsUrl}?token=${token}&boardId=${boardId}`);
    wsRef.current = ws;

    ws.onopen = () => setSocketConnected(true);
    ws.onclose = () => setSocketConnected(false);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      // Only process messages for this board
      if (msg.boardId && msg.boardId !== boardId) return;

      switch (msg.type) {
        case "task_created":
          mutate((tasks: Task[] = []) => {
            if (tasks.find(t => t.id === msg.task.id)) return tasks;
            return [...tasks, msg.task];
          }, false);
          break;
        case "task_updated":
          mutate((tasks: Task[] = []) =>
            tasks.map(t => (t.id === msg.task.id ? msg.task : t))
          );
          break;
        case "task_deleted":
          mutate((tasks: Task[] = []) => tasks.filter(t => t.id !== msg.id), false);
          break;
        case "tasks_reorder":
          mutate((tasks: Task[] = []) => {
            const currentIds = tasks.map(t => t.id).join(",");
            const newIds = msg.tasks.map((t: Task) => t.id).join(",");
            return currentIds === newIds ? tasks : msg.tasks;
          }, false);
          break;
      }
    };

    return () => ws.close();
  }, [boardId, mutate]);

  // Group tasks by column and sort by order - Same as your original
  const grouped: Record<string, Task[]> = {};
  (tasks || []).forEach(t => {
    if (!grouped[t.column]) grouped[t.column] = [];
    grouped[t.column].push(t);
  });

  // Sort each column by order
  Object.keys(grouped).forEach(column => {
    grouped[column].sort((a, b) => a.order - b.order);
  });

  // Drag & Drop - Same as your original working version
  async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const srcCol = source.droppableId as Task["column"];
    const destCol = destination.droppableId as Task["column"];
    const srcIndex = source.index;
    const destIndex = destination.index;

    if (srcCol === destCol && srcIndex === destIndex) return;

    // Create a copy of current tasks for optimistic update
    const currentTasks = [...(tasks || [])];
    const movedTask = currentTasks.find(t => t.id === draggableId);
    if (!movedTask) return;

    // Remove from source
    const sourceTasks = currentTasks.filter(t => t.column === srcCol).sort((a, b) => a.order - b.order);
    const destTasks = currentTasks.filter(t => t.column === destCol).sort((a, b) => a.order - b.order);

    // Remove from source array
    sourceTasks.splice(srcIndex, 1);

    // Update orders in source column
    sourceTasks.forEach((task, index) => {
      task.order = index;
    });

    // Insert into destination
    if (srcCol === destCol) {
      // Same column reordering
      sourceTasks.splice(destIndex, 0, movedTask);
      // Re-number all tasks in this column
      sourceTasks.forEach((task, index) => {
        task.order = index;
      });
    } else {
      // Different column move
      movedTask.column = destCol;
      destTasks.splice(destIndex, 0, movedTask);
      // Re-number both columns
      sourceTasks.forEach((task, index) => {
        task.order = index;
      });
      destTasks.forEach((task, index) => {
        task.order = index;
      });
    }

    // Create the new tasks array with updated orders
    const updatedTasks: Task[] = [];
    COLUMNS.forEach(col => {
      if (col.id === srcCol) {
        updatedTasks.push(...sourceTasks);
      } else if (col.id === destCol) {
        updatedTasks.push(...destTasks);
      } else {
        const colTasks = currentTasks.filter(t => t.column === col.id).sort((a, b) => a.order - b.order);
        updatedTasks.push(...colTasks);
      }
    });

    // Optimistic update
    mutate(updatedTasks, false);

    try {
      // Send reorder command via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "reorder",
          tasks: updatedTasks,
          boardId
        }));
      } else {
        // Fallback: Update via HTTP
        await api.put(`/tasks/${movedTask.id}`, { 
          column: movedTask.column, 
          order: movedTask.order 
        });
      }
    } catch (err) {
      console.error("Failed to reorder tasks:", err);
      mutate(); // Re-fetch on error
    }
  }

  // CRUD Operations - Simplified
  async function createTask(e?: React.FormEvent) {
    e?.preventDefault();
    if (!newTitle.trim()) return;
    
    try {
      await api.post(`/boards/${boardId}/tasks`, {
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        column: "todo",
      });
      setNewTitle("");
      setNewDescription("");
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  }

  async function editTask(task: Task) {
    const newTitlePrompt = prompt("Edit task title", task.title);
    if (!newTitlePrompt?.trim()) return;

    try {
      await api.put(`/tasks/${task.id}`, { title: newTitlePrompt.trim() });
    } catch (err) {
      console.error("Failed to edit task:", err);
    }
  }

  async function deleteTask(task: Task) {
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      await api.delete(`/tasks/${task.id}`);
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  }

  if (!board) {
    return (
      <div className="p-4">
        <button onClick={onBack} className="mb-4 px-4 py-2 bg-gray-600 text-white rounded">
          ← Back to Boards
        </button>
        <div>Loading board...</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="px-4 py-2 bg-gray-600 text-white rounded">
            ← Back
          </button>
          <h1 className="text-2xl font-bold">{board.name}</h1>
          <span className="text-sm text-gray-600">
            {board.isPersonal ? 'Personal Board' : 'Team Board'}
          </span>
        </div>
        <div className="text-sm">
          <span className={`px-2 py-1 rounded ${socketConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {socketConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Add Task Form */}
      <div className="mb-6 p-4 bg-white rounded-lg shadow">
        <form onSubmit={createTask} className="flex flex-col md:flex-row gap-3">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="New task title"
            className="flex-1 px-3 py-2 border rounded text-black"
            required
          />
          <input
            value={newDescription}
            onChange={e => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="flex-1 px-3 py-2 border rounded text-black"
          />
          <button 
            type="submit" 
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={!newTitle.trim()}
          >
            Add Task
          </button>
        </form>
      </div>

      {/* Board Columns */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {COLUMNS.map(col => (
            <div key={col.id} className="bg-gray-50 p-4 rounded-lg shadow">
              <h2 className="font-semibold mb-3 text-lg text-gray-800 border-b pb-2">
                {col.title} ({grouped[col.id]?.length || 0})
              </h2>
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`min-h-[200px] transition-colors ${
                      snapshot.isDraggingOver ? 'bg-blue-50' : ''
                    }`}
                  >
                    {(grouped[col.id] || []).map((task, index) => (
                      <Draggable draggableId={task.id} index={index} key={task.id}>
                        {(prov, snapshot) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            className={`mb-3 p-3 rounded border transition-shadow ${
                              snapshot.isDragging 
                                ? 'bg-white shadow-lg border-blue-300' 
                                : 'bg-white hover:shadow-md border-gray-200'
                            }`}
                          >
                            <div className="flex flex-col gap-2">
                              <div className="font-medium text-gray-900">{task.title}</div>
                              {task.description && (
                                <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                                  {task.description}
                                </div>
                              )}
                              <div className="text-xs text-gray-500">
                                Created: {new Date(task.createdAt).toLocaleDateString()}
                              </div>
                              <div className="flex gap-2 mt-2">
                                <button
                                  className="text-xs px-3 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50"
                                  onClick={() => editTask(task)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="text-xs px-3 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50"
                                  onClick={() => deleteTask(task)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}