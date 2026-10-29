/* Smoke test for the "yutil" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * yutil.h is the umbrella header installed at the include root; the
 * sub-headers live in include/yutil/.
 */

#include <yutil.h>

int main(void)
{
    char *copy = y_strdup("lcui");
    return copy ? 0 : 1;
}
