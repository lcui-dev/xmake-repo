package("pandagl")
    set_homepage("https://github.com/lc-soft/LCUI")
    set_description("PandaGL - font management, text layout, image processing and rendering.")
    set_license("MIT")

    add_schemes("source")
    add_deps("yutil")
    add_deps("freetype", "libpng", "libjpeg")
    if is_plat("linux") then
        add_deps("fontconfig")
    end

    on_check(function (package)
        assert(xmake.version():ge("3.0.7"), "package(pandagl): requires xmake >= 3.0.7")
        assert(package:is_plat("windows", "linux"), "package(pandagl): only windows and linux are supported")
    end)

    on_source(function (package)
        local source = package:scheme("source")
        source:add("versions", "1.0.0", "301abb7f8bf1a72a29ecf383120cbec58f47cfce")
        source:add("versions", "develop", "0c8d150f812e482516bcf5748a8233fb8a54b34a")
        source:add("urls", "https://github.com/lc-soft/LCUI.git", "https://gitee.com/lc-soft/LCUI.git")
    end)

    on_load(function (package)
        package:add("defines", "PANDAGL_STATIC_BUILD")
    end)

    on_install(function (package)
        os.execv("xmake", {"build", "-y", "pandagl"})
        os.execv("xmake", {"install", "-o", package:installdir(), "pandagl"})
    end)

    on_test(function (package)
        assert(package:has_cfuncs("pd_canvas_init", {includes = "pandagl.h"}))
    end)
