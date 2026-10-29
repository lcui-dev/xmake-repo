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

### 2.6 写计划阶段新实测出来的 6 条事实

这 6 条都是动手前用最小实验验证出来的，**推翻了初稿里的若干假设**。

| # | 事实 | 证据 | 影响 |
|---|---|---|---|
| F1 | **xmake 只把 argv[1] 当任务名**。`xmake -P d build smoke` 会报 `error: 'build' is not a valid target name for this project.`；正确写法是 `xmake build -P d smoke` | 实测 4 种写法 | 现有 workflow 的 `xmake -P "$d" require -y` **本来就是坏的** —— 这解释了「CI 从未真正编译过任何东西」 |
| F2 | **Node 24 的 `node --test <目录>` 不工作**，报 `Cannot find module '...\scripts'`。可用形式：`node --test`（无参数，自动发现）或 `node --test "tests/**/*.test.mjs"`（glob） | 实测 5 种写法 | 现有 workflow 的 `node --test scripts/` **也是坏的**；spec 初稿写的 `node --test tests/` 同样会坏 |
| F3 | **安装后的头文件是「扁平根头」**：`include/yutil.h` + `include/yutil/*.h`，**不存在** `include/yutil/yutil.h` | 用等价工程实测：`<yutil.h>` 编译通过，`<yutil/yutil.h>` 报 `C1083` | spec 初稿里 3 个包的 include 路径是错的；现有 `on_test` 里 yutil/pandagl/ptk 三处路径也是错的 |
| F4 | **`lcui.lib` 目前不是 self-contained**：LCUI 的 `xmake.lua` 里没有 `build.merge_archive`，`lcui.lib` 只有 200KB（子库各 8KB–400KB，单独存在） | `build/packages/**` 实际产物 | registry 描述符里「lcui.lib is self-contained」的注释与现实不符；binary 包必须解决这一点，否则消费方链接必然缺符号 |
| F5 | **`set_policy("build.merge_archive", true)` 可用**：`lcui.lib` 从 200KB 变成 2.3MB，消费方链接 `lcui_get_version()` 时 LCUI 内部符号（`ptk_app_exit`/`logger_log`/`list_create`…）全部解析，只剩 freetype/libpng 等**外部**依赖未解析 —— 而这些外部依赖 registry 的 `add_deps(...)` 已经声明了 | 在 LCUI HEAD 的独立 worktree 里实测 | Part 2 必须加上这条策略 |
| F6 | **workflow 给 `update-versions.mjs` 传的 `--ver` 是带 `v` 的 tag**（`--ver "${{ github.event.inputs.lcui_tag }}"`，而同一行里算 sha 时用的是去掉 `v` 的 `$V`） | 读 `sync-and-test.yml:56-61` | 版本会变成 `v3.1.0`，binary URL 拼成 `download/vv3.1.0/lcui-v3.1.0-windows-x64.zip` —— 与 CI 实际产出的 `lcui-3.1.0-windows-x64.zip` 对不上，必然 404 |

**另有一条环境事实**：LCUI 仓库的工作树当前处于重构中间态（`lib/ui-cursor` 与 `lib/ui-router` 正在被合并进 `lib/ui-server` 与 `src/widgets/`，但根 `xmake.lua` 还没跟上，工作树**构建不过**）。因此：

- Part 2 的改动必须在 **LCUI HEAD（`9af1bf45f`）的独立 worktree** 里做与验证 —— 该 worktree 可以正常 configure 与 build（实测 7 秒完成链接）
- 头文件合并**不能硬编码 13 条路径**：用循环遍历 `lib/*` 目录（见 §4.2.1），才能在子库增减时自动适配

## 3. 目标与非目标

### 目标

