# LCUI 二进制包链路打通 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `lcui` 包的 binary scheme 具备可用的前提 —— LCUI 的 `lcui` target 自带全部子库头文件，且 `lcui.lib` 是 self-contained 的；CI 能产出规范命名的二进制 zip。真正的发版与端到端验证推迟到确定 release 时再做（见 Task 4）。

**Architecture:** 改动分两侧。LCUI 仓库（`plan/xmake-repo` 分支）：`target("lcui")` 循环安装各子库的扁平头文件，并开启 `build.merge_archive` 让 `lcui.lib` 内含全部子库符号；CI 新增一步把 `xmake install -o` 的产物打成 `lcui-<version>-<plat>-<arch>.zip` 并入 release 资产。registry 仓库：修掉 `update-versions.mjs` 把带 `v` 的 tag 当版本号的 bug。zip 顶层结构是 `include/` + `lib/`，与 registry 既有的 `on_install` 完全对齐，无需改动。

**Tech Stack:** xmake 3.1.1（`build.merge_archive` 策略）、GitHub Actions、PowerShell Core、Node.js 24。

**Spec:** `docs/superpowers/specs/2026-10-29-lcui-registry-tests-and-binary-packaging-design.md`（Part 2 / §4.2、Part 3 / §4.3、§2.6 的 F4/F5/F6）

**Revision:** 2026-11-02 —— 按用户指示改用现成的 `plan/xmake-repo` 工作树（不做 worktree 创建/销毁），按子库简化后的实际布局更新，并把发版验证推迟。

---

## Preconditions

- **直接在现成工作树里干活，不创建、不销毁 worktree**：

  ```
  C:/Users/LC-So/.local/share/opencode/worktree/4e73da/tidy-cactus
  ```

  分支 `plan/xmake-repo`，基线提交 `6c2e5fee4`。开工前确认 `git status` 干净、`xmake f -y -k static -m release && xmake build lcui` 成功（该树可正常 configure 与 build）。
- `build/`、`.xmake/`、`dist/` 已被 `.gitignore` 覆盖，构建产物不会污染提交。
- **本阶段不打 tag、不测试发版**：Task 4 的失败面（release 资产是否存在、binary scheme 是否命中）明确不在本次范围内。
- **Task 3 依赖 Plan A 已合并**：它改的 `tests/update-versions.test.mjs` 与 `node --test "tests/**/*.test.mjs"` 这套布局只存在于 `feat/tests-and-packages` 分支上；`F:/code/lcui-xmake-repo` 的 `main` 还停在 `37f8dbc`（测试仍在 `scripts/`）。所以 Task 3 要么等 Plan A 合入 `main` 之后做，要么直接在 `feat/tests-and-packages` 分支上做。
- **Task 3 改的是 registry 仓库**（`F:/code/lcui-xmake-repo`），不是 `tidy-cactus`。两个仓库分开提交。

### 子库布局（2026-11-02 实测，已经过一轮简化合并）

`lib/` 下**有 `xmake.lua` 的目录才是子库**，当前共 11 个：

| 目录 | target | 安装的头文件 |
|---|---|---|
| `lib/yutil` | `yutil` | `yutil.h` + `yutil/*.h` |
| `lib/ctest` | `ctest` | `ctest.h` |
| `lib/css` | `libcss` | `css.h` + `css/*.h` |
| `lib/i18n` | `libi18n` | `i18n.h` |
| `lib/pandagl` | `pandagl` | `pandagl.h` + `pandagl/*.h` |
| `lib/ptk` | `libptk` | `ptk.h` + `ptk/*.h` |
| `lib/router` | `librouter` | `router.h` + `router/*.h` |
| `lib/thread` | `libthread` | `thread.h` |
| `lib/ui` | `libui` | `ui.h` + `ui/*.h` |
| `lib/ui-server` | `libui-server` | `ui_server.h`、`ui_cursor.h`、`ui_server/*.h` |
| `lib/ui-xml` | `libui-xml` | `ui_xml.h` + `ui_xml/*.h` |

