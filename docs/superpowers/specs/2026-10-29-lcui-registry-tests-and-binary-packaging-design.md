# lcui-xmake-repo 测试重组与二进制包链路打通 — 设计文档

- 日期：2026-10-29
- 涉及仓库：`lc-soft/lcui-xmake-repo`（registry）、`lc-soft/LCUI`（源码）
- 状态：设计已批准，待实施

---

## 1. 背景

`lcui-xmake-repo` 是 LCUI 家族的 xmake 包 registry，只持有包描述符、版本清单和同步工具。

当前存在两个从未被验证过的环节：

1. **CI 从未真正编译过任何东西。** `.github/workflows/sync-and-test.yml` 的 `install-each` job 只做 `xmake require -y`（下载安装）和 `xmake require --info`，不编译、不链接、不运行。各包 `on_test` 里的 `has_cfuncs` / `has_cincludes` 检查**一次都没被执行过**（工作流从未跑 `xmake require --test`），所以其中的过时符号一直潜伏。
2. **`lcui` 包的 binary scheme 完全不可用。** `packages/l/lcui/xmake.lua` 声明的下载地址在任何地方都不存在，导致 `lcui` 这一格要么 404、要么回退到 source scheme 从源码构建整个 LCUI。

同时，registry 里的 Node 单元测试（`scripts/update-versions.test.mjs`）与被测代码（`scripts/update-versions.mjs`）混在同一目录，`node --test scripts/` 会连非测试文件一起扫。

本设计要把这三件事一次性理顺。

## 2. 现状事实（均已核实）

### 2.1 仓库与 CI

| 事实 | 证据 |
|---|---|
| registry 现有 6 个包：`lcui`、`yutil`、`pandagl`、`lcui-css`、`lcui-ptk`、`lcui-ctest` | `packages/**/xmake.lua` |
| CI 单测步骤是 `node --test scripts/` | `.github/workflows/sync-and-test.yml:71` |
| `install-each` job 矩阵 = 6 包 × {ubuntu-22.04, windows-latest}，只做 `require -y` + `require --info` | 同文件 `:83-109` |
| 各包 `on_test` 从未执行 | 工作流无 `xmake require --test` |
| `packages/l/lcui-ptk` 的 `on_test` 检查 `ptk_app_create` | `packages/l/lcui-ptk/xmake.lua:37` |
| `ptk_app_create` 在 LCUI 源码中不存在（实际是 `ptk_app_init`） | 全量检索 `F:/code/LCUI` 无匹配；`lib/ptk/include/ptk/app.h:22` |
| `packages/l/lcui` 的 `on_test` 用 `includes = "LCUI.h"` | `packages/l/lcui/xmake.lua:62` |

### 2.2 LCUI 包的构建与头文件布局

| 事实 | 证据 |
|---|---|
| `target("lcui")` 只安装 `include/LCUI.h` 和 `include/LCUI/**.h` | `LCUI/xmake.lua:118` |
| `LCUI.h` 是伞形头，include 了 10 个子库的**扁平**头名 | `LCUI/include/LCUI.h:12-27` |
| 各子库的 `add_headerfiles` 布局统一为「扁平根头 + 同名子目录」 | `lib/*/xmake.lua`（见 §2.4） |
| 子库头文件**不在** lcui 包里 → 单独装 lcui 包时 `#include <LCUI.h>` 必然编译失败 | 布局推导 |
| `LCUI/common.h` 只依赖 `<stddef.h>` 和 `config.h` → `LCUI/base.h` 自洽 | `include/LCUI/common.h:15-16` |
| 全仓库 996 个源文件、约 550 处 include 引用子库根头 | 统计脚本 |

`LCUI.h` 的伞形 include：

```c
#include <yutil.h>   <css.h>      <pandagl.h> <ui.h>      <ui_cursor.h>
#include <ui_server.h> <ui_xml.h> <thread.h> <ptk.h>    <worker.h>
#include <LCUI/worker.h> <LCUI/app.h> <LCUI/ui.h> <LCUI/widgets.h>
#include <LCUI/settings.h> <LCUI/base.h>
```

