/* Smoke test for the "pandagl" package.
 *
 * Verifies that the installed public headers compile and that the exported
 * symbols link. The test is never executed in CI -- compiling and linking is
 * the whole assertion.
 *
 * pandagl.h is the umbrella header installed at the include root; the
 * sub-headers live in include/pandagl/.
 */

#include <pandagl.h>

int main(void)
{
    pd_canvas_t canvas;

    pd_canvas_init(&canvas);
    return 0;
}
