#!/usr/bin/env node
// Syncs entries from data/resume.tex and data/overflow.tex (entries kept off
// the PDF) into marked regions of src/**/*.njk. Ids are unique across both.
//
// A region starts with an opening marker that you write and own:
//
//   {# resume:intuit-swe-intern #}
//   {# resume:sbu-ra as=entry #}
//
// Everything between it and its closing {# /resume:<id> #} is regenerated
// (the closing marker is added if missing). `as` picks the component macro
// from src/_includes/components.njk (default: project for \begin{project},
// skills for \begin{skills}, entry otherwise); every other attribute is
// passed to the macro and overrides the field from the .tex, except
// `extra`: comma-separated ids whose bullets are appended to this entry's,
//
//   {# resume:zs-senior-de extra=zs-senior-de-more #}
//
// Then rebuilds src/assets/resume.pdf with tectonic if data/resume.tex is
// newer than it.
//
// Usage: node scripts/sync-resume.js [--check]
//   --check  write nothing and skip the PDF; exit 1 if any page would change

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseResume, LatexError } from "./lib/latex.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEX_FILES = ["data/resume.tex", "data/overflow.tex"];
const SRC = path.join(ROOT, "src");
const PDF_DIR = "src/assets";

const OPEN = /^([ \t]*)\{#\s*resume:([a-z0-9-]+)((?:\s+[\w-]+=(?:"[^"]*"|[^\s"#]+))*)\s*#\}\s*$/;
const CLOSE = /^[ \t]*\{#\s*\/resume:([a-z0-9-]+)\s*#\}\s*$/;
const ATTR = /([\w-]+)=(?:"([^"]*)"|([^\s"#]+))/g;
const DEFAULT_COMPONENT = { project: "project", skills: "skills" };

const check = process.argv.includes("--check");

const entries = new Map();
for (const file of TEX_FILES) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  try {
    for (const e of parseResume(fs.readFileSync(path.join(ROOT, file), "utf8"))) {
      const prev = entries.get(e.id);
      if (prev) throw new LatexError(`line ${e.line}: id [${e.id}] is already used in ${prev.file}:${prev.line}`);
      entries.set(e.id, { ...e, file });
    }
  } catch (err) {
    if (!(err instanceof LatexError)) throw err;
    console.error(`${file}: ${err.message}`);
    process.exit(1);
  }
}

const placed = new Set();
const errors = [];
const changed = [];

for (const file of findNjk(SRC)) {
  const rel = path.relative(ROOT, file);
  const before = fs.readFileSync(file, "utf8");
  const after = syncFile(before, rel);
  if (after !== before) {
    changed.push(rel);
    if (!check) fs.writeFileSync(file, after);
  }
}

for (const e of errors) console.error(`error: ${e}`);
for (const f of changed) console.log(`${check ? "out of date" : "updated"}: ${f}`);
const unplaced = [...entries.keys()].filter((id) => !placed.has(id));
if (unplaced.length) console.log(`not on the site: ${unplaced.join(", ")}`);
if (!changed.length && !errors.length) console.log("up to date");
const pdfFailed = !check && !buildPdf();
process.exit(errors.length || pdfFailed || (check && changed.length) ? 1 : 0);

// Returns false if tectonic failed.
function buildPdf() {
  const tex = path.join(ROOT, TEX_FILES[0]);
  const pdf = path.join(ROOT, PDF_DIR, "resume.pdf");
  if (fs.existsSync(pdf) && fs.statSync(pdf).mtimeMs >= fs.statSync(tex).mtimeMs) {
    console.log("pdf: up to date");
    return true;
  }
  console.log(`pdf: building ${PDF_DIR}/resume.pdf`);
  const res = spawnSync("tectonic", ["--chatter", "minimal", "-o", PDF_DIR, TEX_FILES[0]], { cwd: ROOT, stdio: "inherit" });
  if (res.status === 0) return true;
  console.error(res.error ? `error: could not run tectonic: ${res.error.message}` : "error: tectonic failed; see output above");
  return false;
}

function syncFile(text, rel) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]);
    out.push(lines[i]);
    if (!open) continue;

    const [, indent, id, attrText] = open;
    const close = findClose(lines, i + 1, id);
    const entry = entries.get(id);
    if (!entry) {
      errors.push(`${rel}:${i + 1}: no entry [${id}] in ${TEX_FILES.join(" or ")}`);
      continue;
    }
    const { extra = "", ...attrs } = parseAttrs(attrText);
    const extras = extra.split(",").filter(Boolean).map((x) => [x, entries.get(x)]);
    for (const [x, e] of extras) if (!e) errors.push(`${rel}:${i + 1}: no entry [${x}] for extra=`);
    if (extras.some(([, e]) => !e)) continue;
    for (const x of [id, ...extras.map(([x]) => x)]) placed.add(x);
    const bullets = [...entry.bullets, ...extras.flatMap(([, e]) => e.bullets)];
    out.push(...render({ ...entry, bullets }, attrs).map((l) => (l ? indent + l : l)));
    out.push(`${indent}{# /resume:${id} #}`);
    if (close >= 0) i = close;
  }
  return out.join("\n");
}

// Index of the matching closing marker, or -1 if another opening marker
// (or the end of file) comes first.
function findClose(lines, from, id) {
  for (let j = from; j < lines.length; j++) {
    if (OPEN.test(lines[j])) return -1;
    const m = CLOSE.exec(lines[j]);
    if (m) return m[1] === id ? j : -1;
  }
  return -1;
}

function parseAttrs(text) {
  return Object.fromEntries([...text.matchAll(ATTR)].map((m) => [m[1], m[2] ?? m[3]]));
}

function render(entry, attrs) {
  const { as = DEFAULT_COMPONENT[entry.type] ?? "entry", ...overrides } = attrs;
  const props = { ...pick(entry, ["title", "org", "location", "dates", "tech", "repo", "notes"]), ...overrides };
  const items = entry.type === "skills"
    ? entry.skills.map((s) => `<b>${s.category}</b>: ${s.items}`)
    : entry.bullets;
  return [
    `{% call ui.${as}({`,
    ...Object.entries(props).map(([k, v], i, all) => `    ${k}: ${JSON.stringify(v)}${i < all.length - 1 ? "," : ""}`),
    "}) %}",
    ...items.map((item) => `    <li>${item}</li>`),
    "{% endcall %}",
  ];
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

function* findNjk(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* findNjk(p);
    else if (d.name.endsWith(".njk")) yield p;
  }
}