已合并掉、**不再存在**的子库：
- `lib/ui-cursor` → 并入 `lib/ui-server`（`ui_cursor.h` 现在由 `libui-server` 安装）
- `lib/ui-router` → 从构建中移除（`LCUI.h` 不再 include `<ui_router.h>`）
- `lib/worker` → 整个目录已删除（`LCUI.h` 不再 include `<worker.h>`）

**`lib/ui-router/` 目录仍残留在工作树里**，但只含一个生成的 `include/ui_router/config.h`，且**未被 git 跟踪**。它不是子库 —— 头文件循环必须以「该目录有 `xmake.lua`」为判据，否则会把这个残留目录的生成物也装进 `include/ui_router/`。

当前 `include/LCUI.h` 需要的扁平根头一共 9 个：

```
yutil.h  css.h  pandagl.h  ui.h  ui_cursor.h  ui_server.h  ui_xml.h  thread.h  ptk.h
```

外加 `LCUI/` 子目录下的 `worker.h`、`app.h`、`ui.h`、`widgets.h`、`settings.h`、`base.h`。

当前 `target("lcui")` 的 `add_deps` 有 10 项：`yutil`、`libthread`、`libptk`、`pandagl`、`libcss`、`libi18n`、`libui`、`libui-server`、`librouter`、`libui-xml`。

---

## Global Constraints

- 头文件合并用**循环遍历 `lib/*`**，不硬编码子库清单；判据是「该目录下存在 `xmake.lua`」，不是「存在 `include/`」
- `lcui.lib` 必须是 **self-contained**（含全部子库符号）—— 这是 registry 描述符的既有约定
- 二进制 zip 的**顶层结构必须是 `include/` + `lib/`**，与 registry 的 `on_install` 对齐
- zip 文件名必须是 `lcui-<version>-<plat>-<arch>.zip`，`<plat>` ∈ {`windows`, `linux`}，`<arch>` = `x64`，`<version>` = release tag 去掉 `v`
- **版本号取自 git tag**，不依赖 LCUI `xmake.lua` 里的 `set_version("3.0.0-a")` —— 因此发版时不需要改版本号
- `xmake` 的**任务名必须在 argv[1]**：`xmake build -P <dir> <target>`、`xmake require -y -P <dir>`；**不要**写 `xmake -P <dir> build <target>`
- 用 `pwsh` 而不是 bash 做打包：GitHub 的 windows-latest 与 ubuntu-22.04 都有 PowerShell Core，而 Git Bash **不带 `zip` 命令**
- 不使用 `git reset` / `git clean` / 删除文件来解决问题；改动只落在上面两个仓库，不碰别处

---

## Review Focus

1. **`lib/*` 里混着非子库目录**（`lib/ui-router` 只剩生成物）→ 循环会把 `include/ui_router/config.h` 也装出去 → Task 1 Step 2 用 `os.isfile(<dir>/xmake.lua)` 做判据，Step 3 核对布局
2. **`os.filedirs` 返回的是带路径的目录名**（`lib\css`），不是 basename → 直接拼接会得到 `lib/lib\css/include/...`，头一个都装不上 → Task 1 Step 2 要求先 `gsub("\\", "/")`
3. **`**.h` 到底会不会保留多级相对路径** → 若只保留文件名，`yutil/string.h` 会被拍平到 `include/string.h`，`LCUI.h` 的 `#include <yutil.h>` 仍能用但 `yutil/*.h` 全错位 → Task 1 Step 3 要求逐个核对子目录
4. **zip 顶层多出一层目录**（`lcui-3.1.0-windows-x64/include/...`）→ registry 的 `on_install` 找不到 `include` / `lib` → Task 2 Step 3 要求实际解压核对
5. **只有 Windows 产出 zip，Linux 没有** → registry 的 linux binary URL 仍然 404 → Task 2 Step 2 要求 Linux runner 也走同一步
6. **版本号写成 `3.0.0-a`（LCUI 的 `set_version`）而不是 tag** → zip 文件名与 release tag 对不上 → Task 2 Step 1 强制从 `github.ref` 取

---

### Task 1: LCUI `xmake.lua` —— lcui 包自带子库头文件 + `lcui.lib` 合并

**Files:**
- Modify: `C:/Users/LC-So/.local/share/opencode/worktree/4e73da/tidy-cactus/xmake.lua`（`target("lcui")` 内的 `add_headerfiles` 那一行之后）

