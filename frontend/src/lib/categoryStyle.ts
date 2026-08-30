import { Cog, Download, RefreshCw, Upload, type LucideIcon } from "lucide-react";

// The four node categories, in the fixed order the palette renders them (UI-SPEC D-03).
export const CATEGORIES = ["Sources", "Processing", "Convert", "Sinks"] as const;
export type Category = (typeof CATEGORIES)[number];

// Category -> CSS custom property declared in index.css (@theme inline).
// Shared by the palette rows/headers and the canvas node card's stripe + icon.
export const CATEGORY_COLOR: Record<string, string> = {
  Sources: "var(--color-category-sources)",
  Processing: "var(--color-category-processing)",
  Convert: "var(--color-category-convert)",
  Sinks: "var(--color-category-sinks)",
};

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  Sources: Download,
  Processing: Cog,
  Convert: RefreshCw,
  Sinks: Upload,
};