### 2.3 发布产物与命名

| 事实 | 证据 |
|---|---|
| `ccpp.yml` **没有任何文件命名规则**；release 资产名由 `upload-artifact` 的 name 模板派生：`lcui${MAJOR}-${VERSION}-${KIND} (${OS})` | `LCUI/.github/workflows/ccpp.yml:127` |
| 且上传的是**目录** `dist/lcui-package`，不是 zip | 同文件 `:128-129` |
| GitHub 上现存的 3.x 资产是老版 CI 打的：`lcui3-3.0.0-static.Windows.zip`，挂在 tag `v3.0.0-alpha.0`（2025-01-10），**无 Linux 资产、无 v3.0.0 正式版** | GitHub Releases API |
| Gitee 停在 2.2.0，历史命名毫无规律（`LCUI-2.2.0_x64-windows.lcpkg.zip`、`lcui-1.2.0-beta.zip`、`LCUI-1.0-beta.2 (win32-bin).zip`） | Gitee Releases 页面 |
| registry 写的 `lcui-$(version)-windows-x64.zip` / `...-linux-x64.zip` 在任何地方都不存在 | 实测 404 + API 枚举 |
| **`xmake package` 不产出 zip**：默认格式产出目录树（`build/packages/<字母>/<包名>/<plat>/<arch>/<mode>/`），`-f remote` 产出的是**远程包描述文件**（registry 用的 `xmake.lua`），`-f oldpkg` 产出 `.pkg/` 目录 | 本地实测（`xmake package` / `-f remote` / `-f oldpkg` 三种） |
| **`xmake install -o <dir> <target>` 的输出顶层就是 `include/` + `lib/`**（无 plat/arch/mode 分层） | 本地实测 |
| `add_headerfiles` 的跨目录 pattern 可用，字面量前缀被丢弃：`add_headerfiles("lib/sub2/include/(sub2.h)")` → 安装为 `include/sub2.h` | 本地实测 |
| xmake **没有** `$(projectversion)` 宏 | 全量检索 xmake 源码无匹配 |
| registry 的 URL 格式 `lcui-$(version)-$(plat)-$(arch).zip` 恰好是业界惯例，但**没有任何仓库产出过这种 zip** | §2.3 全部实测 |

> 结论：registry 的 URL 格式本身没错（`lcui-<version>-<plat>-<arch>.zip` 是业界惯例），缺的是「LCUI CI 真的产出并上传这种 zip」+「lcui 包自带子库头文件」。

### 2.4 各子库安装后的头文件布局

| target | `add_headerfiles` | 安装结果 |
|---|---|---|
| `yutil` | `include/yutil.h`, `include/(yutil/*.h)` | `include/yutil.h` + `include/yutil/**` |
| `libcss` | `include/css.h`, `include/(css/*.h)` | `include/css.h` + `include/css/**` |
| `pandagl` | `include/pandagl.h`, `include/(pandagl/*.h)` | `include/pandagl.h` + `include/pandagl/**` |
| `libptk` | `include/ptk.h`, `include/(ptk/*.h)` | `include/ptk.h` + `include/ptk/**` |
| `ctest` | `include/ctest.h` | `include/ctest.h` |
| `libthread` | `include/thread.h` | `include/thread.h` |
| `libworker` | `include/worker.h` | `include/worker.h` |
| `librouter` | `include/router.h` | `include/router.h` |
| `libi18n` | `include/i18n.h` | `include/i18n.h` |
| `libui` | `include/ui.h`, `include/(ui/*.h)` | `include/ui.h` + `include/ui/**` |
| `libui-cursor` | `include/ui_cursor.h`, `include/(ui_cursor/*.h)` | `include/ui_cursor.h` + `include/ui_cursor/**` |
| `libui-server` | `include/ui_server.h`, `include/(ui_server/*.h)` | `include/ui_server.h` + `include/ui_server/**` |
| `libui-xml` | `include/ui_xml.h`, `include/(ui_xml/*.h)` | `include/ui_xml.h` + `include/ui_xml/**` |
| `libui-router` | `include/ui_router.h` | `include/ui_router.h` |

