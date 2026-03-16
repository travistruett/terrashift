# TerraShift — Deferred Work

## Cloud Layer & Atmospheric Glow
Semi-transparent cloud texture on a slightly larger sphere, plus a rim-light fresnel
glow shader for atmosphere. Low effort with Drei helpers once the base globe works.
Dramatically improves visual quality.

## RGB-Encoded DEM (Precision Upgrade)
Replace the 8-bit ±100m DEM (0.78m precision) with a Mapbox terrain-RGB encoded texture
for 0.1m precision. Requires regenerating the texture and updating the fragment shader
to decode R+G+B channels. Nice-to-have if sub-meter coastal detail matters.

## External CDN for Textures
Move textures from /public/ to Cloudflare R2 or similar free CDN if Vercel bandwidth
becomes a concern. Architecture supports this — just swap URL strings. R2 offers 10GB
free egress/month. No code changes needed beyond texture paths.
