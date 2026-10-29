# LCUI 二进制包链路打通 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `lcui` 包的 binary scheme 真正可用 —— LCUI 的 CI 产出规范命名的二进制 zip 并发布到 release，registry 能下载安装；装完的 `lcui` 包自带全部子库头文件且 `lcui.lib` 是 self-contained 的。

**Architecture:** 改动分两侧。LCUI 仓库：`target("lcui")` 额外安装各子库的扁平头文件，并开启 `build.merge_archive` 让 `lcui.lib` 内含全部子库符号；CI 新增一步把 `xmake install -o` 的产物打成 `lcui-<version>-<plat>-<arch>.zip` 并随 release 发布。registry 仓库：修掉 `--ver` 收到带 `v` 的 tag 导致 binary URL 拼错版本号的 bug。zip 顶层结构是 `include/` + `lib/`，与 registry 既有的 `on_install` 完全对齐，无需改动。

**Tech Stack:** xmake 3.1.1（`build.merge_archive` 策略）、GitHub Actions、PowerShell Core、Node.js 24。

**Spec:** `docs/superpowers/specs/2026-10-29-lcui-registry-tests-and-binary-packaging-design.md`（Part 2 / §4.2、Part 3 / §4.3、§2.6 的 F4/F5/F6）

---

## Preconditions

- **需要用户授权修改 `F:\code\LCUI` 仓库**（Task 1、Task 2 改的是那个仓库）。未获授权前只做 Task 3、Task 4（registry 侧）。
- **LCUI 的工作树当前处于重构中间态**：`lib/ui-cursor` 与 `lib/ui-router` 正在被合并进 `lib/ui-server` 与 `src/widgets/`，但根 `xmake.lua` 还没跟上 —— **主工作树构建不过**。
  因此 Task 1、Task 2 在 **HEAD 的独立 worktree** 里做与验证：

  ```bash
  git -C F:/code/LCUI worktree add <worktree-dir> HEAD
  ```

  该 worktree 可以正常 configure 与 build（实测：configure 退出码 0，`xmake build lcui` 约 7 秒完成链接）。
  做完后用 `git -C F:/code/LCUI worktree remove <worktree-dir>` 清理。

---

## Global Constraints

- 不硬编码子库清单：头文件合并用**循环遍历 `lib/*`**，子库增减时自动适配
- `lcui.lib` 必须是 **self-contained**（含全部子库符号）—— 这是 registry 描述符的既有约定
- 二进制 zip 的**顶层结构必须是 `include/` + `lib/`**，与 registry 的 `on_install` 对齐
- zip 文件名必须是 `lcui-<version>-<plat>-<arch>.zip`，`<plat>` ∈ {`windows`, `linux`}，`<arch>` = `x64`，`<version>` = release tag 去掉 `v`
- **版本号取自 git tag**，不依赖 LCUI `xmake.lua` 里的 `set_version("3.0.0-a")` —— 因此发版时不需要改版本号
- `xmake` 的**任务名必须在 argv[1]**：`xmake build -P <dir> <target>`、`xmake require -y -P <dir>`；**不要**写 `xmake -P <dir> build <target>`
- 用 `pwsh` 而不是 bash 做打包：GitHub 的 windows-latest 与 ubuntu-22.04 都有 PowerShell Core，而 Git Bash **不带 `zip` 命令**
- 不使用 `git reset` / `git clean` / 删除文件来解决问题

---

## Review Focus

1. **`lib/*` 目录名里带 `\`（Windows）** → 循环拼出的 pattern 变成 `lib\lib\css/include/...`，静默装不上头 → Task 1 Step 3 的安装结果核对
2. **`os.filedirs` 返回的是带路径的目录名**（`lib\css`），不是 basename → 直接拼接会得到 `lib/lib\css/...`，头一个都装不上 → Task 1 Step 2 明确要求先 `gsub("\\", "/")`
3. **zip 顶层多出一层目录**（`lcui-3.1.0-windows-x64/include/...`）→ registry 的 `on_install` 找不到 `include` / `lib` → Task 2 Step 3 要求实际解压核对
4. **只有 Windows 产出 zip，Linux 没有** → registry 的 linux binary URL 仍然 404 → Task 2 Step 2 要求 Linux runner 也走同一步
5. **版本号写成 `3.0.0-a`（LCUI 的 `set_version`）而不是 tag** → zip 文件名与 release tag 对不上 → Task 2 Step 1 强制从 `github.ref` 取

---

### Task 1: LCUI `xmake.lua` —— lcui 包自带子库头文件 + lcui.lib 合并

**Files:**
- Modify: `F:/code/LCUI/xmake.lua`（`target("lcui")`，当前在第 90-118 行）

**Interfaces:**
- Consumes: 无（只依赖 LCUI 自身的目录结构）
- Produces: `xmake install -o <dir> lcui` 的产物为 `<dir>/include/`（含全部子库扁平根头 + `LCUI/` 子目录）与 `<dir>/lib/lcui.lib`（self-contained）；registry 的 `on_install` 直接 `os.cp("include", ...)` / `os.cp("lib", ...)` 即可

- [ ] **Step 1: 准备独立 worktree**

```bash
git -C F:/code/LCUI worktree add C:/Users/LC-So/AppData/Local/Temp/opencode/lcui-head HEAD
cd C:/Users/LC-So/AppData/Local/Temp/opencode/lcui-head
```

- [ ] **Step 2: 在 `target("lcui")` 里加头文件合并循环与合并策略**

把 `xmake.lua` 中 `target("lcui")` 末尾那行

```lua
    add_headerfiles("include/LCUI.h", "include/(LCUI/**.h)")
