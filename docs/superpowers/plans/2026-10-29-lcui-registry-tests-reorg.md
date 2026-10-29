# lcui-xmake-repo 测试重组与包改名 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Node 单测从 `scripts/` 迁到 `tests/`，为 6 个包各写一个 C 冒烟测试并在 CI 中只编译链接不运行，同时把三个子库包去掉 `lcui-` 前缀。

**Architecture:** registry 仓库不含 C 代码。`tests/c/<pkg>/main.c` 是纯编译单元，断言就是「头文件能编译 + 符号能链接」；由仓库内的 Node 驱动脚本 `tests/run-c-smoke.mjs` 在临时目录里搭 xmake 工程、`require` 包、`build smoke`，CI 与本地共用同一套逻辑。包改名是纯重命名，牵动 6 个同步点（目录、描述符 `package()` 名、`versions.json` key、`PACKAGES` 映射、CI 矩阵、README）。

**Tech Stack:** Node.js 24（`node:test`）、xmake 3.0.7+、GitHub Actions、C99。

**Spec:** `docs/superpowers/specs/2026-10-29-lcui-registry-tests-and-binary-packaging-design.md`（Part 1 / §4.1）

---

## Global Constraints

以下约束适用于本计划的每一个任务，不再逐条重复：

- 最终包名集合固定为 `lcui`、`yutil`、`pandagl`、`css`、`ptk`、`ctest`。`yutil` / `pandagl` / `lcui` **不改名**
- 每个包一个 `main.c`，路径 `tests/c/<pkg>/main.c`，`<pkg>` 用**最终包名**
- C 冒烟测试只要求**编译 + 链接**成功；CI 中**不运行**
- 头文件一律用**扁平根头**（`<yutil.h>`、`<pandagl.h>`、`<ptk.h>`、`<css.h>`、`<ctest.h>`），**不是** `<yutil/yutil.h>` 那种形式 —— 安装后不存在 `include/yutil/yutil.h`
- `lcui` 的冒烟测试用 `<LCUI/base.h>`，**不得**用 `<LCUI.h>`（伞形头依赖子库头，Plan B 完成前不可用）
- Node 单测命令固定为 `node --test "tests/**/*.test.mjs"` —— **Node 24 不接受目录参数**，`node --test tests/` 会报 `Cannot find module`
- xmake 的**任务名必须在 argv[1]**：写 `xmake build -P <dir> smoke`、`xmake require -y -P <dir>`；**不要**写 `xmake -P <dir> build smoke`
- 平台只支持 windows / linux
- **不改动** LCUI 源码仓库（`F:\code\LCUI`）的任何文件 —— 那是 Plan B 的范围
- 不使用 `git reset` / `git clean` / 删除文件来解决问题；只做 `git mv` 与定点编辑

---

## Review Focus

spec 暗示、但没有哪个任务的测试直接覆盖，最可能咬人的五类输入/失效模式：

1. **改名漏改 `PACKAGES` 映射** → 同步脚本抛 `unknown package`，子库版本静默停止更新 → 由 Task 2 的清单一致性测试钉住
2. **改名漏改 `versions.json` 的 key 或描述符的 `package()` 名** → xmake 解析到的包名对不上，版本记录错位 → 同上测试钉住
3. **冒烟测试引用了不存在的头路径**（把 `<yutil.h>` 写成 `<yutil/yutil.h>`）→ 编译直接失败 → Task 3 的编译检查钉住
4. **CI 里 xmake 任务名位置写错** → 冒烟测试一步都跑不起来，且**不会**报错说「测试没跑」，只是报「'build' is not a valid target name」→ Task 4 用「workflow 文本里不再出现 xmake 命令」这条约束消除该风险
5. **冒烟测试只编译不链接**（用 `add_includedirs` 而不是 `add_packages`）→ 头文件缺失检不出来，符号缺失检不出来 → Task 3 的驱动脚本固定用 `add_packages`

---

### Task 1: 建立 `tests/` 目录并迁移 Node 单测

**Files:**
- Move: `scripts/update-versions.test.mjs` → `tests/update-versions.test.mjs`
- Modify: `tests/update-versions.test.mjs:9`（import 路径）
- Modify: `.github/workflows/sync-and-test.yml:71`（Unit tests 步骤）