**全部与 `LCUI.h` 里的扁平 include 名严丝合缝** —— 说明伞形头从设计之初就假定「所有子库头文件合并在同一个 include 根目录」，缺的只是打包这一步。

### 2.5 xmake 包名解析规则（实测 + 源码）

源码：`modules/private/action/require/impl/repository.lua:191`

```lua
for _, repo in ipairs(repositories()) do
    local dir = path.join(repo:directory(), rootdir, packagename:sub(1,1), packagename)
    if os.isdir(dir) and os.isfile(path.join(dir, "xmake.lua")) and (not reponame or reponame == repo:name()) then
        foundir = {dir, repo}
        break        -- 第一个命中的仓库胜出
    end
end
```

其中 `repositories()` = `table.join(项目级 repositories, 全局 repositories)`。

实测结论：

| 场景 | 结果 |
|---|---|
| 两个项目级仓库含同名包 | **先 `add_repositories` 的胜出** |
| 项目级仓库 vs 官方全局仓库含同名包 | **项目级胜出** |
| `add_requires("repoB::zzztest")` | 强制指定仓库 ✓ |
| 该包已安装在 `~/.xmake/packages` | 直接复用已安装的，**不再查仓库**（需 `xmake require --clean <pkg>` 才能切换） |

xmake 官方 `xmake-repo` 现有 2032 个包。`css` / `ptk` / `ctest` / `yutil` / `pandagl` / `lcui` **均未被官方占用**（已逐一核查）；LCUI 源码里的 target 名中只有 **`libui`** 与官方包名真实冲突（官方有 `libui`），但 registry 不暴露 `libui` 包，无实际冲突。

## 3. 目标与非目标

### 目标

- G1 把测试代码从 `scripts/` 迁到 `tests/`，与被测代码分离
- G2 为每个包提供一个真实的 C 编译单元，在 CI 里验证「头文件能编译 + 符号能链接 + 间接依赖齐全」
- G3 让 `lcui` 的 binary scheme 真正可用：LCUI CI 产出规范命名的二进制 zip 并上传，registry 能下载安装
- G4 修正 4 个包里失效的 `on_test` 检查
- G5 去掉子库包名的 `lcui-` 前缀，统一为裸名（`css` / `ptk` / `ctest`）

### 非目标

- 不重命名 `yutil` / `pandagl`（保持原名）
- 不改动子库头文件的安装路径（保持扁平根头布局）
- 不改 LCUI 源码里的 C 代码、不改 ABI
- 不把 `lcui` 包拆成多个包（保持 self-contained 单包形态）
- 不处理 Windows 之外的平台（仍只支持 windows / linux）

## 4. 设计

### 4.1 Part 1 · registry 侧：测试重组

#### 4.1.1 目录结构

```
tests/
├── update-versions.test.mjs      # 从 scripts/ 移入
└── c/
    ├── lcui/main.c
    ├── yutil/main.c
    ├── pandagl/main.c
    ├── css/main.c
    ├── ptk/main.c
    └── ctest/main.c
```

`update-versions.test.mjs` 的 import 路径由 `./update-versions.mjs` 改为 `../scripts/update-versions.mjs`。

`node --test tests/` 只会匹配 `*.test.mjs`，`tests/c/**.c` 不参与 Node 测试运行。

#### 4.1.1a 包名去前缀：`lcui-css` → `css`

三个子库包去掉 `lcui-` 前缀，统一为裸名。已核查 xmake 官方 `xmake-repo`（2032 个包）**未占用** `css` / `ptk` / `ctest` ✓

需要同步改动的位置（registry 仓库内，共 6 处）：

