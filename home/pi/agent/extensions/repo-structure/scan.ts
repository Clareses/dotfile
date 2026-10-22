/**
 * repo-structure / scan.ts
 *
 * 纯函数：扫描一个仓库的"可观察结构"，产出紧凑摘要 / AGENTS.md 脚手架。
 * 不依赖任何外部命令（不 shell 出去跑 ls/find），因此结果稳定、便宜。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

const IGNORE_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", ".next", ".nuxt", ".output",
  ".venv", "venv", "env", "__pycache__", ".cache", ".turbo", ".parcel-cache", "coverage",
  "vendor", "Pods", ".gradle", ".dart_tool", ".idea", ".vscode", ".terraform",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", ".scala-build", ".metals", ".bsp",
]);

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "c", "cc", "cpp", "cxx", "h", "hpp",
  "java", "kt", "kts", "swift", "rb", "php", "cs", "scala", "sh", "fish", "lua", "vue", "svelte",
  "ex", "exs", "dart", "clj", "hs", "ml", "r", "jl", "pl", "zig",
  "qml", "css", "scss", "sass", "less", "html", "htm",
]);

const MARKERS: Array<[string, string]> = [
  ["package.json", "Node/JS"],
  ["pnpm-workspace.yaml", "pnpm workspace"],
  ["turbo.json", "Turborepo"],
  ["nx.json", "Nx"],
  ["lerna.json", "Lerna"],
  ["tsconfig.json", "TypeScript"],
  ["Cargo.toml", "Rust/Cargo"],
  ["pyproject.toml", "Python"],
  ["setup.py", "Python"],
  ["requirements.txt", "Python"],
  ["go.mod", "Go modules"],
  ["pom.xml", "Maven"],
  ["build.gradle", "Gradle"],
  ["build.gradle.kts", "Gradle"],
  ["CMakeLists.txt", "CMake"],
  ["Makefile", "Make"],
  ["meson.build", "Meson"],
  ["composer.json", "PHP/Composer"],
  ["Gemfile", "Ruby/Bundler"],
  ["flake.nix", "Nix"],
  ["Dockerfile", "Docker"],
  ["docker-compose.yml", "Docker Compose"],
  ["compose.yaml", "Docker Compose"],
];

const DOC_HINTS = [
  "README.md", "README.MD", "README", "CONTRIBUTING.md", "ARCHITECTURE.md", "DESIGN.md",
  "CHANGELOG.md", "LICENSE", "LICENSE.md", ".editorconfig", ".gitignore",
];

export interface RepoScan {
  root: string;
  files: number;
  dirs: number;
  byExt: Array<[string, number]>;
  topLevel: Array<{ name: string; kind: "dir" | "file"; files: number }>;
  dirFileCounts: Array<{ dir: string; files: number; code: number }>;
  markers: string[];
  docs: string[];
  existingAgents: string[];
}

export interface ScanOptions {
  maxDepth?: number;
  ignore?: string[];
}

function readRootGitignore(root: string): Set<string> {
  const out = new Set<string>();
  const p = join(root, ".gitignore");
  if (!existsSync(p)) return out;
  try {
    for (const raw of readFileSync(p, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      // 只采纳"简单名字"，避免误解析 glob
      if (line.includes("/") || line.includes("*")) continue;
      out.add(line);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function listDir(dir: string): Array<{ name: string; isDir: boolean }> {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.isSymbolicLink())
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
}

export function scanRepo(root: string, opts: ScanOptions = {}): RepoScan {
  const maxDepth = opts.maxDepth && opts.maxDepth > 0 ? Math.min(opts.maxDepth, 8) : 4;
  const ignore = new Set<string>([...IGNORE_DIRS, ...(opts.ignore ?? []), ...readRootGitignore(root)]);

  const extCount = new Map<string, number>();
  const dirCounts = new Map<string, { files: number; code: number }>();
  const topCount = new Map<string, number>();
  let files = 0;
  let dirs = 0;

  function bump(relDir: string, ext: string) {
    const cur = dirCounts.get(relDir) ?? { files: 0, code: 0 };
    cur.files += 1;
    if (CODE_EXT.has(ext)) cur.code += 1;
    dirCounts.set(relDir, cur);
    if (relDir !== ".") {
      const top = relDir.split(sep)[0];
      topCount.set(top, (topCount.get(top) ?? 0) + 1);
    }
  }

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    for (const entry of listDir(dir)) {
      if (entry.isDir) {
        if (ignore.has(entry.name)) continue;
        dirs += 1;
        walk(join(dir, entry.name), depth + 1);
      } else {
        files += 1;
        const ext = extname(entry.name).slice(1).toLowerCase();
        if (ext) extCount.set(ext, (extCount.get(ext) ?? 0) + 1);
        const relDir = relative(root, dir) || ".";
        bump(relDir, ext);
      }
    }
  }

  walk(root, 1);

  const topLevel = listDir(root).map((e) => {
    if (!e.isDir) return { name: e.name, kind: "file" as const, files: 0 };
    return { name: e.name, kind: "dir" as const, files: topCount.get(e.name) ?? 0 };
  });

  const markers: string[] = [];
  for (const [file, label] of MARKERS) {
    if (existsSync(join(root, file))) markers.push(`${file} → ${label}`);
  }
  if (existsSync(join(root, ".github", "workflows"))) markers.push(".github/workflows → CI");
  // glob-ish markers
  const topNames = new Set(listDir(root).map((e) => e.name));
  for (const n of topNames) {
    if (n.endsWith(".csproj") || n.endsWith(".sln")) markers.push(`${n} → .NET`);
  }

  const docs = DOC_HINTS.filter((f) => existsSync(join(root, f)));
  if (existsSync(join(root, "docs"))) docs.push("docs/");

  const existingAgents = ["AGENTS.md", "CLAUDE.md", "AGENTS.override.md"].filter((f) =>
    existsSync(join(root, f)),
  );

  const byExt = [...extCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const dirFileCounts = [...dirCounts.entries()]
    .filter(([d]) => d !== ".")
    .map(([dir, c]) => ({ dir, files: c.files, code: c.code }))
    .sort((a, b) => b.code - a.code || b.files - a.files);

  return { root, files, dirs, byExt, topLevel, dirFileCounts, markers, docs, existingAgents };
}

function codeFence(lines: string[]): string {
  return lines.map((l) => "  " + l).join("\n");
}

export function renderDigest(scan: RepoScan): string {
  const L: string[] = [];
  L.push(`# Repo structure — ${basename(scan.root)}`);
  L.push("");
  L.push(`- root: \`${scan.root}\``);
  L.push(`- files: **${scan.files}**, dirs: **${scan.dirs}**`);
  if (scan.markers.length) L.push(`- stack/build: ${scan.markers.join(", ")}`);
  if (scan.existingAgents.length) L.push(`- 已有 agent 文档: ${scan.existingAgents.join(", ")}`);
  L.push("");
  L.push("## Top level");
  for (const e of scan.topLevel) {
    L.push(e.kind === "dir" ? `- \`${e.name}/\`  (${e.files} files)` : `- \`${e.name}\``);
  }
  if (scan.byExt.length) {
    L.push("");
    L.push("## 文件类型");
    L.push(scan.byExt.map(([e, n]) => `\`${e}\`×${n}`).join(", "));
  }
  const bigDirs = scan.dirFileCounts.filter((d) => d.code >= 5).slice(0, 12);
  if (bigDirs.length) {
    L.push("");
    L.push("## 代码量较大的目录（候选作用域）");
    for (const d of bigDirs) L.push(`- \`${d.dir}/\`  (${d.code} code / ${d.files} files)`);
  }
  if (scan.docs.length) {
    L.push("");
    L.push(`## 文档: ${scan.docs.join(", ")}`);
  }
  return L.join("\n");
}

/** 生成 AGENTS.md 的分层脚手架（root + 候选作用域），供模型据此完善。 */
export function renderAgentsPlan(scan: RepoScan): string {
  const scoped = scan.dirFileCounts
    .filter((d) => d.code >= 5)
    .filter((d) => !/(^|\/)(test|tests|__tests__|spec|fixtures?|mocks?|examples?)(\/|$)/.test(d.dir))
    .slice(0, 8);

  const L: string[] = [];
  L.push(`# AGENTS.md 分层方案 — ${basename(scan.root)}`);
  L.push("");
  L.push("> 机械骨架（由 repo_structure 生成）。请按下面的清单，用判断填充内容，**删掉用不上的小节**。");
  L.push("");
  L.push("## 1) 根 AGENTS.md（只放「处处皆真」的东西）");
  L.push("```markdown");
  L.push(codeFence([
    "# <项目名> — 全局 agent 指令",
    "",
    "一句话说明这是什么（语言/框架/构建系统）。下面是处处皆真的内容；",
    "各子系统的细节在各自目录的 AGENTS.md，进入该目录工作前先读它。",
    "",
    "## 部署 / 运行 / 测试（命令胜过描述）",
    "- <build> / <test> / <lint> / <run>",
    "",
    "## 安全红线",
    "- <绝不提交密钥 / 危险操作需确认 …>",
    "",
    "## 作用域（子目录的 AGENTS.md）",
    ...scoped.map((d) => `- \`${d.dir}/\``),
    "",
    "## 约定",
    "- <提交信息 / 代码风格 / 引用名字而非行号>",
  ]));
  L.push("```");
  L.push("");
  L.push("## 2) 候选作用域文件（进入该目录才读）");
  if (scoped.length === 0) {
    L.push("- （未发现代码集中的子目录；视情况只保留根文件）");
  } else {
    for (const d of scoped) {
      L.push(`### \`${d.dir}/AGENTS.md\``);
      L.push("```markdown");
      L.push(codeFence([
        `# ${d.dir} — 作用域指令`,
        "",
        "根 `../AGENTS.md` 仍然适用。这里只写本目录**从代码里看不出来**的东西。",
        "",
        "## 结构",
        "- <关键文件/入口>",
        "",
        "## 约定",
        "- <本目录特有规矩>",
        "",
        "## 陷阱（踩过的坑）",
        "- <那些「代码告诉不了你」的事>",
      ]));
      L.push("```");
      L.push("");
    }
  }
  L.push("## 3) 检查清单（写之前逐个过一遍）");
  L.push("- **Scope > Prompts**：能放进子目录作用域的，别堆在根文件。");
  L.push("- **Pointer > Prose**：已有权威文档就**指过去**，别抄副本。");
  L.push("- **Tool > Prompts**：能用命令/工具强制的，就别写成「请你小心」。");
  L.push("- **Lazy > Always**：长知识放按需加载处（skill/文档），别常驻。");
  L.push("- **Trigger > Memory**：该不该带某段指引，交给「改了什么文件」决定。");
  L.push("- **只写陷阱**：代码能告诉你的不要写；引用**名字/revision**，别写行号。");
  const docs = scan.docs.filter((d) => d === "docs/" || d.startsWith("README") || d.includes("CONTRIBUTING"));
  if (docs.length) {
    L.push("");
    L.push(`> 可考虑指向的现有文档：${docs.join(", ")}`);
  }
  return L.join("\n");
}