**Interfaces:**
- Consumes: 无（只依赖 LCUI 自身的 `lib/*` 结构）
- Produces: `xmake install -o <dir> lcui` 的产物为 `<dir>/include/`（9 个扁平根头 + 各自子目录 + `LCUI/`）与 `<dir>/lib/lcui.lib`（self-contained）；registry 的 `on_install` 直接 `os.cp("include", ...)` / `os.cp("lib", ...)` 即可

- [ ] **Step 1: 确认工作树处于可构建的干净状态**

在工作树根目录：

```bash
git status --short          # 期望：无输出
git branch --show-current   # 期望：plan/xmake-repo
xmake f -y -k static -m release
xmake build lcui
```

Expected: 配置成功、`build ok`。

- [ ] **Step 2: 在 `target("lcui")` 里加头文件合并循环与合并策略**

找到 `target("lcui")` 末尾这一行：

```lua
    add_headerfiles("include/LCUI.h", "include/(LCUI/**.h)")
```

在它之后追加：

```lua
    -- lcui is a self-contained package: the umbrella header LCUI.h includes each
    -- sub-library's flat root header, so those headers must be installed together
    -- with lcui for consumers to be able to #include <LCUI.h>.
    -- Iterate over lib/* instead of listing every sub-library: the set of
    -- sub-libraries changes over time (ui-cursor, ui-router and worker were
    -- merged away) and the loop adapts on its own. A directory counts as a
    -- sub-library only when it has its own xmake.lua -- lib/ui-router is a
    -- leftover holding nothing but a generated config header.
    for _, subdir in ipairs(os.filedirs("lib/*")) do
        local incdir = subdir:gsub("\\", "/") .. "/include"
        if os.isfile(subdir .. "/xmake.lua") and os.isdir(incdir) then
            add_headerfiles(incdir .. "/(**.h)")
        end
    end
    -- Merge the sub-library archives into lcui.lib so that the published
    -- library is self-contained, as the xmake registry package expects.
    set_policy("build.merge_archive", true)
```

要点：
- `os.filedirs("lib/*")` 返回**带路径的目录名**（`lib\css`），必须先 `gsub("\\", "/")` 再拼 `/include`
- **判据用 `xmake.lua`，不用 `include/`** —— 否则残留的 `lib/ui-router/include/ui_router/config.h` 会被当成子库头装出去
- 用 `**.h` 而不是 `<lib>.h` + `<lib>/*.h` 两条 —— `**` 会捕获 `include/` 之下的完整相对路径，一条就够，且不需要知道子库叫什么
- **不要**写成 `add_headerfiles("lib/*/include/(**.h)")` —— xmake 的字面量前缀里不能含 `*`，实测该写法装不出任何文件

- [ ] **Step 3: 构建并安装，核对头文件布局**

```bash
xmake f -y -k static -m release
xmake build lcui
xmake install -o inst lcui
ls inst/include
ls inst/lib
```

Expected 构建日志出现一行 `merging.release lcui.lib`。

Expected `inst/include/` 顶层共 **13 个文件** = `LCUI.h` 伞形头 + 12 个子库根头：

```
LCUI.h
css.h  ctest.h  i18n.h  pandagl.h  ptk.h  router.h  thread.h
ui.h  ui_cursor.h  ui_server.h  ui_xml.h  yutil.h
```

（11 个子库里有 12 个根头，因为 `libui-server` 同时安装 `ui_server.h` 和 `ui_cursor.h`。`LCUI.h` 只引用其中 9 个：`yutil.h`、`css.h`、`pandagl.h`、`ui.h`、`ui_cursor.h`、`ui_server.h`、`ui_xml.h`、`thread.h`、`ptk.h`。）

Expected `inst/include/` 的**子目录**共 9 个：

```
css/  LCUI/  pandagl/  ptk/  router/  ui/  ui_server/  ui_xml/  yutil/
```

（`ctest.h`、`i18n.h`、`thread.h` 是单头，没有同名目录。）

**不得出现** `ui_router.h` 或 `ui_router/` —— 那说明循环把残留目录当成了子库。