- G1 把测试代码从 `scripts/` 迁到 `tests/`，与被测代码分离
- G2 为每个包提供一个真实的 C 编译单元，在 CI 里验证「头文件能编译 + 符号可链接 + 间接依赖齐全」
- G3 让 `lcui` 的 binary scheme 真正可用：LCUI CI 产出规范命名的二进制 zip 并上传，registry 能下载安装
- G4 修正 6 个包里失效的 `on_test` 检查（3 个 include 路径错 + 3 个符号/级别错）
- G5 去掉子库包名的 `lcui-` 前缀，统一为裸名（`css` / `ptk` / `ctest`）
- G6 让 `lcui.lib` 真正 self-contained（`build.merge_archive`），使 binary 包可独立链接

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
| `yutil` | `<yutil.h>` | `y_strdup("lcui")` | `lib/yutil/include/yutil/string.h:41` |
| `pandagl` | `<pandagl.h>` | `pd_canvas_init(&canvas)` | `lib/pandagl/include/pandagl/canvas.h:68` |
| `css` | `<css.h>` | `css_init()` | `lib/css/include/css.h:29` |
| `ptk` | `<ptk.h>` | `ptk_app_init(L"lcui-test")` | `lib/ptk/include/ptk/app.h:22` |
| `ctest` | `<ctest.h>` | `ctest_equal_int("x", 1, 1)` | `lib/ctest/include/ctest.h:33` |

> **头文件路径必须是「扁平根头」**（`<yutil.h>`），**不是** `<yutil/yutil.h>`。
> 各子库的 `add_headerfiles` 是 `include/<lib>.h` + `include/(<lib>/*.h)` 两条 —— 安装后得到
> `include/yutil.h` + `include/yutil/*.h`，**不存在** `include/yutil/yutil.h`。
> 已用等价工程实测确认：`<yutil.h>` 编译通过，`<yutil/yutil.h>` 报 `C1083: 无法打开包括文件`。
> 这也意味着现有 `on_test` 里 yutil / pandagl / ptk 三处的 `includes` 路径是错的（见 §4.1.4）。

**为什么 `lcui` 用 `LCUI/base.h` 而不是 `LCUI.h`**：`LCUI.h` 会拉入 10 个子库头，在 Part 3 完成前（子库头尚未合并进 lcui 包）根本编译不过；`LCUI/base.h` 只依赖同目录的 `LCUI/config.h`，任何 scheme 下都成立（`config.h` 由 `add_configfiles` 生成，随 `include/(LCUI/**.h)` 一起安装，已实测）。

**为什么只编译链接不运行**：`lcui_init()` / `ptk_app_init()` 在 ubuntu runner（无 X11 显示环境）里行为不确定；用户已确认「编译成功、链接成功就够」。运行期断言留给将来的 runtime 测试。

**静态库的导出宏**：各库的 `*_STATIC_BUILD`（`LIBCSS_STATIC_BUILD` / `PANDAGL_STATIC_BUILD` / `PTK_STATIC_BUILD` / `YUTIL_STATIC_BUILD` / `LCUI_STATIC_BUILD`）由各自**生成的 config 头**携带（`set_configvar` + `add_configfiles`），并随包安装 —— 因此 MSVC 下头文件不会把符号声明成 `__declspec(dllimport)`，静态链接可用。**冒烟测试不需要自己 define 这些宏**。

#### 4.1.3 CI 改动

`.github/workflows/sync-and-test.yml`：

1. **Unit tests 步骤**：`node --test scripts/` → `node --test "tests/**/*.test.mjs"`
2. **install-each job**：改为调用一个仓库内的 Node 驱动脚本 `tests/run-c-smoke.mjs`，它在临时目录里搭好 xmake 工程，`require` 之后 `build smoke`

