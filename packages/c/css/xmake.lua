package("css")
    set_homepage("https://github.com/lc-soft/LCUI")
    set_description("LCUI CSS - a CSS parser and selector engine.")
    set_license("MIT")

    add_schemes("source")
    add_deps("yutil")

    on_check(function (package)
        assert(xmake.version():ge("3.0.7"), "package(css): requires xmake >= 3.0.7")
        assert(package:is_plat("windows", "linux"), "package(css): only windows and linux are supported")
    end)

    on_source(function (package)
        local source = package:scheme("source")
        source:add("versions", "1.0.0", "3a3a31a55b4abf504a08c90d3d0ef6999735b90a")
        source:add("versions", "develop", "0c8d150f812e482516bcf5748a8233fb8a54b34a")
        source:add("urls", "https://github.com/lc-soft/LCUI.git", "https://gitee.com/lc-soft/LCUI.git")
    end)

    on_install(function (package)
        os.execv("xmake", {"build", "-y", "libcss"})
        os.execv("xmake", {"install", "-o", package:installdir(), "libcss"})
    end)

    on_test(function (package)
        assert(package:has_cfuncs("css_init", {includes = "css.h"}))
    end)