Expected `inst/lib/` 只有一个文件 `lcui.lib`，体积约 **3.0 MB**（实测 3,113,362 字节）。未合并时 `lcui.lib` 只有约 724 KB（实测 741,278 字节）—— 所以「明显变大」本身就是 `merge_archive` 生效的证据。

> 若 `inst/include/` 里少了某个子库的扁平根头，检查该子库目录下是否真的有 `xmake.lua`。
> 若 `inst/include/yutil/` 之类子目录为空或缺失，说明 `**.h` 被当成了只保留文件名 —— 换成 `lib/<x>/include/(<x>.h)` + `lib/<x>/include/(<x>/*.h)` 两条显式写法。

- [ ] **Step 4: 验证消费方能编译并链接**

在工作树里建一个临时消费方工程（`inst/` 之外，用完删掉）：

```lua
set_project("consumer")
add_includedirs("<worktree>/inst/include")
target("consumer")
    set_kind("binary")
    add_files("main.c")
    add_links("<worktree>/inst/lib/lcui.lib", "user32", "gdi32", "shell32", "ole32")
```

`main.c`：

```c
#include <LCUI.h>

int main(void)
{
    return lcui_get_version() ? 0 : 1;
}
```

Run: `xmake -P <consumer-dir>`
Expected: `compiling.release main.c` → `linking.release consumer.exe` → `build ok`

如果链接阶段报 `LNK2019: 无法解析的外部符号 ptk_app_exit / logger_log / list_create` 之类 LCUI 内部符号，说明 `merge_archive` 没生效 —— 检查 `set_policy("build.merge_archive", true)` 是否在 `target("lcui")` **内部**（放在 target 外面不会生效）。

> 只剩 `FT_Init_FreeType` / `png_*` 这类**外部**依赖未解析是正常的 —— 它们由 registry 的 `add_deps("freetype", "libpng", ...)` 提供。

- [ ] **Step 5: 清理临时产物**

```bash
rm -rf inst <consumer-dir>
git status --short     # 期望：只有 xmake.lua 一处修改
```

- [ ] **Step 6: 提交**

```bash
git add xmake.lua
git commit -m "build(lcui): ship sub-library headers and merge archives into lcui.lib"
```

---

### Task 2: LCUI `.github/workflows/ccpp.yml` —— 产出并归档二进制 zip

**Files:**
- Modify: `C:/Users/LC-So/.local/share/opencode/worktree/4e73da/tidy-cactus/.github/workflows/ccpp.yml`

**Interfaces:**
- Consumes: Task 1 产出的 `xmake install -o <dir> lcui` 布局
- Produces: `dist/lcui-<tag去v>-<plat>-x64.zip`，顶层是 `include/` + `lib/`；该 zip 进 artifact，`release` job 已用 `file: ${{ env.ARTIFACT_DIR }}/*` + `file_glob: true` 上传，无需改动

- [ ] **Step 1: 在 `build` job 里新增打包步骤**

现有 `Package` 步骤（约在第 93-96 行）：

```yaml
      - name: Package
        run: |
          xmake package
          xmake install -o dist/lcui-package
```

在它之后插入：

```yaml
      - name: Build binary archive
        if: startsWith(github.ref, 'refs/tags/v')
        shell: pwsh
        run: |
          $plat = if ($env:RUNNER_OS -eq 'Windows') { 'windows' } else { 'linux' }
          $version = $env:GITHUB_REF -replace '^refs/tags/v', ''
          xmake install -o dist/lcui-bin lcui
          Compress-Archive -Path dist/lcui-bin/* -DestinationPath "dist/lcui-$version-$plat-x64.zip"
          Get-Item "dist/lcui-$version-$plat-x64.zip" | Select-Object Name, Length
```

要点：
- **`if: startsWith(github.ref, 'refs/tags/v')`** —— 只有打 tag 的构建才产出 zip，分支构建不产，也不需要改 `set_version`
- 版本号从 `github.ref` 取（`refs/tags/v3.1.0` → `3.1.0`），**不要**用 `xmake.lua` 的 `set_version("3.0.0-a")`
- `xmake install -o dist/lcui-bin lcui` 只装 lcui target，产物顶层就是 `include/` + `lib/`
- `Compress-Archive -Path dist/lcui-bin/*`（带 `/*`）使 zip **顶层直接是 `include/` 与 `lib/`**，没有多一层目录
- 放在 `Package` 之后 —— 那一步之前已经跑过 `xmake config -y -k static -m release` 与 `xmake`，安装复用 release 构建