| 位置 | 现状 | 改为 |
|---|---|---|
| 目录 | `packages/l/lcui-css/` | `packages/c/css/` |
| 目录 | `packages/l/lcui-ptk/` | `packages/p/ptk/` |
| 目录 | `packages/l/lcui-ctest/` | `packages/c/ctest/` |
| 包描述符首行 | `package("lcui-css")` | `package("css")` |
| `packages/versions.json` 的 key | `"lcui-css"` | `"css"` |
| `scripts/update-versions.mjs` 的 `PACKAGES` 映射 | key + `descriptor` 路径 | 同步改 |
| CI 的子库同步循环 | `for pkg in pandagl yutil lcui-css lcui-ptk lcui-ctest` | `for pkg in pandagl yutil css ptk ctest` |
| CI 的 `install-each` 矩阵 | `pkg: [lcui, yutil, pandagl, lcui-css, lcui-ptk, lcui-ctest]` | `pkg: [lcui, yutil, pandagl, css, ptk, ctest]` |
| README 的包表格 | 旧名 | 新名 |

> `packages/l/` 下改完后只剩 `lcui/`；`packages/c/` 为新建目录（放 `css` 与 `ctest`）；`packages/p/` 下有 `pandagl/` 与 `ptk/`。
>
> `scripts/update-versions.mjs` 的 `PACKAGES` 映射把「包名 → 描述符路径」硬编码在一起（`scripts/update-versions.mjs:10-17`），改名必须同步，否则脚本会抛 `unknown package`。
>
> 包描述符的 `on_install` 里执行的是 `xmake build libcss` / `libptk` / `ctest` —— 那是 **LCUI 源码里的 target 名**，与 registry 包名无关，**不需要改** ✓
>
> 改名是破坏性变更：`add_requires("lcui-css")` 将失效。需在 README 写明迁移说明。

#### 4.1.2 C 冒烟测试的形态

每个 `main.c` 只做两件事：**包含该库的公开头** + **调用一个公开函数**。不做运行期断言。

选择依据（全部已核实存在且自洽）：

| 包 | 头文件 | 调用的函数 | 声明位置 |
|---|---|---|---|
| `lcui` | `<LCUI/base.h>` | `lcui_get_version()` | `include/LCUI/base.h:19` |
| `yutil` | `<yutil/yutil.h>` | `y_strdup("lcui")` | `lib/yutil/include/yutil/string.h:41` |
| `pandagl` | `<pandagl/pandagl.h>` | `pd_canvas_init(&canvas)` | `lib/pandagl/include/pandagl/canvas.h:68` |
| `css` | `<css.h>` | `css_init()` | `lib/css/include/css.h:29` |
| `ptk` | `<ptk/ptk.h>` | `ptk_app_init(L"lcui-test")` | `lib/ptk/include/ptk/app.h:22` |
| `ctest` | `<ctest.h>` | `ctest_equal_int("x", 1, 1)` | `lib/ctest/include/ctest.h:33` |

**为什么 `lcui` 用 `LCUI/base.h` 而不是 `LCUI.h`**：`LCUI.h` 会拉入 10 个子库头，在 Part 3 完成前（子库头尚未合并进 lcui 包）根本编译不过；`LCUI/base.h` 只依赖同目录的 `LCUI/config.h`，任何 scheme 下都成立。

**为什么只编译链接不运行**：`lcui_init()` / `ptk_app_init()` 在 ubuntu runner（无 X11 显示环境）里行为不确定；用户已确认「编译成功、链接成功就够」。运行期断言留给将来的 runtime 测试。

#### 4.1.3 CI 改动

`.github/workflows/sync-and-test.yml`：

1. **Unit tests 步骤**：`node --test scripts/` → `node --test tests/`
2. **install-each job**：把 smoke 目标加进已有的临时 xmake 工程，`require -y` 之后执行 `build`

