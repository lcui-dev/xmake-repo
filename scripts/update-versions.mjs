// update-versions.mjs — keep this registry's package version tables in sync with
// a local LCUI source checkout. Pure helpers are exported for tests; the CLI
// (bottom) shells `git` against --source to resolve commits.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// package -> { descriptor: registry-relative, srcPath: LCUI source path, scheme }
export const PACKAGES = {
    "lcui":       { descriptor: "packages/l/lcui/xmake.lua",       srcPath: null,       hasBinary: true  },
    "pandagl":    { descriptor: "packages/p/pandagl/xmake.lua",    srcPath: "lib/pandagl", hasBinary: false },
    "yutil":      { descriptor: "packages/y/yutil/xmake.lua",      srcPath: "lib/yutil",   hasBinary: false },
    "lcui-css":   { descriptor: "packages/l/lcui-css/xmake.lua",   srcPath: "lib/css",     hasBinary: false },
    "lcui-ptk":   { descriptor: "packages/l/lcui-ptk/xmake.lua",   srcPath: "lib/ptk",     hasBinary: false },
    "lcui-ctest": { descriptor: "packages/l/lcui-ctest/xmake.lua", srcPath: "lib/ctest",   hasBinary: false },
};

export function bumpSemver(version, level) {
    const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) throw new Error(`cannot bump non-semver version: ${version}`);
    let [major, minor, patch] = [+m[1], +m[2], +m[3]];
    if (level === "major") { major++; minor = 0; patch = 0; }
    else if (level === "minor") { minor++; patch = 0; }
    else { patch++; }
    return `${major}.${minor}.${patch}`;
}

export function decideBump({ recordedCommit, resolvedCommit, level }) {
    if (!resolvedCommit) return { changed: false, doBump: false };
    const changed = resolvedCommit !== recordedCommit;
    const doBump = changed && !!recordedCommit; // first-time stamp: record, don't bump
    return { changed, doBump };
}

// Replace the hash on `source:add("versions", "<key>", "<hash>")`, or insert the
// line after the last non-develop source version line (before develop) if absent.
function upsertVersionLine(content, prefix, key, hash) {
    const lines = content.split("\n");
    const isDev = prefix === "source" && key === "develop";
    const lineRe = new RegExp(`^(\\s*)${prefix}:add\\("versions",\\s*"` + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + `",\\s*"[^"]*"\\)`);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(lineRe);
        if (m) { lines[i] = `${m[1]}${prefix}:add("versions", "${key}", "${hash}")`; return lines.join("\n"); }
    }
    // insert: anchor = last non-develop version line; else the scheme local var.
    const anyVersionRe = new RegExp(`^\\s*${prefix}:add\\("versions",\\s*"[^"]*"`);
    const developRe = new RegExp(`^\\s*${prefix}:add\\("versions",\\s*"develop"`);
    let anchor = -1;
    for (let i = 0; i < lines.length; i++) {
        if (anyVersionRe.test(lines[i]) && !developRe.test(lines[i])) anchor = i;
    }
    if (anchor < 0) {
        const schemeRe = new RegExp(`local\\s+${prefix}\\s*=\\s*package:scheme\\("${prefix}"\\)`);
        for (let i = 0; i < lines.length; i++) if (schemeRe.test(lines[i])) anchor = i;
    }
    if (anchor < 0) throw new Error(`no ${prefix} anchor found to insert "${key}"`);
    const indent = (lines[anchor].match(/^\s*/) || ["        "])[0];
    lines.splice(anchor + 1, 0, `${indent}${prefix}:add("versions", "${key}", "${hash}")`);
    return lines.join("\n");
}

export function applySourceUpdate(content, { version, commit, develop }) {
    let out = upsertVersionLine(content, "source", version, commit);
    out = upsertVersionLine(out, "source", "develop", develop || commit);
    return out;
}

export function applyBinaryShaUpdate(content, { version, shas }) {
    let out = content;
    for (const [alias, sha] of Object.entries(shas)) {
        out = upsertVersionLine(out, "binary", `${alias}:${version}`, sha);
    }
    return out;
}

export function readManifest(root) {
    return JSON.parse(readFileSync(join(root, "packages", "versions.json"), "utf8"));
}
export function writeManifest(root, manifest) {
    writeFileSync(join(root, "packages", "versions.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function parseArgs(argv) {
    const args = { sha: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--source") args.source = argv[++i];
        else if (a === "--pkg") args.pkg = argv[++i];
        else if (a === "--ver") args.ver = argv[++i];
        else if (a === "--bump") args.bump = argv[++i];
        else if (a === "--ref") args.ref = argv[++i];
        else if (a === "--sha") { const [k, v] = argv[++i].split("="); args.sha[k] = v; }
        else if (a === "--dry-run") args.dryRun = true;
        else throw new Error(`unknown arg: ${a}`);
    }
    return args;
}

export function run({ git, fs, cwd = process.cwd(), argv = [] }) {
    const args = parseArgs(argv);
    if (!args.source) throw new Error("--source <LCUI repo path> is required");
    const targets = args.pkg ? [args.pkg] : Object.keys(PACKAGES);
    const manifest = readManifest(cwd);
    const developCommit = git(args.source, ["rev-parse", "HEAD"]);
    const results = [];
    for (const pkg of targets) {
        const meta = PACKAGES[pkg];
        if (!meta) throw new Error(`unknown package: ${pkg}`);
        const cur = manifest[pkg] || { version: "0.0.0", commit: "" };
        // auto mode: last commit that touched this package's source path (develop tip).
        const pathCommit = meta.srcPath ? git(args.source, ["log", "-n1", "--format=%H", "--", meta.srcPath]) : null;
        const releaseCommit = git(args.source, ["rev-parse", args.ref || "HEAD"]);
        let version, commit;
        if (args.pkg && args.ver) { version = args.ver; commit = releaseCommit; } // explicit release (lcui tag)
        else {
            const d = decideBump({ recordedCommit: cur.commit, resolvedCommit: pathCommit, level: args.bump });
            if (!d.changed) { results.push({ pkg, skipped: true }); continue; }
            version = d.doBump ? bumpSemver(cur.version, args.bump || "patch") : cur.version;
            commit = pathCommit;
        }
        const path = join(cwd, meta.descriptor);
        let text = fs.readFileSync(path, "utf8");
        text = applySourceUpdate(text, { version, commit, develop: developCommit });
        if (meta.hasBinary && Object.keys(args.sha).length) text = applyBinaryShaUpdate(text, { version, shas: args.sha });
        fs.writeFileSync(path, text);
        manifest[pkg] = { version, commit };
        results.push({ pkg, version, commit });
    }
    writeManifest(cwd, manifest);
    return results;
}

// CLI entry
const isMain = process.argv[1] && process.argv[1].endsWith("update-versions.mjs");
if (isMain) {
    const git = (source, a) => execFileSync("git", ["-C", source, ...a], { encoding: "utf8" }).trim();
    const out = run({ git, fs: { readFileSync, writeFileSync }, argv: process.argv.slice(2) });
    for (const r of out) console.log(r.skipped ? `${r.pkg}: unchanged` : `${r.pkg} -> ${r.version} @ ${(r.commit || "").slice(0, 7)}`);
}