**Interfaces:**
- Consumes: 无
- Produces: `tests/` 目录存在；`tests/update-versions.test.mjs` 从 `../scripts/update-versions.mjs` 导入 6 个被测导出：`bumpSemver`、`applySourceUpdate`、`applyBinaryShaUpdate`、`decideBump`、`run`、`PACKAGES`（`PACKAGES` 已在 `scripts/update-versions.mjs:10` 导出，Task 2 会用到）

- [ ] **Step 1: 移动测试文件**

```bash
git mv scripts/update-versions.test.mjs tests/update-versions.test.mjs
```

（`tests/` 目录不存在时 `git mv` 会自动创建。）

- [ ] **Step 2: 修正 import 路径**

把 `tests/update-versions.test.mjs` 第 9 行的

```js
} from "./update-versions.mjs";
```

改成

```js
} from "../scripts/update-versions.mjs";
```

- [ ] **Step 3: 运行单测，确认迁移后仍然通过**

Run: `node --test "tests/**/*.test.mjs"`
Expected: `# tests 8`、`# pass 8`、`# fail 0`

> 注意不能用 `node --test tests/` —— Node 24 会把 `tests` 当模块加载并报 `Cannot find module`。

- [ ] **Step 4: 修正 CI 的 Unit tests 步骤**

把 `.github/workflows/sync-and-test.yml` 第 71 行

```yaml
        run: node --test scripts/
```

改成

```yaml
        run: node --test "tests/**/*.test.mjs"
```

> YAML 里双引号是必要的：glob 必须原样传给 node，不能被 shell 提前展开。

- [ ] **Step 5: 确认 `scripts/` 下只剩被测代码**

Run: `git ls-files scripts/`
Expected: 只有一行 `scripts/update-versions.mjs`

- [ ] **Step 6: 提交**

```bash
git add tests/update-versions.test.mjs scripts/update-versions.test.mjs .github/workflows/sync-and-test.yml
git commit -m "test: move node unit tests from scripts/ to tests/"
```

---

### Task 2: 子库包去前缀改名（`lcui-css`→`css`、`lcui-ptk`→`ptk`、`lcui-ctest`→`ctest`）

**Files:**
- Move: `packages/l/lcui-css/xmake.lua` → `packages/c/css/xmake.lua`
- Move: `packages/l/lcui-ptk/xmake.lua` → `packages/p/ptk/xmake.lua`
- Move: `packages/l/lcui-ctest/xmake.lua` → `packages/c/ctest/xmake.lua`
- Modify: `packages/c/css/xmake.lua`、`packages/p/ptk/xmake.lua`、`packages/c/ctest/xmake.lua`（`package()` 名与 assert 文案）
- Modify: `packages/versions.json`（3 个 key）
- Modify: `scripts/update-versions.mjs:14-16`（`PACKAGES` 映射）
- Modify: `.github/workflows/sync-and-test.yml:66`（同步循环）、`:89`（矩阵）
- Modify: `README.md:23`（包表格）+ 新增迁移说明
- Test: `tests/update-versions.test.mjs`

**Interfaces:**
- Consumes: Task 1 产出的 `tests/update-versions.test.mjs` 与 `PACKAGES` 导出
- Produces: `PACKAGES` 的 key 集合 = `["css","ctest","lcui","pandagl","ptk","yutil"]`；`packages/versions.json` 的 key 集合同上；每个描述符的 `package("<name>")` 与其所在目录 `<packages>/<首字母>/<name>/` 一致

- [ ] **Step 1: 写失败测试**

在 `tests/update-versions.test.mjs` 末尾追加：

```js
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
```

同时把文件顶部的 import 补成：

```js
import { fileURLToPath } from "node:url";
import {
    bumpSemver,
    applySourceUpdate,
    applyBinaryShaUpdate,
    decideBump,
    run,
    PACKAGES,
} from "../scripts/update-versions.mjs";
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "tests/**/*.test.mjs"`
Expected: FAIL —— 新测试报 `Expected values to be strictly deep-equal`，实际值含 `lcui-css` / `lcui-ptk` / `lcui-ctest`