```yaml
      - name: Resolve + download + build ${{ matrix.pkg }}
        shell: bash
        run: |
          set -e
          d=$(mktemp -d)
          reg="$PWD"
          cp "tests/c/${{ matrix.pkg }}/main.c" "$d/main.c"
          cat > "$d/xmake.lua" <<EOF
          add_rules("mode.debug", "mode.release")
          add_repositories("lcui-repo $reg")
          add_requires("${{ matrix.pkg }}", {system=false})
          target("probe"); set_kind("phony"); add_packages("${{ matrix.pkg }}")
          target("smoke")
              set_kind("binary")
              add_packages("${{ matrix.pkg }}")
              add_files("main.c")
          EOF
          xmake -P "$d" require -y
          xmake -P "$d" require --info "${{ matrix.pkg }}" >/dev/null
          xmake -P "$d" build smoke
```

要点：
- 复用同一个 `$d`，保证 `require` 与 `build` 共享同一份 `xmake-requires.lock`
- `cp` 用**仓库根的相对路径**（workflow 默认工作目录即仓库根），避免 Windows runner 上 `GITHUB_WORKSPACE` 反斜杠路径在 Lua/引号里出问题
- `add_files("main.c")` 相对 `$d` 工程目录，无需绝对路径
- 只 `build`，不 `run`

#### 4.1.4 修正 `on_test`

| 包 | 现状 | 改为 | 理由 |
|---|---|---|---|
| `ptk` | `has_cfuncs("ptk_app_create", {includes = "ptk/ptk.h"})` | `has_cfuncs("ptk_app_init", {includes = "ptk/ptk.h"})` | `ptk_app_create` 不存在 |
| `lcui` | `has_cfuncs("lcui_init", {includes = "LCUI.h"})` | `has_cfuncs("lcui_init", {includes = "LCUI/base.h"})` | `LCUI.h` 拉入子库头，单独装 lcui 包时编译不过 |
| `css` | `has_cincludes("css.h")` | `has_cfuncs("css_init", {includes = "css.h"})` | 从「头在」升级到「符号可链接」 |
| `ctest` | `has_cincludes("ctest.h")` | `has_cfuncs("ctest_equal_int", {includes = "ctest.h"})` | 同上 |

> `on_test` 目前不在 CI 里执行。本设计不新增 `xmake require --test` 步骤 —— `has_cfuncs` 生成的探针程序与 `tests/c/*/main.c` 覆盖重叠，且 `require --test` 的语义（跑包自带的测试）在这些包上不存在。保留 `on_test` 作为包描述符的自描述信息并修正其中的错误符号。

#### 4.1.5 README

- 「Run the tooling tests locally with `node --test scripts/`」→ `node --test tests/`
- 新增一段说明 `tests/c/**` 的作用：验证包安装后头文件可编译、符号可链接、间接依赖齐全；CI 中只编译链接不运行
- 包表格里的名字更新为新名，并补一段**迁移说明**：

  | 旧名 | 新名 |
  |---|---|
  | `lcui-css` | `css` |
  | `lcui-ptk` | `ptk` |
  | `lcui-ctest` | `ctest` |

  `yutil` / `pandagl` / `lcui` 名称不变。

### 4.2 Part 2 · LCUI 侧：让 binary 包可用

#### 4.2.1 `xmake.lua`：lcui target 自带子库头文件

在 `target("lcui")` 中增加：

