Ways to squeeze even more:

Pre-spawn a pool of long-lived workers so you don’t pay the “new Worker()” startup cost on each pair.

Batch multiple intersects calls per worker message (e.g. send 50 pairs at once, have the worker loop).

Compile Turf boolean-intersects to WASM (or use GEOS-WASM) for a 2–3× speedup on each call.

If your overlap graph is extremely sparse, switch to a “sweep‐line” or “plane‐sweep” algorithm in WASM for O(N log N) guaranteed.