- [ ] **Step 3: 移动三个描述符**

```bash
mkdir -p packages/c packages/p
git mv packages/l/lcui-css packages/c/css
git mv packages/l/lcui-ptk packages/p/ptk
git mv packages/l/lcui-ctest packages/c/ctest
```

- [ ] **Step 4: 改描述符里的包名与 assert 文案**

`packages/c/css/xmake.lua`：

| 原 | 新 |
|---|---|
| `package("lcui-css")` | `package("css")` |
| `assert(xmake.version():ge("3.0.7"), "package(lcui-css): requires xmake >= 3.0.7")` | `assert(xmake.version():ge("3.0.7"), "package(css): requires xmake >= 3.0.7")` |
| `assert(package:is_plat("windows", "linux"), "package(lcui-css): only windows and linux are supported")` | `assert(package:is_plat("windows", "linux"), "package(css): only windows and linux are supported")` |

`packages/p/ptk/xmake.lua`：同上，`lcui-ptk` → `ptk`。
`packages/c/ctest/xmake.lua`：同上，`lcui-ctest` → `ctest`。

> `on_install` 里执行的 `xmake build libcss` / `libptk` / `ctest` 是 **LCUI 源码里的 target 名**，与 registry 包名无关，**不要改**。

- [ ] **Step 5: 改 `packages/versions.json` 的 key**

把 `"lcui-css"`、`"lcui-ptk"`、`"lcui-ctest"` 三个 key 依次改成 `"css"`、`"ptk"`、`"ctest"`，其余字段（`version` / `commit`）原样保留。

- [ ] **Step 6: 改 `scripts/update-versions.mjs` 的 `PACKAGES` 映射**

把第 14-16 行三行改成（保持对齐格式，`descriptor` 路径同步更新）：

```js
    "css":      { descriptor: "packages/c/css/xmake.lua",      srcPath: "lib/css",     hasBinary: false },
    "ptk":      { descriptor: "packages/p/ptk/xmake.lua",      srcPath: "lib/ptk",     hasBinary: false },
    "ctest":    { descriptor: "packages/c/ctest/xmake.lua",    srcPath: "lib/ctest",   hasBinary: false },
```

- [ ] **Step 7: 改 CI 的同步循环与矩阵**

`.github/workflows/sync-and-test.yml` 第 66 行：

```yaml
          for pkg in pandagl yutil lcui-css lcui-ptk lcui-ctest; do
```

改成

```yaml
          for pkg in pandagl yutil css ptk ctest; do
```

第 89 行：

```yaml
        pkg: [lcui, yutil, pandagl, lcui-css, lcui-ptk, lcui-ctest]
```

改成

```yaml
        pkg: [lcui, yutil, pandagl, css, ptk, ctest]
```

- [ ] **Step 8: 改 README 的包表格并加迁移说明**

`README.md` 第 23 行的表格行：

```markdown
| `pandagl`, `yutil`, `lcui-css`, `lcui-ptk`, `lcui-ctest` | source only | **independent**, pinned to the last LCUI commit that changed that `lib/<dir>` |
```

改成

```markdown
| `pandagl`, `yutil`, `css`, `ptk`, `ctest` | source only | **independent**, pinned to the last LCUI commit that changed that `lib/<dir>` |
```

在该表格之后追加一段迁移说明：

```markdown
### Renamed packages

The sub-library packages dropped the `lcui-` prefix:

| Old name | New name |
|---|---|
| `lcui-css` | `css` |
| `lcui-ptk` | `ptk` |
| `lcui-ctest` | `ctest` |

`lcui`, `yutil` and `pandagl` are unchanged. Update your `add_requires(...)` calls.
```

- [ ] **Step 9: 运行测试，确认通过**

Run: `node --test "tests/**/*.test.mjs"`
Expected: `# tests 9`、`# pass 9`、`# fail 0`

- [ ] **Step 10: 确认全仓库没有残留的旧包名**

Run: `git grep -n "lcui-css\|lcui-ptk\|lcui-ctest" -- . ':!docs/superpowers'`
Expected: 无输出（`docs/superpowers/` 下的 spec 与 plan 记录历史，允许保留）