```

替换为

```lua
    add_headerfiles("include/LCUI.h", "include/(LCUI/**.h)")
    -- lcui is a self-contained package: the umbrella header LCUI.h includes each
    -- sub-library's flat root header, so those headers must be installed together
    -- with lcui for consumers to be able to #include <LCUI.h>.
    -- Iterate over lib/* instead of listing every sub-library: the set of
    -- sub-libraries changes over time and the loop adapts on its own.
    for _, subdir in ipairs(os.filedirs("lib/*")) do
        local incdir = subdir:gsub("\\", "/") .. "/include"
        if os.isdir(incdir) then
            add_headerfiles(incdir .. "/(**.h)")
        end
    end
    -- Merge the sub-library archives into lcui.lib so that the published
    -- library is self-contained, as the xmake registry package expects.
    set_policy("build.merge_archive", true)
```

要点：
- `os.filedirs("lib/*")` 返回**带路径的目录名**（`lib\css`），必须先 `gsub("\\", "/")` 再拼 `/include`
- 用 `**.h`（而不是 `<lib>.h` + `<lib>/*.h` 两条）—— `**` 会捕获 `include/` 之下的完整相对路径，一条就够，且不需要知道子库叫什么
- **不要**写成 `add_headerfiles("lib/*/include/(**.h)")` —— xmake 的字面量前缀里不能含 `*`，实测该写法装不出任何文件

- [ ] **Step 3: 构建并安装，核对头文件布局**

```bash
xmake f -y -k static -m release
xmake build lcui
xmake install -o inst lcui
```

Expected 构建日志出现一行：

```
merging.release lcui.lib
```

Expected 安装结果（`inst/include/` 下的文件）：

```
css.h  ctest.h  i18n.h  LCUI.h  pandagl.h  ptk.h  router.h
thread.h  ui.h  ui_cursor.h  ui_router.h  ui_server.h  ui_xml.h
worker.h  yutil.h
```

外加子目录 `css/ LCUI/ pandagl/ ptk/ router/ ui/ ui_server/ ui_xml/ worker/ yutil/`。

Expected `inst/lib/lcui.lib` 的体积**远大于**未合并时的 200KB（实测合并后约 2.3MB）。

> 如果 `inst/include/` 里少了某个子库的扁平根头，说明循环没覆盖到 —— 检查该子库目录是不是叫别的名字（例如重构后 `ui_cursor.h` 挪到了 `lib/ui-server/include/`）。

- [ ] **Step 4: 验证消费方能编译并链接**

在 worktree 里建一个临时消费方工程：

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

如果链接阶段报 `LNK2019: 无法解析的外部符号 ptk_app_exit / logger_log / list_create` 之类，说明 `merge_archive` 没生效 —— 回去检查 `set_policy("build.merge_archive", true)` 是否在 `target("lcui")` 内部（放在 target 外面不会生效）。

> 只剩 `FT_Init_FreeType` 这类**外部**依赖未解析是正常的 —— 它们由 registry 的 `add_deps("freetype", "libpng", ...)` 提供。

- [ ] **Step 5: 提交**

```bash
git add xmake.lua
git commit -m "build(lcui): ship sub-library headers and merge archives into lcui.lib"
```

- [ ] **Step 6: 清理 worktree**

```bash
git -C F:/code/LCUI worktree remove C:/Users/LC-So/AppData/Local/Temp/opencode/lcui-head
```

> 若用户打算把改动带回主工作树（重构合并之后），此时再 cherry-pick 或手工搬运。

---

### Task 2: LCUI `ccpp.yml` —— 产出并发布二进制 zip

**Files:**
- Modify: `F:/code/LCUI/.github/workflows/ccpp.yml`（`build` job 的 steps）

