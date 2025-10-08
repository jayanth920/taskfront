"use client";
import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import useSWR from "swr";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";

type Task = {
  id: string; // UUID
  title: string;
  column: "todo" | "inprogress" | "done" | "unsure";
  createdAt: number;
};

const COLUMNS: { id: Task["column"]; title: string }[] = [
  { id: "todo", title: "To Do" },
  { id: "inprogress", title: "In Progress" },
  { id: "done", title: "Done" },
  { id: "unsure", title: "Unsure" },
];

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
});

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function Board() {
  const { data, mutate } = useSWR<Task[]>("/tasks", fetcher);
  const [socketConnected, setSocketConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [newTitle, setNewTitle] = useState("");

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
            if (tasks.find((t) => t.id === msg.task.id)) return tasks;
            return [...tasks, msg.task];
          }, false);
          break;

        case "task_updated":
          mutate((tasks: Task[] = []) =>
            tasks.map((t) => (t.id === msg.task.id ? msg.task : t))
          );
          break;

        case "task_deleted":
          mutate((tasks: Task[] = []) => tasks.filter((t) => t.id !== msg.id));
          break;

        case "tasks_reorder":
          mutate((tasks: Task[] = []) => {
            // Only replace if different order
            const currentIds = tasks.map(t => t.id).join(",");
            const newIds = msg.tasks.map((t : Task) => t.id).join(",");
            return currentIds === newIds ? tasks : msg.tasks;
          }, false);
          break;
      }
    };

    return () => ws.close();
  }, [mutate]);

  // Group tasks by column
  const grouped: Record<string, Task[]> = {};
  (data || []).forEach((t) => {
    if (!grouped[t.column]) grouped[t.column] = [];
    grouped[t.column].push(t);
  });

  // Drag & Drop
  async function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;
    const srcCol = source.droppableId as Task["column"];
    const destCol = destination.droppableId as Task["column"];
    if (srcCol === destCol && source.index === destination.index) return;

    const srcTasks = Array.from(grouped[srcCol] || []);
    const destTasks = Array.from(grouped[destCol] || []);
    const [moved] = srcTasks.splice(source.index, 1);
    moved.column = destCol;
    destTasks.splice(destination.index, 0, moved);

    const newTasks: Task[] = [];
    COLUMNS.forEach((c) => {
      if (c.id === srcCol) newTasks.push(...srcTasks);
      else if (c.id === destCol) newTasks.push(...destTasks);
      else newTasks.push(...(grouped[c.id] || []));
    });

    // Optimistic UI
    mutate(newTasks, false);

    try {
      await api.put(`/tasks/${moved.id}`, { column: moved.column });
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "tasks_reorder", tasks: newTasks }));
      }
    } catch (err) {
      console.error("Failed to move task:", err);
    }
  }

  // CRUD
  async function createTask(e?: React.FormEvent) {
    e?.preventDefault();
    if (!newTitle.trim()) return;
    await api.post("/tasks", { title: newTitle.trim(), column: "todo" });
    setNewTitle(""); // let WS add the task
  }

  async function editTask(task: Task) {
    const newTitlePrompt = prompt("Edit task title", task.title);
    if (!newTitlePrompt) return;

    mutate((tasks: Task[] = []) =>
      tasks.map((t) => (t.id === task.id ? { ...t, title: newTitlePrompt } : t)), false
    );

    try {
      await api.put(`/tasks/${task.id}`, { title: newTitlePrompt });
    } catch (err) {
      console.error("Failed to edit task:", err);
    }
  }

  async function deleteTask(task: Task) {
    mutate((tasks: Task[] = []) => tasks.filter((t) => t.id !== task.id), false);

    try {
      await api.delete(`/tasks/${task.id}`);
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  }

  // Render
  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <form onSubmit={createTask} className="flex gap-2 w-full max-w-lg">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New task title"
            className="flex-1 px-3 py-2 border rounded text-black"
          />
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
            Add
          </button>
        </form>
        <div className="text-sm text-green-700">
          WS: {socketConnected ? "connected" : "disconnected"}
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {COLUMNS.map((col) => (
            <div key={col.id} className="bg-white p-3 rounded shadow-sm">
              <h2 className="font-semibold mb-2 text-purple-700">{col.title}</h2>
              <Droppable droppableId={col.id}>
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="min-h-[100px]">
                    {(grouped[col.id] || []).map((task, index) => (
                      <Draggable draggableId={task.id} index={index} key={task.id}>
                        {(prov) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            className="mb-2 p-2 rounded border bg-gray-50"
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div>
                                <div className="font-medium text-black">{task.title}</div>
                                <div className="text-xs text-gray-700">
                                  {new Date(task.createdAt).toLocaleString()}
                                </div>
                              </div>
                              <div className="flex gap-1">
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