- [ ] **Step 11: 提交**

```bash
git add packages/c packages/p packages/versions.json packages/l scripts/update-versions.mjs .github/workflows/sync-and-test.yml README.md tests/update-versions.test.mjs
git commit -m "refactor!: rename sub-library packages to drop the lcui- prefix"
```

---

### Task 3: C 冒烟测试的驱动脚本

**Files:**
- Verify: `tests/c/lcui/main.c`、`tests/c/yutil/main.c`、`tests/c/pandagl/main.c`、`tests/c/css/main.c`、`tests/c/ptk/main.c`、`tests/c/ctest/main.c`（规划阶段已起草并提交，内容以本任务的代码块为准）
- Create: `tests/run-c-smoke.mjs`

**Interfaces:**
- Consumes: Task 2 产出的最终包名集合
- Produces:
  - `tests/c/<pkg>/main.c` —— 一个只含 `#include` + 一次公开函数调用的 C 编译单元
  - `tests/run-c-smoke.mjs` —— CLI：`node tests/run-c-smoke.mjs [pkg...]`；无参数时跑全部 6 个包；退出码 0 = 全部通过，非 0 = 有包失败

- [ ] **Step 1: 核对 6 个 `main.c` 的内容**

规划阶段已起草并提交这 6 个文件，且已用等价 xmake 工程验证过它们能编译通过。逐一对照下面的代码块；**有任何出入以代码块为准**。

`tests/c/lcui/main.c`：

```c
/* Smoke test for the "lcui" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * LCUI/base.h is used instead of the umbrella LCUI.h on purpose: LCUI.h pulls
 * in every sub-library header, which is only guaranteed to be installed once
 * the lcui package ships the sub-library headers itself.
 */

#include <LCUI/base.h>

int main(void)
{
    const char *version = lcui_get_version();
    return version ? 0 : 1;
}
```

`tests/c/yutil/main.c`：

```c
/* Smoke test for the "yutil" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * yutil.h is the umbrella header installed at the include root; the
 * sub-headers live in include/yutil/.
 */

#include <yutil.h>

int main(void)
{
    char *copy = y_strdup("lcui");
    return copy ? 0 : 1;
}
```

`tests/c/pandagl/main.c`：

```c
/* Smoke test for the "pandagl" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * pandagl.h is the umbrella header installed at the include root; the
 * sub-headers live in include/pandagl/.
 */

#include <pandagl.h>

int main(void)
{
    pd_canvas_t canvas;

    pd_canvas_init(&canvas);
    return 0;
}
```

`tests/c/css/main.c`：

```c
/* Smoke test for the "css" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * css.h is the umbrella header installed at the include root; the sub-headers
 * live in include/css/.
 */

#include <css.h>

int main(void)
{
    css_init();
    css_destroy();
    return 0;
}
```

`tests/c/ptk/main.c`：

```c
/* Smoke test for the "ptk" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * ptk.h is the umbrella header installed at the include root; the sub-headers
 * live in include/ptk/.
 */

#include <ptk.h>

int main(void)
{
    (void)ptk_app_init(L"lcui-test");
    return 0;
}
```

`tests/c/ctest/main.c`：

```c
/* Smoke test for the "ctest" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 */

#include <ctest.h>

int main(void)
{
    return ctest_equal_int("smoke", 1, 1) ? 0 : 1;
}
```

- [ ] **Step 2: 写驱动脚本 `tests/run-c-smoke.mjs`**