```lua
    -- lcui 是 self-contained 包：伞形头 LCUI.h 会 include 各子库的扁平头名，
    -- 因此这些头文件必须与 lcui 一起安装，消费方才能 #include <LCUI.h>
    add_headerfiles("lib/yutil/include/(yutil.h)", "lib/yutil/include/(yutil/*.h)")
    add_headerfiles("lib/css/include/(css.h)", "lib/css/include/(css/*.h)")
    add_headerfiles("lib/pandagl/include/(pandagl.h)", "lib/pandagl/include/(pandagl/*.h)")
    add_headerfiles("lib/ptk/include/(ptk.h)", "lib/ptk/include/(ptk/*.h)")
    add_headerfiles("lib/thread/include/(thread.h)")
    add_headerfiles("lib/worker/include/(worker.h)")
    add_headerfiles("lib/router/include/(router.h)")
    add_headerfiles("lib/i18n/include/(i18n.h)")
    add_headerfiles("lib/ui/include/(ui.h)", "lib/ui/include/(ui/*.h)")
    add_headerfiles("lib/ui-cursor/include/(ui_cursor.h)", "lib/ui-cursor/include/(ui_cursor/*.h)")
    add_headerfiles("lib/ui-server/include/(ui_server.h)", "lib/ui-server/include/(ui_server/*.h)")
    add_headerfiles("lib/ui-xml/include/(ui_xml.h)", "lib/ui-xml/include/(ui_xml/*.h)")
    add_headerfiles("lib/ui-router/include/(ui_router.h)")
```

**pattern 写法已实测验证**：`add_headerfiles("lib/yutil/include/(yutil.h)")` 会把文件安装为 `include/yutil.h`（字面量前缀丢弃，通配符部分决定目标结构），`lib/yutil/include/(yutil/*.h)` → `include/yutil/**`。

**不需要给 target 加 `set_version`**：我们不用 `xmake package` 打包（它不产 zip），版本号由 CI 从 git tag 解析（见 §4.2.2），与 `xmake.lua` 的 `set_version("3.0.0-a")` 无关。

**为什么改 `xmake.lua` 而不是改 CI 打包脚本**：改 `xmake.lua` 后 binary 与 source 两种 scheme 的安装布局一致。若只在 CI 脚本里合并，只有 binary 产物是完整的，source scheme 依然编译不过 `<LCUI.h>`。

**为什么保留各子库包自己的头文件**：子库包（`yutil` 等）仍是独立包，各自照常安装自己的头。合并只发生在 lcui 包内，两者互不影响。

#### 4.2.2 `ccpp.yml`：产出并上传二进制 zip

现状：`xmake package` 已执行但产物从未上传；上传的是目录。而 `xmake package` **本身不产 zip**（默认出目录树、`-f remote` 出 registry 描述文件、`-f oldpkg` 出 `.pkg/` 目录），所以二进制归档必须 CI 手工打。

新增一步（放在现有 `Package` 步骤之后）：

```yaml
      - name: Build binary archive
        shell: pwsh
        run: |
          $plat = if ($env:RUNNER_OS -eq 'Windows') { 'windows' } else { 'linux' }
          xmake install -o dist/lcui-bin lcui
          Compress-Archive -Path dist/lcui-bin/* -DestinationPath "dist/lcui-$env:REL_VERSION-$plat-x64.zip"
```

要点：
- `xmake install -o dist/lcui-bin lcui` **只装 lcui target**（不带子库 target），产物顶层就是 `include/` + `lib/`（已实测）
- `Compress-Archive -Path dist/lcui-bin/*` 使 zip **顶层是 `include/` 与 `lib/`**，正好匹配 registry 的 `on_install`（已实测 `xmake install -o` 的扁平输出）
- 用 `pwsh` 而非 bash：GitHub 的 windows-latest 与 ubuntu-22.04 都有 PowerShell Core，而 Git Bash **不带 `zip` 命令**
- **版本号取自 git tag**（`get_release_version.py` 已把 tag 解析为 `REL_VERSION`），不依赖 `xmake.lua` 的 `set_version("3.0.0-a")` —— 因此无需为发版改版本号
- 现有的 `xmake install -o dist/lcui-package`（装全部 target）保留，它服务于 artifact，不参与二进制包

随后把 `dist/lcui-*.zip` 加入 release 资产（`build` job 产出 artifact，`release` job 用 `svenstaro/upload-release-action` 上传）。**Linux 与 Windows 都要有** —— 现有 `build` 矩阵已含 ubuntu-latest，但历史 release 只有 Windows 资产，需确认 Linux 的 zip 也进入 release。

#### 4.2.3 zip 内部结构（已确认）

