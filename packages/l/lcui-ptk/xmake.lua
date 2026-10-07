package("lcui-ptk")
    set_homepage("https://github.com/lc-soft/LCUI")
    set_description("LCUI PTK - platform toolkit (message loop, window, timer, IME).")
    set_license("MIT")

    add_schemes("source")
    add_deps("yutil", "pandagl")
    if is_plat("linux") then
        add_deps("libx11")
    end

    on_check(function (package)
        assert(xmake.version():ge("3.0.7"), "package(lcui-ptk): requires xmake >= 3.0.7")
        assert(package:is_plat("windows", "linux"), "package(lcui-ptk): only windows and linux are supported")
    end)

    on_source(function (package)
        local source = package:scheme("source")
        source:add("versions", "1.0.0", "3801fdc10fcad7b0d918c4d3b28ae6b6fc2b5f4d")
        source:add("versions", "develop", "0c8d150f812e482516bcf5748a8233fb8a54b34a")
        source:add("urls", "https://github.com/lc-soft/LCUI.git", "https://gitee.com/lc-soft/LCUI.git")
    end)

    on_load(function (package)
        package:add("defines", "PTK_STATIC_BUILD")
        if package:is_plat("windows") then
            package:add("syslinks", "user32", "shell32", "ole32")
        end
    end)

    on_install(function (package)
        os.execv("xmake", {"build", "-y", "libptk"})
        os.execv("xmake", {"install", "-o", package:installdir(), "libptk"})
    end)

    on_test(function (package)
        assert(package:has_cfuncs("ptk_app_create", {includes = "ptk/ptk.h"}))
    end)
