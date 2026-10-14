import { useEffect, useRef } from "react";
import { useRunStore } from "@/run/runStore";
import { useGraphStore } from "@/store/graphStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Canvas } from "@/canvas/Canvas";
import { ConfigPanel } from "@/config-panel/ConfigPanel";
import { Palette } from "@/palette/Palette";

function App() {
  // once the node registry is in, restore the saved pipeline (and which credentials the vault holds)
  const registryStatus = useGraphStore((s) => s.registryStatus);
  const load = useRunStore((s) => s.load);
  const restored = useRef(false);
  useEffect(() => {
    if (registryStatus === "ready" && !restored.current) {
      restored.current = true;
      void load();
    }
  }, [registryStatus, load]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen bg-background">
        <Palette />

        <div className="flex-1">
          <Canvas />
        </div>

        <ConfigPanel />
      </div>
    </TooltipProvider>
  );
}

export default App;
