# TerraShift — Deferred Work

## Cloud Layer & Atmospheric Glow
Semi-transparent cloud texture on a slightly larger sphere, plus a rim-light fresnel
glow shader for atmosphere. Low effort with Drei helpers once the base globe works.
Dramatically improves visual quality.

## RGB-Encoded DEM (Precision Upgrade)
Replace the 8-bit ±100m DEM (0.78m precision) with a Mapbox terrain-RGB encoded texture
for 0.1m precision. Requires regenerating the texture and updating the fragment shader
to decode R+G+B channels. Nice-to-have if sub-meter coastal detail matters.
Note: the ice RGBA texture already encodes full 0–9000m elevation in the A channel
for ice growth, but the DEM used for sea level flooding is still 8-bit ±100m.

## External CDN for Textures
Move textures from /public/ to Cloudflare R2 or similar free CDN if Vercel bandwidth
becomes a concern. The RGBA ice texture is now ~15MB (was ~2MB as grayscale).
Architecture supports this — just swap URL strings. R2 offers 10GB free egress/month.
No code changes needed beyond texture paths.

## Higher-Resolution Sea Ice Data
HadISST is 1° lat/lon (~110km), upscaled to 16K. Could use NSIDC 25km passive
microwave data for sharper sea ice boundaries. Requires polar stereographic
reprojection to equirectangular. See docs/algorithm.md Known Limitations.

## Seasonal Sea Ice Toggle
Currently using September only (Arctic minimum, Antarctic near-maximum). A seasonal
toggle could show March maximum for dramatically different Arctic coverage.