registry 的 `on_install` 期望 zip 解压后顶层是 `include/` 和 `lib/`：

```lua
    on_install(function (package)
        local scheme = package:current_scheme()
        if scheme and scheme:name() == "binary" then
            os.cp("include", package:installdir("include"))
            os.cp("lib",     package:installdir("lib"))
        else
            import("package.tools.xmake").install(package, {})
        end
    end)
```

§4.2.2 的 `xmake install -o dist/lcui-bin lcui` + `Compress-Archive -Path dist/lcui-bin/*` 恰好产出该结构，**`on_install` 无需修改**。实施时仍需实际解压核对一次作为验收。

### 4.3 Part 3 · registry 侧：binary scheme 对齐

- 核对 `packages/l/lcui/xmake.lua` 的 binary URL 与 LCUI 实际产出的文件名逐字符一致：`<version>` 必须等于 release tag（去掉 `v`）也等于 `versions.json` 的 `lcui.version`；`plat` 为 `windows`/`linux`，`arch` 为 `x64`
- `on_install` 无需修改（§4.2.3 已确认 zip 顶层就是 `include/` + `lib/`）
- `scripts/update-versions.mjs --pkg lcui --ver <tag>` 会把 `versions.json` 的 `lcui.version` 与 URL 同步为 tag ✓
- 在 LCUI 发版后，跑一次 `xmake require --info lcui` 验证 binary scheme 命中（而非回退到 source），并确认 CI 的 `install-each` job 中 `lcui` 这一格不再从源码构建

## 5. 关键决策与理由

| 决策 | 理由 |
|---|---|
| 子库包去前缀（`lcui-css`→`css`、`lcui-ptk`→`ptk`、`lcui-ctest`→`ctest`），`yutil`/`pandagl` 不动 | 用户判断：用了 lcui 的项目不会再装提供同名头文件的库。实测也证明项目级 registry 优先于官方全局仓库，同名包不会跑到官方去；且 `css`/`ptk`/`ctest` 官方均未占用。 |
| 不改子库头文件路径 | 保持 `LCUI.h` 的伞形 include 写法不变，省掉约 550 处 include 改写，也避免与 LCUI 自己的 `include/LCUI/*.h` 撞名。 |
| 头文件合并放在 `xmake.lua` 而非 CI 脚本 | 保证 binary / source 两种 scheme 布局一致（§4.2.1）。 |
| CI 只编译链接，不运行 | ubuntu runner 无 X11 显示环境，`lcui_init` / `ptk_app_init` 行为不确定；编译链接已能覆盖头文件路径、符号导出、间接依赖三类问题。 |
| `lcui` 的 main.c 用 `LCUI/base.h` | 规避 `LCUI.h` 对子库头的依赖，使该测试在 Part 3 完成前后都成立。 |
| 保留 `on_test` 但不执行 | `on_test` 是包描述符的自描述；`has_cfuncs` 与 main.c 覆盖重叠。修正其中的错误符号即可。 |

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 改名后 `scripts/update-versions.mjs` 的 `PACKAGES` 映射漏改 | 同步脚本抛 `unknown package`，子库版本停止更新 | §4.1.1a 已列出全部 6 处同步点；改完立即跑 `node --test tests/` 与一次 dry-run 验证 |
| 改名后 `versions.json` 的 key 与描述符 `package()` 名不一致 | xmake 解析到的包名对不上，版本记录错位 | 同上；CI 的 `Unit tests` 步骤覆盖 `update-versions` 的读写路径 |
| release tag 与 `versions.json` 的 `lcui.version` 不一致 | registry URL 拼出的文件名与 release 资产对不上 → 404 | 两者都由同一个 tag 驱动（CI 用 `REL_VERSION`，registry 用 `update-versions.mjs --ver <tag>`）；发版流程里核对一次 |
| `Compress-Archive` 在两平台产物结构不一致 | zip 顶层多出一层目录 → `on_install` 找不到 include/lib | §8 的验收步骤要求实际解压核对；必要时改用 `tar`/`7z` 或在 `on_install` 里加一层路径兼容 |
| `add_headerfiles` 的跨目录 pattern 在 LCUI 全量子库上行为异常 | 部分子库头没被正确安装 | §4.2.1 的 pattern 写法已用等价结构实测验证；实施后用 `unzip -l` 列出全部头核对 |
| lcui 合并包与独立子库包同时安装 → 两份 `yutil.h` | 头文件版本不一致，潜在 ABI 问题 | README 保留并强化「不要同时依赖」的警告，写明原因（合并包内的头是 LCUI 锁定版本，子库包独立版本） |
| source scheme 从源码构建 LCUI 极慢 | CI 时长上升 | Part 3 完成后 lcui 走 binary；其它子库本来就是 source，CI 已如此 |
| 裸名包（`css`/`ptk`/`ctest`）日后被 xmake 官方占用 | 官方仓库出现同名包 | 项目级 registry 优先（已实测）；必要时用 `add_requires("lcui-repo::css")` 显式指定，或届时改回前缀 |

