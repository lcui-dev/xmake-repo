/* Smoke test for the "ptk" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * ptk.h is the umbrella header installed at the include root; the sub-headers
 * live in include/ptk/.
 */

#include <ptk.h>

int main(void)
{
    (void)ptk_app_init(L"lcui-test");
    return 0;
}