**Interfaces:**
- Consumes: Task 1 产出的 `xmake install -o <dir> lcui` 布局
- Produces: release 资产 `lcui-<tag去v>-windows-x64.zip` 与 `lcui-<tag去v>-linux-x64.zip`，zip 顶层是 `include/` + `lib/`

- [ ] **Step 1: 在 `build` job 里新增打包步骤**

在现有 `Package` 步骤之后插入：

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
- **`if: startsWith(github.ref, 'refs/tags/v')`** —— 只有打 tag 的构建才产出 zip。分支构建不产，也不需要改 `set_version`
- 版本号从 `github.ref` 取（`refs/tags/v3.1.0` → `3.1.0`），**不要**用 `xmake.lua` 的 `set_version("3.0.0-a")`
- `xmake install -o dist/lcui-bin lcui` 只装 lcui target，产物顶层就是 `include/` + `lib/`
- `Compress-Archive -Path dist/lcui-bin/*`（带 `/*`）使 zip **顶层直接是 `include/` 与 `lib/`**，没有多一层目录
- 用 `pwsh`：GitHub 的两个 runner 都有 PowerShell Core，Git Bash 不带 `zip` 命令
- 放在 `Package` 步骤之后 —— 那一步已经跑过 `xmake config -y -k static -m release` 与 `xmake`，安装会复用 release 构建

- [ ] **Step 2: 让 zip 进入 release 资产**

现有 artifact 上传步骤：

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: lcui${{ env.TARGET_MAJOR }}-${{ env.TARGET_VERSION }}-${{ env.TARGET_KIND }} (${{ runner.os }})
          path: |
            dist/lcui-package
```

改成：

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: lcui${{ env.TARGET_MAJOR }}-${{ env.TARGET_VERSION }}-${{ env.TARGET_KIND }} (${{ runner.os }})
          path: |
            dist/lcui-package
            dist/lcui-*.zip
```

要点：
- 加进**现有** artifact 而不是新建一个 —— release job 用 `actions/download-artifact@v4` 一次性下载全部 artifact，再用 `svenstaro/upload-release-action`（`file: ${{ env.ARTIFACT_DIR }}/*` + `file_glob: true`）发布。走同一条路径就不用改 release job
- 分支构建时 `dist/lcui-*.zip` 不存在 → `upload-artifact@v4` 默认 `if-no-files-found: warn`，不会失败
- 两个 runner 的 artifact 名带 `(${{ runner.os }})` 后缀，不会重名冲突 ✓
- **Linux 与 Windows 都会产出** zip —— `build` job 的矩阵本来就含 `ubuntu-latest` ✓

- [ ] **Step 3: 本地验证 zip 结构**

在 worktree 里复现 Task 2 Step 1 的打包逻辑：

```powershell
xmake install -o dist/lcui-bin lcui
Compress-Archive -Path dist/lcui-bin/* -DestinationPath "dist/lcui-3.0.0-windows-x64.zip"
```

然后列出 zip 内容：

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead("$PWD\dist\lcui-3.0.0-windows-x64.zip")
$z.Entries | ForEach-Object { $_.FullName }
$z.Dispose()
```

Expected:
- 第一批条目就是 `include/...` 与 `lib/...`，**没有** `lcui-3.0.0-windows-x64/` 这一层前缀
- `include/` 下有 `LCUI.h`、`yutil.h`、`css.h` 等扁平根头
- `lib/` 下有 `lcui.lib`

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/ccpp.yml
git commit -m "ci(release): publish lcui binary archives as release assets"
```

---

### Task 3: registry —— 修 `--ver` 的 `v` 前缀 bug

**Files:**
- Modify: `scripts/update-versions.mjs`（`run()` 里的显式发版分支）
- Test: `tests/update-versions.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: 导出的 `normalizeVersion(version: string) -> string`（去掉开头的 `v`）；`run()` 在 `--pkg X --ver v3.1.0` 时把 `versions.json` 的版本写成 `3.1.0`，描述符里 `source:add("versions", "3.1.0", ...)`，binary 的 `windows-x64:3.1.0` 别名键也用 `3.1.0`

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

> 只改这一处即可：`applySourceUpdate` 与 `applyBinaryShaUpdate` 都吃 `version` 这个已规范化的值，`versions.json` 写的是 `manifest[pkg] = { version, commit }` 的同一个变量。

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test "tests/**/*.test.mjs"`
Expected: `# pass 10`、`# fail 0`

- [ ] **Step 6: 验证 workflow 拼出的文件名与 LCUI 产出一致**

LCUI CI 产出的文件名来自 `github.ref` 去掉 `refs/tags/v`（Task 2 Step 1）；registry 拼出的文件名来自描述符里的 `lcui-$(version)-windows-x64.zip`，`$(version)` 是描述符里 `source:add("versions", "<version>", ...)` 的那个版本串 —— 规范化后与前者逐字符一致 ✓