- [ ] **Step 2: 让 zip 进 release 资产**

现有 artifact 上传步骤（约在第 125-130 行）：

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: lcui${{ env.TARGET_MAJOR }}-${{ env.TARGET_VERSION }}-${{ env.TARGET_KIND }} (${{ runner.os }})
          path: |
            dist/lcui-package
```

改成在 `path:` 里加一行：

```yaml
          path: |
            dist/lcui-package
            dist/lcui-*.zip
```

要点：
- 加进**现有** artifact 而不是新建一个 —— release job 用 `actions/download-artifact@v4` 一次性下载全部 artifact，再用 `svenstaro/upload-release-action`（`file: ${{ env.ARTIFACT_DIR }}/*` + `file_glob: true`）发布；走同一条路径就不用改 release job
- 分支构建时 `dist/lcui-*.zip` 不存在 → `upload-artifact@v4` 默认 `if-no-files-found: warn`，不会失败
- 两个 runner 的 artifact 名带 `(${{ runner.os }})` 后缀，不会重名冲突
- **Linux 与 Windows 都会产出** —— `build` job 的矩阵本来就含 `ubuntu-latest`

- [ ] **Step 3: 本地复现打包逻辑，核对 zip 结构**

在 `tidy-cactus` 里（Task 1 之后）：

```powershell
xmake install -o dist/lcui-bin lcui
Compress-Archive -Path dist/lcui-bin/* -DestinationPath "dist/lcui-3.0.0-windows-x64.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead("$PWD\dist\lcui-3.0.0-windows-x64.zip")
$z.Entries | ForEach-Object { $_.FullName } | Select-Object -First 20
$z.Dispose()
```

Expected:
- 第一批条目是 `include/...` 与 `lib/...`，**没有** `lcui-3.0.0-windows-x64/` 这一层前缀
- `include/` 下有 `LCUI.h`、`yutil.h`、`css.h` 等扁平根头
- `lib/` 下有 `lcui.lib`

核对完删掉 `dist/lcui-bin` 与那个 zip（`dist/` 已被 gitignore，但别留下误导性文件）。

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/ccpp.yml
git commit -m "ci(release): publish lcui binary archives as release assets"
```

---

### Task 3: registry —— 修 `--ver` 的 `v` 前缀 bug

**仓库：** `F:/code/lcui-xmake-repo`（**不是** `tidy-cactus`）

**Files:**
- Modify: `scripts/update-versions.mjs`（`run()` 里的显式发版分支）
- Test: `tests/update-versions.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: 导出的 `normalizeVersion(version: string) -> string`（去掉开头的 `v`）；`run()` 在 `--pkg lcui --ver v3.1.0` 时把 `versions.json` 的版本写成 `3.1.0`，描述符里 `source:add("versions", "3.1.0", ...)`，binary 的 `windows-x64:3.1.0` 别名键也用 `3.1.0`

- [ ] **Step 1: 写失败测试**

在 `tests/update-versions.test.mjs` 追加：

```js
test("normalizeVersion strips a leading v from release tags", () => {
    assert.equal(normalizeVersion("v3.1.0"), "3.1.0");
    assert.equal(normalizeVersion("3.1.0"), "3.1.0");
    assert.equal(normalizeVersion("v3.1.0-rc1"), "3.1.0-rc1");
});
```

并在 import 里加上 `normalizeVersion`。

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "tests/**/*.test.mjs"`
Expected: FAIL —— `normalizeVersion is not a function`

- [ ] **Step 3: 实现 `normalizeVersion`**

在 `scripts/update-versions.mjs` 里，`bumpSemver` 函数之前加上：

```js
// Release tags are written as "v3.1.0" but the package version must be the bare
// semver: it ends up in the binary download URL
// (lcui-<version>-<plat>-<arch>.zip) and in the release asset name.
export function normalizeVersion(version) {
    return String(version).replace(/^v/, "");
}
```

