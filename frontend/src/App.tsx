import { TooltipProvider } from "@/components/ui/tooltip";
import { Canvas } from "@/canvas/Canvas";
import { ConfigPanel } from "@/config-panel/ConfigPanel";
import { Palette } from "@/palette/Palette";

function App() {
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