脚本行为（实现者按此写，不必逐字照抄，但语义必须一致）：
| 方面 | 要求 |
|---|---|
| CLI | `node tests/run-c-smoke.mjs [pkg...]`；无参数 = 全部 6 个包（`lcui`、`yutil`、`pandagl`、`css`、`ptk`、`ctest`）；给了参数就只跑这些包 |
| 仓库根 | 脚本所在目录的上一级（`tests/` → 仓库根），用 `fileURLToPath(new URL("..", import.meta.url))` 取 |
| 临时目录 | `mkdtempSync(join(tmpdir(), "lcui-smoke-"))`，每个包用**独立**子目录 |
| 工程文件 | 每个包目录下写 `xmake.lua` + 从 `tests/c/<pkg>/main.c` 复制 `main.c` |
| `xmake.lua` 内容 | `add_rules("mode.debug", "mode.release")` / `add_repositories("lcui-repo <仓库根>")` / `add_requires("<pkg>", {system = false})` / `target("smoke")` 里 `set_kind("binary")` + `add_packages("<pkg>")` + `add_files("main.c")` |
| 路径写法 | 写进 Lua 的路径**必须用正斜杠**（Windows 上反斜杠会被 Lua 当转义符）；把 `\` 换成 `/` |
| 命令 1 | `xmake require -y -P <临时目录>`（任务名在前） |
| 命令 2 | `xmake build -P <临时目录> smoke`（任务名在前） |
| 其它 | 只编译链接，**不运行** smoke 产物；每个包跑完打印一行结果；任一包失败则进程退出码非 0；结束时清理临时目录（失败时也清理） |

- [ ] **Step 3: 无网络也能做的编译检查**

这一步验证 6 个 `main.c` 的头文件路径与函数签名是否正确，**不需要网络**（用 LCUI 源码树模拟安装后的扁平 include 布局）。

准备一个临时 xmake 工程，其 `xmake.lua` 内容为（把 `<LCUI>` 换成 LCUI 源码树根目录，`<REPO>` 换成本仓库根目录，**路径全部用正斜杠**）：

```lua
set_project("hdrcheck")
add_includedirs(
    "<LCUI>/include",
    "<LCUI>/lib/ctest/include",
    "<LCUI>/lib/yutil/include",
    "<LCUI>/lib/pandagl/include",
    "<LCUI>/lib/thread/include",
    "<LCUI>/lib/css/include",
    "<LCUI>/lib/i18n/include",
    "<LCUI>/lib/ptk/include",
    "<LCUI>/lib/worker/include",
    "<LCUI>/lib/router/include",
    "<LCUI>/lib/ui/include",
    "<LCUI>/lib/ui-server/include",
    "<LCUI>/lib/ui-cursor/include",
    "<LCUI>/lib/ui-xml/include",
    "<LCUI>/lib/ui-router/include"
)
target("hdrcheck")
    set_kind("object")
    add_files("<REPO>/tests/c/lcui/main.c")
    add_files("<REPO>/tests/c/yutil/main.c")
    add_files("<REPO>/tests/c/pandagl/main.c")
    add_files("<REPO>/tests/c/css/main.c")
    add_files("<REPO>/tests/c/ptk/main.c")
    add_files("<REPO>/tests/c/ctest/main.c")
```

然后 `xmake -P <临时工程目录>`。

Expected: 6 个 `compiling.release` 行，最后 `build ok`；**没有** `C1083: 无法打开包括文件` 之类的错误。

> 若报「无法打开包括文件 `yutil/yutil.h`」，说明头路径写成了子目录形式 —— 改成扁平根头 `yutil.h`。
> 若某个子库目录在 LCUI 树里不存在（重构中间态可能缺 `lib/ui-cursor`、`lib/ui-router`），删掉那一行即可 —— 它们与本测试无关。

- [ ] **Step 4: 跑单测，确认没有回归**

Run: `node --test "tests/**/*.test.mjs"`
Expected: `# pass 9`、`# fail 0`

- [ ] **Step 5: 提交**

```bash
git add tests/c tests/run-c-smoke.mjs
git commit -m "test: add C smoke tests for every registry package"
```

---

### Task 4: CI 接入冒烟测试

**Files:**
- Modify: `.github/workflows/sync-and-test.yml`（`install-each` job）

**Interfaces:**
- Consumes: Task 3 产出的 `tests/run-c-smoke.mjs`（CLI：`node tests/run-c-smoke.mjs [pkg...]`）
- Produces: `install-each` job 在 ubuntu-22.04 与 windows-latest 两个平台上，对 6 个包各跑一次「require + 编译链接」

- [ ] **Step 1: 改 `install-each` job**

