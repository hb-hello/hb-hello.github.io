// Parses the content macros of data/resume.tex (see the "Content macros"
// block in its preamble) into plain entry objects with HTML string fields.
// Anything outside the known macros fails loudly instead of being guessed at.

const ENTRY_ENVS = {
  job: ["title", "org", "location", "dates"],
  project: ["title", "org", "dates"],
  skills: [],
};
const IGNORED_ENVS = new Set(["center", "entries"]);

export class LatexError extends Error {}

// Parses the document body, or the whole file if it is a fragment without
// \begin{document} (like data/overflow.tex).
export function parseResume(src) {
  src = stripComments(src);
  const begin = src.indexOf("\\begin{document}");
  const end = src.indexOf("\\end{document}");
  const r = begin < 0
    ? new Reader(src, 0, src.length)
    : new Reader(src, begin + "\\begin{document}".length, end < 0 ? src.length : end);
  const entries = [];
  let section = null;

  while (!r.done()) {
    if (r.peek() !== "\\") { r.pos++; continue; }
    const at = r.pos;
    const cmd = r.readCommand();

    if (cmd === "section") {
      section = toHtml(r.readGroup(), r.lineAt(at));
    } else if (cmd === "education") {
      const id = r.readId(at, cmd);
      const [school, location, degree, dates] = r.readGroups(4).map((g) => toHtml(g, r.lineAt(at)));
      entries.push({ id, type: cmd, section, line: r.lineAt(at), title: degree, org: school, location, dates, bullets: [] });
    } else if (cmd === "begin") {
      const env = r.readGroup().trim();
      if (IGNORED_ENVS.has(env)) continue;
      if (!(env in ENTRY_ENVS)) throw new LatexError(`line ${r.lineAt(at)}: unsupported environment {${env}}`);
      entries.push({ id: r.readId(at, env), type: env, section, line: r.lineAt(at),
        ...readFields(r, ENTRY_ENVS[env], at), ...readEnvBody(r, env) });
    }
    // Other top-level commands (heading layout, \end{entries}, ...) are not content.
  }

  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.id)) throw new LatexError(`line ${e.line}: duplicate id [${e.id}]`);
    seen.add(e.id);
  }
  return entries;
}

function readFields(r, names, at) {
  const groups = r.readGroups(names.length);
  return Object.fromEntries(names.map((n, i) => [n, toHtml(groups[i], r.lineAt(at))]));
}

// Optional website-only fields inside a job/project: \name{...} -> field.
const FIELDS = {
  tech: { envs: ["job", "project"], parse: toHtml },
  repo: { envs: ["job", "project"], parse: toUrl },
  notes: { envs: ["job", "project"], parse: toUrl },
  location: { envs: ["project"], parse: toHtml },
};

function readEnvBody(r, env) {
  const bullets = [];
  const skills = [];
  const fields = {};
  for (;;) {
    r.skipSpace();
    if (r.done()) throw new LatexError(`unterminated \\begin{${env}}`);
    const at = r.pos;
    if (r.peek() !== "\\") throw new LatexError(`line ${r.lineAt(at)}: unexpected text inside {${env}}: "${r.excerpt()}"`);
    const cmd = r.readCommand();
    if (cmd === "end") {
      const name = r.readGroup().trim();
      if (name !== env) throw new LatexError(`line ${r.lineAt(at)}: \\end{${name}} inside {${env}}`);
      return env === "skills" ? { skills } : { ...fields, bullets };
    } else if (FIELDS[cmd]?.envs.includes(env)) {
      if (cmd in fields) throw new LatexError(`line ${r.lineAt(at)}: \\${cmd} given twice in {${env}}`);
      fields[cmd] = FIELDS[cmd].parse(r.readGroup(), r.lineAt(at));
    } else if (cmd === "resumeItem" && env !== "skills") {
      bullets.push(toHtml(r.readGroup(), r.lineAt(at)));
    } else if (cmd === "skill" && env === "skills") {
      const [category, items] = r.readGroups(2).map((g) => toHtml(g, r.lineAt(at)));
      skills.push({ category, items });
    } else {
      throw new LatexError(`line ${r.lineAt(at)}: unexpected \\${cmd} inside {${env}}`);
    }
  }
}

