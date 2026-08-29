const OVERRIDES: Record<string, string> = {
  "youtube-scraper": "YouTube Scraper",
  "upload-post" : "Upload/Post",
};

export function displayName(manifestId: string): string {
  const override = OVERRIDES[manifestId];
  if (override) return override;

  return manifestId
    .split("-")
    .map((word)=>word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
