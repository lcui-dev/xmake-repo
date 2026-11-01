// run-c-smoke.mjs — smoke-test every C package in this registry.
//
// For each package it writes a throwaway xmake project that requires the
// package from this registry, copies tests/c/<pkg>/main.c alongside it, then
// compiles and links that translation unit against the installed package.
// Compiling and linking is the whole assertion: the resulting binary is never
// run.
//
// Usage:
//   node tests/run-c-smoke.mjs [pkg...]
// No arguments runs all six packages. Exit code 0 means every requested
// package built; non-zero means at least one failed.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The complete set of packages in this registry, kept in sync with
// packages/versions.json (see tests/update-versions.test.mjs).
const PACKAGES = ["lcui", "yutil", "pandagl", "css", "ptk", "ctest"];

// Repository root: this file lives in tests/, so go up one level.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Per-command cap so a stuck git clone cannot hang the run forever. Override
// with LCUI_SMOKE_TIMEOUT_MS if a source build needs longer.
const TIMEOUT_MS = Number(process.env.LCUI_SMOKE_TIMEOUT_MS) || 600000;

// Lua string literals interpret backslashes as escape sequences, so every path
// interpolated into the generated xmake.lua must use forward slashes.
const fwd = (p) => p.replace(/\\/g, "/");

function renderXmakeLua(pkg) {
    return [
        'add_rules("mode.debug", "mode.release")',
        `add_repositories("lcui-repo ${fwd(ROOT)}")`,
        `add_requires("${pkg}", {system = false})`,
        "",
        'target("smoke")',
        '    set_kind("binary")',
        `    add_packages("${pkg}")`,
        '    add_files("main.c")',
        "",
    ].join("\n");
}

function runXmake(args) {
    return spawnSync("xmake", args, { encoding: "utf8", timeout: TIMEOUT_MS });
}

function capture(res) {
    return [res.stdout || "", res.stderr || ""].join("\n").trim();
}

// Markers that show up in xmake/git output when the package source can't be
// fetched. Used to tell a network failure apart from a real build error.
const NETWORK_MARKERS = [
    "fatal: unable to access",
    "could not resolve host",
    "could not resolve",
    "failed to connect",
    "connection timed out",
    "connection refused",
    "network is unreachable",
    "errno 11001", // getaddrinfo: host not found
    "errno 10060", // WSAETIMEDOUT
    "errno 10061", // WSAECONNREFUSED
];

function isNetworkFailure(text) {
    const lower = text.toLowerCase();
    return NETWORK_MARKERS.some((m) => lower.includes(m));
}

function indent(text) {
    return text.split("\n").map((line) => `  ${line}`).join("\n");
}

// Build one package. Returns { pkg, stage } where stage is null on success and
// "require" | "build" on failure, with the spawn result attached for reporting.
function buildPackage(pkg, projectDir) {
    writeFileSync(join(projectDir, "xmake.lua"), renderXmakeLua(pkg));
    copyFileSync(join(ROOT, "tests", "c", pkg, "main.c"), join(projectDir, "main.c"));

    const requireRes = runXmake(["require", "-y", "-P", projectDir]);
    if (requireRes.error || requireRes.status !== 0) {
        return { pkg, stage: "require", result: requireRes };
    }

    const buildRes = runXmake(["build", "-P", projectDir, "smoke"]);
    if (buildRes.error || buildRes.status !== 0) {
        return { pkg, stage: "build", result: buildRes };
    }

    return { pkg, stage: null, result: buildRes };
}

function main() {
    const requested = process.argv.slice(2);
    const unknown = requested.filter((pkg) => !PACKAGES.includes(pkg));
    const toBuild = requested.length === 0 ? PACKAGES : requested.filter((pkg) => PACKAGES.includes(pkg));

    for (const pkg of unknown) {
        console.error(`error: unknown package "${pkg}" (expected one of: ${PACKAGES.join(", ")})`);
    }

    const tmpRoot = mkdtempSync(join(tmpdir(), "lcui-smoke-"));
    const results = [];
    let failed = unknown.length > 0;

    try {
        for (const pkg of toBuild) {
            const projectDir = join(tmpRoot, pkg);
            mkdirSync(projectDir, { recursive: true });
            const out = buildPackage(pkg, projectDir);

            if (out.stage === null) {
                results.push({ pkg, ok: true });
                console.log(`${pkg}: ok`);
            } else {
                failed = true;
                results.push({ pkg, ok: false });
                console.error(`${pkg}: FAIL (${out.stage})`);
                if (out.result.error?.code === "ETIMEDOUT") {
                    console.error(`  timed out after ${TIMEOUT_MS} ms`);
                } else if (out.result.error) {
                    console.error(`  ${out.result.error.message}`);
                }
                const text = capture(out.result);
                if (text) console.error(indent(text));
                if (isNetworkFailure(text)) {
                    console.error("  note: this looks like a network/clone failure (the package source could not be fetched).");
                }
            }
        }
    } finally {
        try {
            rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
            console.error(`warning: could not remove temp dir ${tmpRoot}`);
        }
    }

    const passed = results.filter((r) => r.ok).length;
    console.log(`c smoke: ${passed}/${results.length} passed`);
    process.exitCode = failed ? 1 : 0;
}

main();
