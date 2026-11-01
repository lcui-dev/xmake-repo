import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
    bumpSemver,
    applySourceUpdate,
    applyBinaryShaUpdate,
    decideBump,
    run,
    PACKAGES,
} from "../scripts/update-versions.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SUB_LIB = `package("pandagl")
    add_schemes("source")
    on_source(function (package)
        local source = package:scheme("source")
        source:add("urls", "https://github.com/lc-soft/LCUI.git", "https://gitee.com/lc-soft/LCUI.git")
        source:add("versions", "1.0.0", "PENDING")
        source:add("versions", "develop", "PENDING")
    end)
`;

test("bumpSemver patch/minor/major", () => {
    assert.equal(bumpSemver("1.0.0", "patch"), "1.0.1");
    assert.equal(bumpSemver("1.2.7", "minor"), "1.3.0");
    assert.equal(bumpSemver("1.2.7", "major"), "2.0.0");
});

test("applySourceUpdate sets a new stable version + commit and refreshes develop", () => {
    const out = applySourceUpdate(SUB_LIB, { version: "1.0.0", commit: "a".repeat(40), develop: "b".repeat(40) });
    assert.match(out, /source:add\("versions", "1\.0\.0", "a{40}"\)/);
    assert.match(out, /source:add\("versions", "develop", "b{40}"\)/);
    assert.doesNotMatch(out, /PENDING/, "no PENDING left");
});

test("applySourceUpdate inserts a new higher version after the last stable line", () => {
    const out = applySourceUpdate(SUB_LIB, { version: "1.1.0", commit: "c".repeat(40), develop: "d".repeat(40) });
    assert.match(out, /source:add\("versions", "1\.1\.0", "c{40}"\)/);
    assert.match(out, /source:add\("versions", "1\.0\.0", "PENDING"\)/, "old entry retained");
    // new entry sits after the 1.0.0 line, before develop
    const idxNew = out.indexOf("1.1.0");
    const idxDevelop = out.indexOf('"develop"');
    assert.ok(idxNew > out.indexOf("1.0.0") && idxNew < idxDevelop);
});

test("applySourceUpdate is idempotent", () => {
    const once = applySourceUpdate(SUB_LIB, { version: "1.0.0", commit: "a".repeat(40), develop: "b".repeat(40) });
    const twice = applySourceUpdate(once, { version: "1.0.0", commit: "a".repeat(40), develop: "b".repeat(40) });
    assert.equal(once, twice);
});

test("decideBump: only when the source commit changed", () => {
    // no recorded commit yet -> stamp current version, no bump
    assert.deepEqual(decideBump({ recordedCommit: "", resolvedCommit: "x", level: "patch" }),
        { changed: true, doBump: false });
    // changed -> bump
    assert.deepEqual(decideBump({ recordedCommit: "x", resolvedCommit: "y", level: "patch" }),
        { changed: true, doBump: true });
    // same -> nothing to do
    assert.deepEqual(decideBump({ recordedCommit: "y", resolvedCommit: "y", level: "patch" }),
        { changed: false, doBump: false });
});

test("applyBinaryShaUpdate sets lcui per-platform alias shas for a version", () => {
    const LCUI = `    on_source(function (package)
        local binary = package:scheme("binary")
        binary:add("versions", "windows-x64:3.1.0", "PENDING")
        binary:add("versions", "linux-x64:3.1.0", "PENDING")
    end)
`;
    const out = applyBinaryShaUpdate(LCUI, { version: "3.1.0", shas: { "windows-x64": "1".repeat(64), "linux-x64": "2".repeat(64) } });
    assert.match(out, /windows-x64:3\.1\.0", "1{64}"/);
    assert.match(out, /linux-x64:3\.1\.0", "2{64}"/);
    assert.doesNotMatch(out, /PENDING/);
});

test("applyBinaryShaUpdate inserts missing alias lines", () => {
    const LCUI = `        local binary = package:scheme("binary")
`;
    const out = applyBinaryShaUpdate(LCUI, { version: "3.2.0", shas: { "windows-x64": "a".repeat(64) } });
    assert.match(out, /binary:add\("versions", "windows-x64:3\.2\.0", "a{64}"\)/);
});

test("run: lcui release sets stable=tag commit, develop=HEAD, applies binary shas, updates manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "reg-"));
    mkdirSync(join(dir, "packages"), { recursive: true });
    writeFileSync(join(dir, "packages", "versions.json"), '{"lcui":{"version":"3.0.0","commit":""}}');
    mkdirSync(join(dir, "packages", "l", "lcui"), { recursive: true });
    writeFileSync(join(dir, "packages", "l", "lcui", "xmake.lua"),
        'package("lcui")\n    on_source(function (package)\n        local binary = package:scheme("binary")\n        local source = package:scheme("source")\n    end)\n');
    const git = (_src, a) => {
        if (a[0] === "rev-parse" && a[1] === "HEAD") return "DEVELOP_TIP";
        if (a[0] === "rev-parse") return "RELEASE_COMMIT"; // --ref tag
        return "";
    };
    run({ git, fs: { readFileSync, writeFileSync }, cwd: dir, argv: [
        "--source", "/x", "--pkg", "lcui", "--ver", "3.1.0", "--ref", "v3.1.0",
        "--sha", "windows-x64=AA", "--sha", "linux-x64=BB",
    ] });
    const desc = readFileSync(join(dir, "packages", "l", "lcui", "xmake.lua"), "utf8");
    assert.match(desc, /source:add\("versions", "3\.1\.0", "RELEASE_COMMIT"\)/);
    assert.match(desc, /source:add\("versions", "develop", "DEVELOP_TIP"\)/);
    assert.match(desc, /binary:add\("versions", "windows-x64:3\.1\.0", "AA"\)/);
    assert.match(desc, /binary:add\("versions", "linux-x64:3\.1\.0", "BB"\)/);
    const man = JSON.parse(readFileSync(join(dir, "packages", "versions.json"), "utf8"));
    assert.equal(man.lcui.version, "3.1.0");
    assert.equal(man.lcui.commit, "RELEASE_COMMIT");
});

test("registry package names stay in sync across manifest, PACKAGES map and descriptors", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const manifest = JSON.parse(readFileSync(join(root, "packages", "versions.json"), "utf8"));
    const expected = ["css", "ctest", "lcui", "pandagl", "ptk", "yutil"];
    assert.deepEqual(Object.keys(manifest).sort(), expected);
    assert.deepEqual(Object.keys(PACKAGES).sort(), expected);
    for (const [name, meta] of Object.entries(PACKAGES)) {
        assert.equal(meta.descriptor, `packages/${name[0]}/${name}/xmake.lua`);
        const desc = readFileSync(join(root, meta.descriptor), "utf8");
        assert.match(desc, new RegExp(`^package\\("${name}"\\)`, "m"), `${meta.descriptor} must declare package("${name}")`);
    }
});