> **现有的两处 CI 命令都是坏的**：
>
> | 现有命令 | 实际结果 | 正确写法 |
> |---|---|---|
> | `node --test scripts/` | `Error: Cannot find module 'F:\...\scripts'`（Node 24 把目录当模块加载） | `node --test "tests/**/*.test.mjs"` 或 `node --test`（无参数） |
> | `xmake -P "$d" require -y` | `error: 'require' is not a valid target name for this project.` | `xmake require -y -P "$d"` |
>
> xmake 只把 **argv[1]** 当作任务名，`-P` 开头就没有任务，`require` / `build` 被当成 target。
> 已实测四种写法：`xmake -P d build probe` → 报错；`xmake build -P d probe` → OK；
> `xmake -P d require -y` → 报错；`xmake require -y -P d` → OK。
> 这两条合起来解释了「CI 从未真正编译过任何东西」。

**为什么改用 Node 驱动脚本而不是 bash**：

| 问题 | bash 方案 | Node 方案 |
|---|---|---|
| 任务/选项顺序 | 必须写成 `xmake require -y -P "$d"`，容易被后来者改错 | 脚本里一处固定，不出现在 workflow 文本里 |
| Windows 路径 | Git Bash 的 `$PWD`、`mktemp -d` 都是 POSIX 路径（`/d/a/...`），**原生 Windows 版 xmake 无法解析**；需要 `cygpath -m` 手工转换 | `process.cwd()` / `os.tmpdir()` 本身就是原生路径，直接可用 |
| 本地复现 | 需要在 Git Bash 里手工拼命令 | `node tests/run-c-smoke.mjs` 一条命令跑全部 |

`tests/run-c-smoke.mjs` 的行为（Task 3 定义）：

```
node tests/run-c-smoke.mjs            # 跑全部 6 个包
node tests/run-c-smoke.mjs yutil css  # 只跑指定包
```

对每个包：建临时目录 → 复制 `tests/c/<pkg>/main.c` → 写 `xmake.lua`（`add_repositories` 指向仓库根、`add_requires(<pkg>)`、`target("smoke")` 用 `add_packages(<pkg>)` + `add_files("main.c")`）→ 执行 `xmake require -y -P <dir>` → 执行 `xmake build -P <dir> smoke` → **只编译链接，不运行** → 清理临时目录。

workflow 侧相应变成：

```yaml
  install-each:
    needs: update
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-22.04, windows-latest]
        pkg: [lcui, yutil, pandagl, css, ptk, ctest]
    runs-on: ${{ matrix.os }}
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
- `add_packages(<pkg>)` 而不是 `add_includedirs` —— 前者才会真正**链接**库，缺符号会在链接阶段暴露
- 复用同一个临时目录，保证 `require` 与 `build` 共享同一份 `xmake-requires.lock`
- 只 `build`，不 `run`

#### 4.1.4 修正 `on_test`

**6 个包的 `on_test` 全部需要改** —— 其中 3 个的 `includes` 路径指向了不存在的文件，3 个的符号名是错的：

| 包 | 现状 | 改为 | 理由 |
|---|---|---|---|
| `yutil` | `has_cfuncs("y_strdup", {includes = "yutil/yutil.h"})` | `has_cfuncs("y_strdup", {includes = "yutil.h"})` | 安装后没有 `include/yutil/yutil.h`，只有 `include/yutil.h` |
| `pandagl` | `has_cfuncs("pd_canvas_init", {includes = "pandagl/pandagl.h"})` | `has_cfuncs("pd_canvas_init", {includes = "pandagl.h"})` | 同上 |
| `ptk` | `has_cfuncs("ptk_app_create", {includes = "ptk/ptk.h"})` | `has_cfuncs("ptk_app_init", {includes = "ptk.h"})` | 同上 + `ptk_app_create` 这个符号不存在 |
| `lcui` | `has_cfuncs("lcui_init", {includes = "LCUI.h"})` | `has_cfuncs("lcui_init", {includes = "LCUI/base.h"})` | `LCUI.h` 拉入子库头，单独装 lcui 包时编译不过 |
| `css` | `has_cincludes("css.h")` | `has_cfuncs("css_init", {includes = "css.h"})` | 从「头在」升级到「符号可链接」 |
| `ctest` | `has_cincludes("ctest.h")` | `has_cfuncs("ctest_equal_int", {includes = "ctest.h"})` | 同上 |

> `on_test` 目前不在 CI 里执行。本设计不新增 `xmake require --test` 步骤 —— `has_cfuncs` 生成的探针程序与 `tests/c/*/main.c` 覆盖重叠，且 `require --test` 的语义（跑包自带的测试）在这些包上不存在。保留 `on_test` 作为包描述符的自描述信息并修正其中的错误符号与错误路径。

#### 4.1.5 README

- 「Run the tooling tests locally with `node --test scripts/`」→ `node --test "tests/**/*.test.mjs"`（Node 24 不接受目录参数）
- 新增一段说明 `tests/c/**` 的作用：验证包安装后头文件可编译、符号可链接、间接依赖齐全；CI 中只编译链接不运行；并给出本地跑法 `node tests/run-c-smoke.mjs`
- 包表格里的名字更新为新名，并补一段**迁移说明**：

  | 旧名 | 新名 |
  |---|---|
  | `lcui-css` | `css` |
  | `lcui-ptk` | `ptk` |
  | `lcui-ctest` | `ctest` |

  `yutil` / `pandagl` / `lcui` 名称不变。