/** 写出脚手架文件，不覆盖已存在的 AGENTS.md。返回写/跳过列表。 */
export function writeScaffold(scan: RepoScan, plan: "root" | "all"): string[] {
  const results: string[] = [];
  const write = (rel: string, content: string) => {
    const abs = join(scan.root, rel);
    if (existsSync(abs)) {
      results.push(`skip (exists): ${rel}`);
      return;
    }
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
    results.push(`write: ${rel}`);
  };

  // 根文件：复用 plan 里的第一个代码块内容
  const planText = renderAgentsPlan(scan);
  const m = planText.match(/```markdown\n([\s\S]*?)\n```/);
  if (m) write("AGENTS.md", m[1].split("\n").map((l) => l.replace(/^ {2}/, "")).join("\n") + "\n");

  if (plan === "all") {
    const scoped = scan.dirFileCounts
      .filter((d) => d.code >= 5)
      .filter((d) => !/(^|\/)(test|tests|__tests__|spec|fixtures?|mocks?|examples?)(\/|$)/.test(d.dir))
      .slice(0, 8);
    for (const d of scoped) {
      const body =
        `# ${d.dir} — 作用域指令\n\n` +
        `根 \`../AGENTS.md\` 仍然适用。这里只写本目录**从代码里看不出来**的东西。\n\n` +
        `## 结构\n- TODO\n\n## 约定\n- TODO\n\n## 陷阱\n- TODO\n`;
      write(join(d.dir, "AGENTS.md"), body);
    }
  }
  return results;
}