- [ ] **Step 4: 在 `run()` 里使用它**

把 `run()` 中这一行

```js
        if (args.pkg && args.ver) { version = args.ver; commit = releaseCommit; } // explicit release (lcui tag)
```

改成

```js
        if (args.pkg && args.ver) { version = normalizeVersion(args.ver); commit = releaseCommit; } // explicit release (lcui tag)
```

> 只改这一处即可：`applySourceUpdate` 与 `applyBinaryShaUpdate` 都吃 `version` 这个已规范化的值。

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test "tests/**/*.test.mjs"`
Expected: `# pass 10`、`# fail 0`

- [ ] **Step 6: 提交**

```bash
git add scripts/update-versions.mjs tests/update-versions.test.mjs
git commit -m "fix(update-versions): normalize release tags to bare semver versions"
```

---

### Task 4: 发版端到端验证 —— **本阶段不做**

**状态：推迟。** 用户明确现阶段不打 tag、不测试发版。本任务保留为确定 release 时的操作清单，不计入本次完成标准。

等真正要发版时，按顺序：

1. **先解决 registry 的失效版本钉**（`packages/versions.json` 里 `lcui` / `pandagl` / `css` 的 commit 已不在 LCUI 的 `develop` 历史上，`xmake require` 会报 `upload-pack: not our ref`）。处理方式需用户决定：跑 `node scripts/update-versions.mjs --source F:/code/LCUI`（会 patch bump），或只把失效 commit 重指到当前 `develop`，或不改版本号只在发版时重建。
2. 在 `tidy-cactus` 上完成 Task 1、Task 2 并合入 LCUI 主线。
3. 打 tag `v<X.Y.Z>` 推送，等 CI 产出 release 资产 `lcui-<X.Y.Z>-windows-x64.zip` 与 `lcui-<X.Y.Z>-linux-x64.zip`。
4. 在 registry 手动触发 `sync-and-test` workflow，`lcui_tag` 填 `v<X.Y.Z>`，勾选 `commit`。
5. `xmake require --info lcui` 应显示 binary scheme 命中（不是回退到 source）。
6. 在干净工程里 `#include <LCUI.h>` + `add_packages("lcui")` 能编译并链接。

---

## 完成标准（本阶段）

- `tidy-cactus` 的 `target("lcui")` 循环安装子库头文件，且跳过 `lib/ui-router` 这类无 `xmake.lua` 的残留目录
- `xmake install -o <dir> lcui` 产出的 `include/` 有 13 个顶层文件（`LCUI.h` + 12 个子库根头）+ 9 个子目录，`lib/lcui.lib` 约 3.0 MB（未合并时约 724 KB）
- 用该布局编译 `#include <LCUI.h>` 并链接 `lcui.lib` 成功（只剩 freetype / libpng 等外部依赖未解析）
- `ccpp.yml` 在 tag 构建时产出 `lcui-<version>-<plat>-x64.zip`，顶层是 `include/` + `lib/`，并随现有 artifact 进入 release
- registry 的 `update-versions.mjs` 把 `v3.1.0` 规范化成 `3.1.0`，单测 10/10
- 不产生 tag、不触发 release

---

## 已被预验证的部分（2026-11-02，在 `tidy-cactus` 上实测后还原）

Task 1 的代码块与期望值已经在本机上跑通过一次，随后 `git checkout -- xmake.lua` 还原：

- 加完后构建日志出现 `merging.release lcui.lib`，`lcui.lib` 从 741,278 字节变成 **3,113,362 字节**
- `xmake install -o inst lcui` 产出 `inst/include/`（13 个顶层文件 + 9 个子目录）与 `inst/lib/lcui.lib`
- 没有出现 `ui_router.h` / `ui_router/`（`xmake.lua` 判据生效）
- 消费方 `#include <LCUI.h>` 编译通过、链接到 `lcui.lib` 时 LCUI 内部符号全部解析，只剩 `FT_Init_FreeType` 等外部依赖

所以执行 Task 1 时若结果与上表不符，说明环境或子库布局又变了，先停下核对，不要按「大概能行」继续。