手工核对一遍（把 `<TAG>` 换成真实 tag）：

```bash
node scripts/update-versions.mjs --source <LCUI> --pkg lcui --ver v3.1.0 --ref v3.1.0 --dry-run
```

Expected: `versions.json` 里 `lcui.version` 是 `3.1.0`（不带 `v`），描述符里是 `source:add("versions", "3.1.0", ...)`。

> `--dry-run` 目前只是被 `parseArgs` 接受，`run()` 并未实现 dry-run 语义 —— 它**会真的写文件**。因此这条核对请在临时副本上做，或在核对后用 `git checkout -- packages/` 还原。

- [ ] **Step 7: 提交**

```bash
git add scripts/update-versions.mjs tests/update-versions.test.mjs
git commit -m "fix(update-versions): normalize release tags to bare semver versions"
```

---

### Task 4: 发版后的端到端验证

**Files:**
- 无文件改动（验证任务）
- 可能改动: `packages/versions.json` 与 `packages/l/lcui/xmake.lua`（由 registry 的 sync workflow 自动写入）

**Interfaces:**
- Consumes: Task 1、Task 2 产出的 LCUI release 资产；Task 3 产出的版本规范化
- Produces: 确认 `lcui` 包的 binary scheme 命中，而不是回退到 source

- [ ] **Step 1: 在 LCUI 仓库打 tag 并推送**

```bash
git -C F:/code/LCUI tag v3.1.0
git -C F:/code/LCUI push origin v3.1.0
```

等 LCUI 的 CI 跑完，确认 release 里有两个资产：

- `lcui-3.1.0-windows-x64.zip`
- `lcui-3.1.0-linux-x64.zip`

- [ ] **Step 2: 在 registry 仓库触发同步 workflow**

在 `lc-soft/lcui-xmake-repo` 的 Actions 里手动触发 `sync-and-test`，`lcui_tag` 填 `v3.1.0`，`commit` 勾选。

Expected: `Update lcui release entry` 步骤把 `packages/versions.json` 的 `lcui.version` 写成 `3.1.0`（不带 `v`），`packages/l/lcui/xmake.lua` 里出现

```lua
binary:add("versions", "windows-x64:3.1.0", "<sha>")
binary:add("versions", "linux-x64:3.1.0", "<sha>")
```

且 `source:add("versions", "3.1.0", "<commit>")`

- [ ] **Step 3: 验证 binary scheme 命中**

在一个干净的临时工程里：

```lua
add_repositories("lcui-repo https://github.com/lc-soft/lcui-xmake-repo.git")
add_requires("lcui")
target("probe")
    set_kind("phony")
    add_packages("lcui")
```

Run: `xmake require -y -P <dir>` 然后 `xmake require --info lcui -P <dir>`
Expected: `--info` 显示 scheme 为 `binary`，且来源是 GitHub release 的 zip（不是 git clone）

- [ ] **Step 4: 验证安装后的包可用**

在同一个工程里加一个消费方 target：

```lua
target("consumer")
    set_kind("binary")
    add_packages("lcui")
    add_files("main.c")
```

`main.c`：

```c
#include <LCUI.h>

int main(void)
{
    return lcui_get_version() ? 0 : 1;
}
```

Run: `xmake build -P <dir> consumer`
Expected: `build ok` —— 证明 binary 包装出来的头文件布局与 `lcui.lib` 都是完整的

- [ ] **Step 5: 确认 CI 的 install-each job 里 lcui 这一格不再从源码构建**

看 registry 的 `sync-and-test` workflow 运行日志里 `install-each` / `lcui` 这一格：应当只下载 zip，不再 clone LCUI 仓库。

- [ ] **Step 6: 提交同步产生的改动（若 workflow 的 `commit` 输入为 false）**

```bash
git add packages/versions.json packages/l/lcui/xmake.lua
git commit -m "chore: record lcui 3.1.0 release"
```

---

## 完成标准

- `xmake install -o <dir> lcui` 产出的 `include/` 含全部子库扁平根头，`lib/lcui.lib` 是合并过的（体积远大于 200KB）
- 用该布局编译 `#include <LCUI.h>` 并链接 `lcui.lib` 成功
- LCUI 的 release 里存在 `lcui-<version>-windows-x64.zip` 与 `lcui-<version>-linux-x64.zip`，zip 顶层是 `include/` + `lib/`
- `update-versions.mjs` 把 `v3.1.0` 规范化成 `3.1.0`，registry 拼出的 URL 与 release 资产文件名逐字符一致
- `xmake require --info lcui` 显示 binary scheme 命中