把 `.github/workflows/sync-and-test.yml` 里 `install-each` job 的 steps 整段替换为：

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: xmake-io/github-action-setup-xmake@v1
        with: { xmake-version: latest }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - name: Resolve + download + build ${{ matrix.pkg }}
        run: node tests/run-c-smoke.mjs ${{ matrix.pkg }}
```

要点：
- 矩阵的 `pkg` 列表已在 Task 2 改为 `[lcui, yutil, pandagl, css, ptk, ctest]`，此处不重复改
- **`setup-node` 是新增的必需步骤** —— `install-each` job 原本没有 Node
- **workflow 文本里不再出现任何 xmake 命令** —— 命令拼装集中在 `tests/run-c-smoke.mjs` 一处，避免任务名位置写错（见 Global Constraints 与 Review Focus 第 4 条）
- 原来的 `shell: bash` 与 `mktemp -d` 全部删掉 —— 临时目录由 Node 脚本用 `os.tmpdir()` 创建，Windows 上是原生路径，不需要 `cygpath` 转换

- [ ] **Step 2: 确认 workflow 里不再有 xmake 命令**

Run: `git grep -n "xmake" -- .github/workflows/sync-and-test.yml`
Expected: 只剩 action 相关的三行 ——

```
93:- uses: xmake-io/github-action-setup-xmake@v1
94:        with: { xmake-version: latest }
```

（以及 `REGISTRY` 那行注释里的小写 `xmake-repo`。）**不得**出现 `xmake require`、`xmake build`、`xmake -P` 之类的命令。

- [ ] **Step 3: 确认 workflow 是合法 YAML**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/sync-and-test.yml')); print('YAML ok')"`

Expected: `YAML ok`

> 若本机没有 python / PyYAML，这一步可以跳过 —— GitHub Actions 会在 workflow 触发时直接报 YAML 解析错误，不会静默通过。

- [ ] **Step 4: 本地复现 workflow 的一条命令**

在有网络的环境下（需要能 clone github.com 上的 LCUI）：

Run: `node tests/run-c-smoke.mjs yutil`
Expected: 打印该包通过的消息，进程退出码 0