### 4.2 Part 2 · LCUI 侧：让 binary 包可用

#### 4.2.1 `xmake.lua`：lcui target 自带子库头文件

在 `target("lcui")` 中增加（**循环式，不硬编码子库清单**）：

```lua
    -- lcui 是 self-contained 包：伞形头 LCUI.h 会 include 各子库的扁平头名，
    -- 因此这些头文件必须与 lcui 一起安装，消费方才能 #include <LCUI.h>。
    -- 用循环遍历 lib/* 而不是写死 13 条路径：LCUI 的子库目录正在重构
    -- （ui-cursor / ui-router 被合并进 ui-server / src/widgets），
    -- 循环能在子库增减时自动适配。
    for _, subdir in ipairs(os.filedirs("lib/*")) do
        local incdir = subdir:gsub("\\", "/") .. "/include"
        if os.isdir(incdir) then
            add_headerfiles(incdir .. "/(**.h)")
        end
    end
```

**为什么用 `lib/<x>/include/(**.h)` 而不是 `lib/<x>/include/(<x>.h)` + `lib/<x>/include/(<x>/*.h)` 两条**：`**.h` 会捕获 `include/` 之下的**完整相对路径**，因此 `lib/yutil/include/yutil.h` → `include/yutil.h`、`lib/yutil/include/yutil/string.h` → `include/yutil/string.h`，一条就够，且不需要知道子库叫什么名字。

**为什么 `lib/*/include/(**.h)` 这种「单条通配」不行**：实测该 pattern 安装结果为空 —— xmake 的字面量前缀里不能含 `*`（只有通配符**之后**的部分才参与目标路径计算）。必须先算出具体目录再传进去，这也正是要用循环的原因。

**为什么必须用 `os.filedirs` 而不是 `os.files`**：`os.filedirs("lib/*")` 返回**带路径的目录名**（`lib\css`），不是 basename，直接拼接会得到 `lib/lib\css/include/...`。循环里用 `subdir:gsub("\\", "/")` 统一成正斜杠。

**已实测验证的安装结果**（在 LCUI HEAD 的独立 worktree 里跑 `xmake install -o inst lcui`）：

```
inst/include/   css.h  ctest.h  i18n.h  LCUI.h  pandagl.h  ptk.h  router.h
                thread.h  ui.h  ui_cursor.h  ui_router.h  ui_server.h  ui_xml.h
                worker.h  yutil.h  + 子目录 css/ LCUI/ pandagl/ ptk/ router/ ui/
                ui_server/ ui_xml/ worker/ yutil/
inst/lib/       lcui.lib
```

