package("yutil")
    set_homepage("https://github.com/lc-soft/LCUI")
    set_description("YUtil - a utility library (data structures, strings, logging).")
    set_license("MIT")

    add_schemes("source")

    on_check(function (package)
        assert(xmake.version():ge("3.0.7"), "package(yutil): requires xmake >= 3.0.7")
        assert(package:is_plat("windows", "linux"), "package(yutil): only windows and linux are supported")
    end)

    on_source(function (package)
        local source = package:scheme("source")
        source:add("versions", "1.0.0", "3801fdc10fcad7b0d918c4d3b28ae6b6fc2b5f4d")
        source:add("versions", "develop", "0c8d150f812e482516bcf5748a8233fb8a54b34a")
        source:add("urls", "https://github.com/lc-soft/LCUI.git", "https://gitee.com/lc-soft/LCUI.git")
    end)

    on_install(function (package)
        os.execv("xmake", {"build", "-y", "yutil"})
        os.execv("xmake", {"install", "-o", package:installdir(), "yutil"})
    end)

    on_test(function (package)
        assert(package:has_cfuncs("y_strdup", {includes = "yutil.h"}))
    end)
