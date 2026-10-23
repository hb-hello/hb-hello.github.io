import { execFileSync } from "node:child_process";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({
    "src/assets": "assets",
    "src/styles": "styles",
    "src/js": "js",
    "src/data": "data",
  });

  // Dev server only: editing any data/*.tex runs the sync, which updates the
  // pages and, if resume.tex changed, the PDF.
  eleventyConfig.addWatchTarget("data/*.tex");
  eleventyConfig.on("eleventy.beforeWatch", (changedFiles) => {
    if (!changedFiles.some((f) => f.endsWith(".tex"))) return;
    try {
      execFileSync("node", ["scripts/sync-resume.js"], { stdio: "inherit" });
    } catch {
      console.error("[resume] sync failed; see output above");
    }
  });

  return {
    dir: { input: "src", includes: "_includes" },
    templateFormats: ["njk"],
  };
}