并且用这份布局编译 `#include <LCUI.h>` + 链接 `inst/lib/lcui.lib` **通过**（只剩 freetype/libpng 等外部依赖未解析，那些由 registry 的 `add_deps(...)` 负责）。

**不需要给 target 加 `set_version`**：我们不用 `xmake package` 打包（它不产 zip），版本号由 CI 从 git tag 解析（见 §4.2.2），与 `xmake.lua` 的 `set_version("3.0.0-a")` 无关。

**为什么改 `xmake.lua` 而不是改 CI 打包脚本**：改 `xmake.lua` 后 binary 与 source 两种 scheme 的安装布局一致。若只在 CI 脚本里合并，只有 binary 产物是完整的，source scheme 依然编译不过 `<LCUI.h>`。

**为什么保留各子库包自己的头文件**：子库包（`yutil` 等）仍是独立包，各自照常安装自己的头。合并只发生在 lcui 包内，两者互不影响。

#### 4.2.1a `xmake.lua`：`lcui.lib` 必须是 self-contained

registry 的描述符写着「lcui.lib is self-contained (all internal sub-libs merged via build.merge_archive)」，但 LCUI 的 `xmake.lua` **从来没有设置这条策略** —— 实测 `lcui.lib` 只有 200KB，而子库各 8KB–400KB 单独存在。消费方链接 `lcui.lib` 会得到一串 `LNK2019`：`ptk_app_exit`、`logger_log`、`list_create`……

修法是在 `target("lcui")` 里加：

```lua
    set_policy("build.merge_archive", true)
```

**已实测验证**（LCUI HEAD worktree）：加上后构建日志出现 `merging.release lcui.lib`，`lcui.lib` 从 200KB 变成 **2.3MB**；消费方链接 `lcui_get_version()` 时 LCUI 内部符号全部解析，只剩 freetype/libpng/libjpeg/libyaml/libxml2/libomp 这些**外部**依赖未解析 —— 而它们 registry 的 `add_deps(...)` 已经声明了。

`build.merge_archive` 是 xmake 的内置策略（`core/project/policy.lua`，默认 `false`），通过 `rules/utils/merge_archive` 实现，xmake >= 2.8.1 可用。

> 这条改动同时影响 source scheme —— registry 的 `lcui` 包走 source 时也会得到合并后的 `lcui.lib`，与 binary scheme 一致 ✓

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

**必须先修 `--ver` 的 `v` 前缀 bug（F6）**：`.github/workflows/sync-and-test.yml:56-61` 里

```yaml
VER="${{ github.event.inputs.lcui_tag }}"; V="${VER#v}"
node scripts/update-versions.mjs --source LCUI \
  --pkg lcui --ver "${{ github.event.inputs.lcui_tag }}" --ref "${{ github.event.inputs.lcui_tag }}" \
```

同一行里算 sha 用的是去掉 `v` 的 `$V`，但传给 `--ver` 的是**带 `v` 的原始 tag**。`update-versions.mjs` 的 `run()` 直接 `version = args.ver`，于是：

- `versions.json` 的 `lcui.version` 变成 `"v3.1.0"`
- 描述符里 `source:add("versions", "v3.1.0", ...)`
- binary URL 里 `$(version)` 展开成 `v3.1.0`（`$(version)` 是 xmake 的内置过滤器，取 `package:version_str()`，即**原始字符串**，不做规范化）
- 最终 URL = `.../releases/download/vv3.1.0/lcui-v3.1.0-windows-x64.zip` —— 双重 `v`，必然 404

而 LCUI CI 产出的文件名是 `lcui-3.1.0-windows-x64.zip`（`get_release_version.py` 解析 tag 时已去掉 `v`）。

**修法**：在 `scripts/update-versions.mjs` 的 `run()` 里把 `args.ver` 规范化（去掉开头的 `v`），而不是只改 workflow —— 这样 CLI 与 CI 两条入口都安全，且能写单元测试。

