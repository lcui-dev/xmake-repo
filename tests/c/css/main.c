/* Smoke test for the "css" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * css.h is the umbrella header installed at the include root; the sub-headers
 * live in include/css/.
 */

#include <css.h>

int main(void)
{
    css_init();
    css_destroy();
    return 0;
}
