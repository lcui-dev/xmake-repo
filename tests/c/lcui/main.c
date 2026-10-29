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