对齐后的验收点：

- 描述符的 binary URL 与 LCUI 实际产出的文件名逐字符一致：`<version>` = release tag 去掉 `v` = `versions.json` 的 `lcui.version`；`plat` 为 `windows`/`linux`，`arch` 为 `x64`
- `on_install` 无需修改（§4.2.3 已确认 zip 顶层就是 `include/` + `lib/`）
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
| 改名后 `scripts/update-versions.mjs` 的 `PACKAGES` 映射漏改 | 同步脚本抛 `unknown package`，子库版本停止更新 | §4.1.1a 已列出全部 6 处同步点；Task 2 的清单一致性测试会在漏改时直接失败 |
| 改名后 `versions.json` 的 key 与描述符 `package()` 名不一致 | xmake 解析到的包名对不上，版本记录错位 | 同上 |
| **CI 里 xmake 的任务名写错位置**（`xmake -P d build smoke`） | 冒烟测试一步都跑不起来 | F1 已实测；`tests/run-c-smoke.mjs` 把命令拼在一处，workflow 文本里不再出现 xmake 命令 |
| **CI 里 Node 的测试参数写成目录**（`node --test tests/`） | 单测步骤直接失败 | F2 已实测；改用 glob 形式 `node --test "tests/**/*.test.mjs"` |
| **`lcui.lib` 不是 self-contained** | binary 包装好了但消费方链接必然缺符号 | §4.2.1a 的 `set_policy("build.merge_archive", true)`，已实测（200KB → 2.3MB） |
| **`--ver` 收到带 `v` 的 tag** | binary URL 拼成 `download/vv3.1.0/...`，必然 404 | F6；§4.3 要求在 `update-versions.mjs` 里规范化，并配单元测试 |
| release tag 与 `versions.json` 的 `lcui.version` 不一致 | registry URL 拼出的文件名与 release 资产对不上 → 404 | 两者都由同一个 tag 驱动（CI 用 `REL_VERSION`，registry 用 `update-versions.mjs --ver <tag>`）；发版流程里核对一次 |
| `Compress-Archive` 在两平台产物结构不一致 | zip 顶层多出一层目录 → `on_install` 找不到 include/lib | §8 的验收步骤要求实际解压核对；必要时改用 `tar`/`7z` 或在 `on_install` 里加一层路径兼容 |
| `add_headerfiles` 的循环写法在某个子库上行为异常 | 部分子库头没被正确安装 | §4.2.1 的写法已用等价结构 + 真实 LCUI worktree 实测；实施后用 `unzip -l` 列出全部头核对 |
| LCUI 工作树处于重构中间态（构建不过） | Part 2 无法在主工作树验证 | Part 2 在 **LCUI HEAD 的独立 worktree** 里做（已实测可 configure + build） |
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
# Node 单测（注意：Node 24 不接受目录参数，必须用 glob 或无参数）
node --test "tests/**/*.test.mjs"

# C 冒烟测试（一条命令跑全部 6 个包；需要能访问 github.com 以克隆 LCUI 源码）
node tests/run-c-smoke.mjs

# 单个包
node tests/run-c-smoke.mjs yutil
```

### Part 2

在 **LCUI HEAD 的独立 worktree** 里（工作树当前处于重构中间态、构建不过）：

```bash
# 确认子库头随 lcui 一起被安装
xmake f -y -k static -m release
xmake build lcui
xmake install -o dist/lcui-bin lcui
ls dist/lcui-bin/include/            # 应看到 LCUI.h, LCUI/, yutil.h, yutil/, css.h, css/, ...
ls dist/lcui-bin/lib/                # 应看到 lcui.lib（且体积远大于未合并时的 200KB）

# 打包并核对 zip 顶层结构
Compress-Archive -Path dist/lcui-bin/* -DestinationPath dist/lcui-3.0.0-windows-x64.zip
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