## 7. 已知的遗留问题（不在本次范围）

- **官方 `libui` 包与 LCUI 的 `libui` target 同名**：若将来把 ui 子库作为独立包发布，registry 里的包名会与官方冲突。缓解手段：项目级 registry 优先（实测），或用 `add_requires("lcui-repo::libui")` 显式指定，或改名加 `lcui-` 前缀。当前 registry 未暴露 `libui` 包，无实际冲突。
- **`xmake require --test` 仍未纳入 CI**：各包的 `on_test` 不执行。可作为后续增强，届时 `has_cfuncs` 会真正验证包可用性。
- **LCUI 的 `lib/*/xmake.lua` 里子库版本是 `0.1.0-a`**，与 registry 里子库包的 `1.0.0` 独立版本体系不同 —— 两套版本号并存，暂不统一。
- **包改名是破坏性变更**：`add_requires("lcui-css")` / `("lcui-ptk")` / `("lcui-ctest")` 在改名后失效，需在 README 给出迁移说明（旧名 → 新名）。

## 8. 验证方式

### Part 1

```bash
# Node 单测
node --test tests/

# C 冒烟测试（本机，需已安装对应包）
d=$(mktemp -d); cp tests/c/yutil/main.c "$d/"; cat > "$d/xmake.lua" <<'EOF'
add_repositories("lcui-repo <本仓库路径>")
add_requires("yutil", {system=false})
target("smoke")
    set_kind("binary")
    add_packages("yutil")
    add_files("main.c")
EOF
xmake -P "$d" require -y && xmake -P "$d" build smoke
```

对 6 个包各执行一遍。

### Part 2

```bash
# 在 LCUI 仓库：确认子库头随 lcui 一起被安装
xmake install -o dist/lcui-bin lcui
ls dist/lcui-bin/include/            # 应看到 LCUI.h, LCUI/, yutil.h, yutil/, css.h, css/, ...
ls dist/lcui-bin/lib/                # 应看到 lcui.lib / liblcui.a

# 打包并核对 zip 顶层结构（Windows 用 Compress-Archive，Linux 用 zip -r）
unzip -l dist/lcui-3.0.0-windows-x64.zip | head -40
# 期望：顶层直接是 include/ 与 lib/，没有多一层目录
```

### Part 3

LCUI 发版后：

```bash
xmake require --info lcui   # 应显示 binary scheme 命中，repo 指向 LCUI release
```

并检查 CI 的 `install-each` job 中 `lcui` 这一格不再回退到 source 构建。

## 9. 实施顺序

1. **Part 1a · 包改名**（registry 内，纯重命名 + 同步点更新，`node --test tests/` 验证）
2. **Part 1b · 测试重组**（registry 内，可立即验证）
3. **Part 2**（LCUI 仓库，本地可验证 zip 结构）
4. **Part 3**（依赖 LCUI 发版，最后收口）
