/* Smoke test for the "ctest" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 */

#include <ctest.h>

int main(void)
{
    return ctest_equal_int("smoke", 1, 1) ? 0 : 1;
}
