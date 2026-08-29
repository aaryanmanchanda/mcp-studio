import { TooltipProvider } from "@/components/ui/tooltip";
import { Palette } from "@/palette/Palette";

function App() {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen bg-background">
        <Palette />

        {/* Canvas: filled in Plan 02-04 */}
        <div className="flex-1" />

        {/* Config panel: filled in Plan 02-06 */}
        <div className="w-[320px] shrink-0 border-l border-border bg-card" />
      </div>
    </TooltipProvider>
  );
}

export default App;
