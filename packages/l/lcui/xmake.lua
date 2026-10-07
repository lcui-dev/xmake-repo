package("lcui")
    set_homepage("https://github.com/lc-soft/LCUI")
    set_description("The C library for building user interfaces.")
    set_license("MIT")

    add_schemes("binary", "source")

    -- lcui.lib is self-contained (all internal sub-libs merged via build.merge_archive);
    -- these external packages provide symbols it leaves undefined. They are REQUIRED.
    add_deps("freetype", "libpng", "libjpeg", "libyaml", "libxml2", "libomp")
    if is_plat("linux") then
        add_deps("fontconfig", "libx11")
    end

    on_check(function (package)
        assert(xmake.version():ge("3.0.7"),
            "package(lcui): requires xmake >= 3.0.7 for Package Schemes")
        assert(package:is_plat("windows", "linux"),
            "package(lcui): only windows and linux are supported")
    end)

    on_source(function (package)
        -- versions/commits are maintained by scripts/update-versions.mjs and LCUI release CI.
        local binary = package:scheme("binary")
        if not package:config("shared") then
            binary:add("urls",
                "https://github.com/lc-soft/LCUI/releases/download/v$(version)/lcui-$(version)-windows-x64.zip",
                "https://gitee.com/lc-soft/LCUI/releases/download/v$(version)/lcui-$(version)-windows-x64.zip",
                {alias = "windows-x64"})
            binary:add("urls",
                "https://github.com/lc-soft/LCUI/releases/download/v$(version)/lcui-$(version)-linux-x64.zip",
                "https://gitee.com/lc-soft/LCUI/releases/download/v$(version)/lcui-$(version)-linux-x64.zip",
                {alias = "linux-x64"})
        end
        local source = package:scheme("source")
        source:add("versions", "3.0.0", "0c8d150f812e482516bcf5748a8233fb8a54b34a")
        source:add("versions", "develop", "0c8d150f812e482516bcf5748a8233fb8a54b34a")
        source:add("urls",
            "https://github.com/lc-soft/LCUI.git",
            "https://gitee.com/lc-soft/LCUI.git")
    end)

    on_load(function (package)
        if package:is_plat("linux") then
            package:add("syslinks", "pthread", "dl", "m")
        elseif package:is_plat("windows") then
            package:add("syslinks", "gdi32", "user32", "shell32", "ole32")
        end
    end)

    on_install(function (package)
        local scheme = package:current_scheme()
        if scheme and scheme:name() == "binary" then
            os.cp("include", package:installdir("include"))
            os.cp("lib",     package:installdir("lib"))
        else
            import("package.tools.xmake").install(package, {})
        end
    end)

    on_test(function (package)
        assert(package:has_cfuncs("lcui_init", {includes = "LCUI.h"}))
    end)