> 本机无网络时该步会失败（clone LCUI 失败），这是环境限制不是缺陷；CI 是权威闸门。

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/sync-and-test.yml
git commit -m "ci: compile and link a smoke target for every package"
```

---

### Task 5: 修正 6 个包的 `on_test`

**Files:**
- Modify: `packages/y/yutil/xmake.lua`（`on_test`）
- Modify: `packages/p/pandagl/xmake.lua`（`on_test`）
- Modify: `packages/c/css/xmake.lua`（`on_test`）
- Modify: `packages/p/ptk/xmake.lua`（`on_test`）
- Modify: `packages/c/ctest/xmake.lua`（`on_test`）
- Modify: `packages/l/lcui/xmake.lua`（`on_test`）

**Interfaces:**
- Consumes: Task 2 产出的新包名与目录
- Produces: 6 个包的 `on_test` 全部指向**真实存在**的头路径与**真实存在**的符号

- [ ] **Step 1: 改 6 处 `on_test`**

| 包 | 改为 |
|---|---|
| `yutil` | `assert(package:has_cfuncs("y_strdup", {includes = "yutil.h"}))` |
| `pandagl` | `assert(package:has_cfuncs("pd_canvas_init", {includes = "pandagl.h"}))` |
| `css` | `assert(package:has_cfuncs("css_init", {includes = "css.h"}))` |
| `ptk` | `assert(package:has_cfuncs("ptk_app_init", {includes = "ptk.h"}))` |
| `ctest` | `assert(package:has_cfuncs("ctest_equal_int", {includes = "ctest.h"}))` |
| `lcui` | `assert(package:has_cfuncs("lcui_init", {includes = "LCUI/base.h"}))` |

改动说明：
- `yutil` / `pandagl` / `ptk` 的 `includes` 从 `yutil/yutil.h`、`pandagl/pandagl.h`、`ptk/ptk.h` 改为扁平根头 —— **安装后不存在 `include/<lib>/<lib>.h`**
- `ptk` 的符号从 `ptk_app_create`（不存在）改为 `ptk_app_init`
- `css` / `ctest` 从 `has_cincludes`（只查头在不在）升级为 `has_cfuncs`（查符号能否链接）
- `lcui` 的 `includes` 从 `LCUI.h` 改为 `LCUI/base.h` —— `LCUI.h` 会拉入 10 个子库头，单独装 lcui 包时编译不过

- [ ] **Step 2: 核对每个符号在 LCUI 源码里确实存在**

Run（把 `<LCUI>` 换成 LCUI 源码树根）：

```bash
grep -rn "y_strdup"            <LCUI>/lib/yutil/include/yutil/string.h
grep -rn "pd_canvas_init"      <LCUI>/lib/pandagl/include/pandagl/canvas.h
grep -rn "css_init"            <LCUI>/lib/css/include/css.h
grep -rn "ptk_app_init"        <LCUI>/lib/ptk/include/ptk/app.h
grep -rn "ctest_equal_int"     <LCUI>/lib/ctest/include/ctest.h
grep -rn "lcui_init"           <LCUI>/include/LCUI/base.h
```

Expected: 6 条都有匹配行

- [ ] **Step 3: 核对每个 `includes` 路径在安装布局里确实存在**

对照 Task 3 Step 1 的 `main.c` 里用的头路径 —— 必须完全一致（`yutil.h` / `pandagl.h` / `css.h` / `ptk.h` / `ctest.h` / `LCUI/base.h`）。这是刻意的：`main.c` 与 `on_test` 检查同一件事。

- [ ] **Step 4: 提交**

```bash
git add packages/y/yutil/xmake.lua packages/p/pandagl/xmake.lua packages/c/css/xmake.lua packages/p/ptk/xmake.lua packages/c/ctest/xmake.lua packages/l/lcui/xmake.lua
git commit -m "fix(packages): point on_test at real headers and symbols"
```

---

### Task 6: README 更新

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 3 产出的 `tests/run-c-smoke.mjs` CLI；Task 2 产出的新包名
- Produces: README 里的测试命令、包表格、迁移说明与实际状态一致

- [ ] **Step 1: 改测试命令**

README 末尾那行

```markdown
Run the tooling tests locally with `node --test scripts/`.
```

改成

```markdown
Run the tooling tests locally with `node --test "tests/**/*.test.mjs"`.
```

- [ ] **Step 2: 新增冒烟测试说明**

在「Dependency direction」一节之前插入：

```markdown
## Tests

`tests/` holds two kinds of checks:

- `tests/update-versions.test.mjs` — unit tests for the version-sync tooling.
  Run them with `node --test "tests/**/*.test.mjs"`.
- `tests/c/<pkg>/main.c` — one C translation unit per package. It includes the
  package's public headers and calls one public function, so compiling and
  linking it proves the installed headers are reachable, the symbols are
  exported, and the transitive dependencies are complete. The tests are never
  executed: `lcui_init()` and `ptk_app_init()` need a display server.

Run them all with:

```bash
node tests/run-c-smoke.mjs          # every package
node tests/run-c-smoke.mjs yutil    # one package
```

CI compiles and links the smoke target for every package on Linux and Windows.
```

- [ ] **Step 3: 核对 README 里的包名与仓库一致**

Run: `git grep -n "lcui-css\|lcui-ptk\|lcui-ctest" -- README.md`
Expected: 无输出

Run: `git grep -n "node --test" -- README.md`
Expected: 出现的是 `node --test "tests/**/*.test.mjs"`，不是 `node --test scripts/`

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: describe the new test layout and package renames"
```

---

## 完成标准

- `node --test "tests/**/*.test.mjs"` 全绿（9 个测试）
- `git grep "lcui-css\|lcui-ptk\|lcui-ctest"` 在 `packages/`、`scripts/`、`.github/`、`README.md`、`tests/` 下无命中
- `tests/c/` 下有 6 个 `main.c`，每个对应一个包名
- `tests/run-c-smoke.mjs` 存在且 CLI 行为符合 Task 3 的规定
- workflow 的 `install-each` job 不含任何 xmake 命令，只调用 `node tests/run-c-smoke.mjs <pkg>`
- 6 个包的 `on_test` 全部指向真实存在的头与符号