// Removes % comments while keeping newlines, so line numbers stay accurate.
function stripComments(src) {
  return src.replace(/(?<!\\)((?:\\\\)*)%.*$/gm, "$1");
}

class Reader {
  constructor(src, pos, end) {
    this.src = src;
    this.pos = pos;
    this.end = end;
  }
  done() { return this.pos >= this.end; }
  peek() { return this.src[this.pos]; }
  lineAt(pos) { return this.src.slice(0, pos).split("\n").length; }
  excerpt() { return this.src.slice(this.pos, this.pos + 40).split("\n")[0]; }
  skipSpace() { while (!this.done() && /\s/.test(this.peek())) this.pos++; }

  // At a backslash: returns the command name (letters, or a single symbol).
  readCommand() {
    this.pos++;
    const m = /^[a-zA-Z]+/.exec(this.src.slice(this.pos, this.pos + 64));
    const name = m ? m[0] : this.src[this.pos];
    this.pos += name.length;
    return name;
  }

  readDelimited(open, close) {
    this.skipSpace();
    if (this.peek() !== open) throw new LatexError(`line ${this.lineAt(this.pos)}: expected "${open}" at "${this.excerpt()}"`);
    const start = ++this.pos;
    let depth = 1;
    while (!this.done()) {
      const c = this.src[this.pos];
      if (c === "\\") { this.pos += 2; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) return this.src.slice(start, this.pos++);
      this.pos++;
    }
    throw new LatexError(`line ${this.lineAt(start)}: unbalanced "${open}"`);
  }

  readGroup() { return this.readDelimited("{", "}"); }
  readGroups(n) { return Array.from({ length: n }, () => this.readGroup()); }

  readId(at, what) {
    this.skipSpace();
    if (this.peek() !== "[") throw new LatexError(`line ${this.lineAt(at)}: {${what}} needs an [id]`);
    const id = this.readDelimited("[", "]").trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new LatexError(`line ${this.lineAt(at)}: bad id [${id}] (use lowercase letters, digits, -)`);
    return id;
  }
}

const SYMBOLS = { "%": "%", "&": "&amp;", "$": "$", "#": "#", "_": "_", "{": "{", "}": "}", "\\": "<br>", " ": " " };
const WRAPPERS = { textbf: "b", textit: "i", emph: "em", underline: "u" };

// Converts inline LaTeX to HTML. Throws on any command it doesn't know.
export function toHtml(tex, line = "?") {
  const r = new Reader(tex, 0, tex.length);
  let out = "";
  while (!r.done()) {
    const c = r.peek();
    if (c === "\\") {
      const cmd = r.readCommand();
      if (cmd in SYMBOLS) out += SYMBOLS[cmd];
      else if (cmd in WRAPPERS) out += `<${WRAPPERS[cmd]}>${toHtml(r.readGroup(), line)}</${WRAPPERS[cmd]}>`;
      else if (cmd === "textbar") { out += "|"; skipEmptyGroup(r); }
      else if (cmd === "href" || cmd === "resumeLink") {
        r.skipSpace();
        if (cmd === "resumeLink" && r.peek() === "[") r.readDelimited("[", "]"); // size: PDF only
        const url = r.readGroup();
        out += `<a href="${escapeHtml(url)}">${toHtml(r.readGroup(), line)}</a>`;
      } else if (cmd === "url") {
        const url = r.readGroup();
        out += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
      } else throw new LatexError(`line ${line}: unsupported inline command \\${cmd}`);
    } else if (c === "{") {
      out += toHtml(r.readGroup(), line);
    } else if (c === "~") {
      out += "&nbsp;"; r.pos++;
    } else if (tex.startsWith("---", r.pos)) {
      out += "—"; r.pos += 3;
    } else if (tex.startsWith("--", r.pos)) {
      out += "–"; r.pos += 2;
    } else if (tex.startsWith("``", r.pos) || tex.startsWith("''", r.pos)) {
      out += tex[r.pos] === "`" ? "“" : "”"; r.pos += 2;
    } else {
      out += escapeHtml(c); r.pos++;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

// A url argument: taken literally, apart from LaTeX-escaped characters.
function toUrl(tex) {
  return escapeHtml(tex.trim().replace(/\\([%#&_~$])/g, "$1"));
}

function skipEmptyGroup(r) {
  if (r.src.startsWith("{}", r.pos)) r.pos += 2;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
