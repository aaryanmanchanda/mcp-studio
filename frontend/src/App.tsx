import { TooltipProvider } from "@/components/ui/tooltip";
import { Canvas } from "@/canvas/Canvas";
import { Palette } from "@/palette/Palette";

function App() {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen bg-background">
        <Palette />

        <div className="flex-1">
          <Canvas />
        </div>

        {/* Config panel: filled in Plan 02-06 */}
        <div className="w-[320px] shrink-0 border-l border-border bg-card" />
      </div>
    </TooltipProvider>
  );
}

export default App;
