# Third-party notices

AnShelf integrates the following local dependencies. It does not call their hosted services.

## lifeart/fla-viewer

Source: https://github.com/lifeart/fla-viewer

Vendored revision: `b14fa1d1e3e2d2b035e174bde472a7941d385b17`.

The upstream package.json and README declare ISC. Upstream has no separate LICENSE file in this revision and no author in package.json. The original source files and provenance are retained in `vendor/fla-viewer`; AnShelf disables remote font loading for offline operation. This notice records the declared license and does not invent an upstream copyright holder.

ISC license text:

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Other runtime dependencies

- JSZip 3.10.1 — https://github.com/Stuk/jszip — MIT or GPLv3; AnShelf uses the MIT license option.
- pako 2.1.0 — https://github.com/nodeca/pako — MIT and zlib licenses.
- gifenc 1.0.3 — https://github.com/mattdesl/gifenc — MIT; zero runtime dependencies. Its PNN quantizer credits Mark Tyler, Dmitry Groshev and Miller Cy Chan; the LZW encoder retains its original author acknowledgements in the source package. The published package and exact integrity are locked locally. GIF encoding is bundled into the offline preview worker and does not call a hosted service.
- Electron 44.7.0 — https://github.com/electron/electron — MIT, with Chromium/Node.js third-party licenses included in the packaged distribution.

Dependency package licenses are retained in the installed runtime. Build tooling (esbuild and electron-builder) is not needed by the user. Original demo artwork and the AnShelf UI are created for this project.

The AnAn wordmark in ui/brand-anan.svg is original geometric vector artwork drawn for this project. It is not converted from a font and embeds no third-party font. It may be used and modified commercially with this project without a separate font license.

Copies of JSZip, pako, gifenc and Electron licenses are provided in resources/licenses. Chromium/Node.js notices are supplied by Electron's LICENSES.chromium.html. The upstream FLA parser package and README declarations are included in the source delivery.
