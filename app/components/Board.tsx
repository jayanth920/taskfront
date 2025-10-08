"use client";
import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import useSWR from "swr";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";

type Task = {
  id: string; // UUID
  title: string;
  description?: string;
  column: "todo" | "inprogress" | "done" | "unsure";
  createdAt: number;
  order: number; // Added order field
};

const COLUMNS: { id: Task["column"]; title: string }[] = [
  { id: "todo", title: "To Do" },
  { id: "inprogress", title: "In Progress" },
  { id: "done", title: "Done" },
  { id: "unsure", title: "Unsure" },
];

const AUTH_TOKEN = process.env.NEXT_PUBLIC_AUTH_TOKEN || "supersecret";
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
});

const fetcher = (url: string) => api.get(url).then(r => r.data);

export default function Board() {
  const { data, mutate } = useSWR<Task[]>("/tasks", fetcher);
  const [socketConnected, setSocketConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // WebSocket
  useEffect(() => {
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL || window.location.origin.replace(/^http/, "ws");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setSocketConnected(true);
    ws.onclose = () => setSocketConnected(false);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case "init":
          mutate(msg.tasks, false);
          break;
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
  }, [mutate]);

  // Group tasks by column and sort by order
  const grouped: Record<string, Task[]> = {};
  (data || []).forEach(t => {
    if (!grouped[t.column]) grouped[t.column] = [];
    grouped[t.column].push(t);
  });

  // Sort each column by order
  Object.keys(grouped).forEach(column => {
    grouped[column].sort((a, b) => a.order - b.order);
  });

  // Drag & Drop
  async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const srcCol = source.droppableId as Task["column"];
    const destCol = destination.droppableId as Task["column"];
    const srcIndex = source.index;
    const destIndex = destination.index;

    if (srcCol === destCol && srcIndex === destIndex) return;

    // Create a copy of current tasks for optimistic update
    const tasks = [...(data || [])];
    const movedTask = tasks.find(t => t.id === draggableId);
    if (!movedTask) return;

    // Remove from source
    const sourceTasks = tasks.filter(t => t.column === srcCol).sort((a, b) => a.order - b.order);
    const destTasks = tasks.filter(t => t.column === destCol).sort((a, b) => a.order - b.order);

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
        const colTasks = tasks.filter(t => t.column === col.id).sort((a, b) => a.order - b.order);
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
          tasks: updatedTasks
        }));
      }
    } catch (err) {
      console.error("Failed to reorder tasks:", err);
      // Revert optimistic update on error
      mutate();
    }
  }

  // CRUD
  async function createTask(e?: React.FormEvent) {
    e?.preventDefault();
    if (!newTitle.trim()) return;
    let data = {
      title: newTitle.trim(),
      description: newDescription.trim() || undefined,
      column: "todo",
    }
    await api.post("/tasks", data);
    setNewTitle("");
    setNewDescription("");
  }

  async function editTask(task: Task) {
    const newTitlePrompt = prompt("Edit task title", task.title);
    if (!newTitlePrompt) return;

    mutate((tasks: Task[] = []) =>
      tasks.map(t => (t.id === task.id ? { ...t, title: newTitlePrompt } : t)), false
    );

    try {
      await api.put(`/tasks/${task.id}`, { title: newTitlePrompt });
    } catch (err) {
      console.error("Failed to edit task:", err);
    }
  }

  async function deleteTask(task: Task) {
    mutate((tasks: Task[] = []) => tasks.filter(t => t.id !== task.id), false);
    try {
      await api.delete(`/tasks/${task.id}`);
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 md:flex-row items-start md:items-center">
        <form onSubmit={createTask} className="flex gap-2 w-full max-w-lg">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="New task title"
            className="flex-1 px-3 py-2 border rounded text-black"
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="flex-1 px-3 py-2 border rounded text-black"
          />
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
            Add
          </button>
        </form>
        <div className="text-sm text-green-700 mt-2 md:mt-0">
          WS: {socketConnected ? "connected" : "disconnected"}
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {COLUMNS.map(col => (
            <div key={col.id} className="bg-white p-3 rounded shadow-sm">
              <h2 className="font-semibold mb-2 text-purple-700">{col.title}</h2>
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`min-h-[100px] ${snapshot.isDraggingOver ? 'bg-blue-50' : ''}`}
                  >
                    {(grouped[col.id] || []).map((task, index) => (
                      <Draggable draggableId={task.id} index={index} key={task.id}>
                        {(prov, snapshot) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            className={`mb-2 p-2 rounded border ${
                              snapshot.isDragging ? 'bg-blue-100 shadow-md' : 'bg-gray-50'
                            }`}
                          >
                            <div className="flex flex-col gap-1">
                              <div className="font-medium text-black">{task.title}</div>
                              {task.description && (
                                <div className="text-sm text-gray-600">{task.description}</div>
                              )}
                              <div className="text-xs text-gray-700">
                                {new Date(task.createdAt).toLocaleString()}
                              </div>
                              <div className="flex gap-1 mt-1">
                                <button
                                  className="text-xs px-2 py-1 rounded border text-blue-600"
                                  onClick={() => editTask(task)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="text-xs px-2 py-1 rounded border text-red-600"
                                  onClick={() => deleteTask(task)}
                                >
                                  Del
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