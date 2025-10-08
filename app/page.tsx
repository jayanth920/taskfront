import Board from "./components/Board";
export default function Page() {
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4 text-cyan-500">Realtime Task Board</h1>
        <Board />
      </div>
    </main>
  );
}
