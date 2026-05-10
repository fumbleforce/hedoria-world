/**
 * One-shot layout fix for clustered regions in tabs/locations.json.
 *
 * For each target region:
 *  1. Subtract the centroid from all member locations (so x,y becomes
 *     region-local, centered at 0,0 — which is what the engine expects).
 *  2. Scale the cluster up so it actually uses the region cell instead of
 *     occupying a tiny corner.
 *  3. Run a force-based relaxation that (a) pushes any pair whose
 *     catchment circles overlap-with-margin apart, (b) gently attracts
 *     each location toward its original (centered+scaled) position so
 *     relative geography is preserved.
 *  4. Clamp every result to a disc of radius MAX_RADIUS_FROM_CENTER so
 *     nothing falls outside its region cell.
 *
 * Usage: node .claude/scripts/spread-locations.js
 */
const fs = require("fs");
const path = require("path");

const TABS_PATH = path.join(__dirname, "..", "..", "tabs", "locations.json");
const TARGETS = new Set([
  "Impasse",
  "Hinderance Highlands",
  "The Sun-Scoured Plateau",
  "Long Steppe",
  "Deep Steppes",
]);

const MAX_RADIUS_FROM_CENTER = 42;
const TARGET_SPAN_FRACTION = 0.85;
const MARGIN_FACTOR = 1.6;
const ITERATIONS = 600;
const ATTRACTION = 0.015;
const REPULSION = 0.55;

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function relaxRegion(regionName, locs) {
  if (locs.length === 0) return;

  const cx = mean(locs.map((l) => l.x));
  const cy = mean(locs.map((l) => l.y));
  for (const l of locs) {
    l.x -= cx;
    l.y -= cy;
  }

  const maxDist = Math.max(...locs.map((l) => Math.hypot(l.x, l.y))) || 1;
  const targetSpan = MAX_RADIUS_FROM_CENTER * TARGET_SPAN_FRACTION;
  const scale = targetSpan / maxDist;
  for (const l of locs) {
    l.x *= scale;
    l.y *= scale;
    l.ox = l.x;
    l.oy = l.y;
  }

  let lastMaxOverlap = Infinity;
  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    const dx = new Array(locs.length).fill(0);
    const dy = new Array(locs.length).fill(0);
    let maxOverlap = 0;

    for (let i = 0; i < locs.length; i += 1) {
      for (let j = i + 1; j < locs.length; j += 1) {
        const a = locs[i];
        const b = locs[j];
        let ddx = b.x - a.x;
        let ddy = b.y - a.y;
        let d = Math.hypot(ddx, ddy);
        if (d < 1e-4) {
          ddx = (i - j) * 0.01;
          ddy = (j - i) * 0.01;
          d = Math.hypot(ddx, ddy);
        }
        const minDist = (a.radius + b.radius) * MARGIN_FACTOR;
        if (d < minDist) {
          const overlap = minDist - d;
          if (overlap > maxOverlap) maxOverlap = overlap;
          const ux = ddx / d;
          const uy = ddy / d;
          const push = overlap * 0.5 * REPULSION;
          dx[i] -= ux * push;
          dy[i] -= uy * push;
          dx[j] += ux * push;
          dy[j] += uy * push;
        }
      }
    }

    for (let i = 0; i < locs.length; i += 1) {
      const l = locs[i];
      dx[i] += (l.ox - l.x) * ATTRACTION;
      dy[i] += (l.oy - l.y) * ATTRACTION;
    }

    for (let i = 0; i < locs.length; i += 1) {
      const l = locs[i];
      l.x += dx[i];
      l.y += dy[i];
      const d = Math.hypot(l.x, l.y);
      if (d > MAX_RADIUS_FROM_CENTER) {
        l.x *= MAX_RADIUS_FROM_CENTER / d;
        l.y *= MAX_RADIUS_FROM_CENTER / d;
      }
    }

    lastMaxOverlap = maxOverlap;
    if (maxOverlap < 1e-3 && iter > 20) break;
  }

  for (const l of locs) {
    l.x = Math.round(l.x * 10) / 10;
    l.y = Math.round(l.y * 10) / 10;
    delete l.ox;
    delete l.oy;
  }

  let worstOverlap = 0;
  let worstPair = "";
  for (let i = 0; i < locs.length; i += 1) {
    for (let j = i + 1; j < locs.length; j += 1) {
      const a = locs[i];
      const b = locs[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const minDist = a.radius + b.radius;
      if (d < minDist) {
        const overlap = minDist - d;
        if (overlap > worstOverlap) {
          worstOverlap = overlap;
          worstPair = `${a.name} <-> ${b.name} (d=${d.toFixed(2)} < ${minDist})`;
        }
      }
    }
  }

  console.log(`\n--- ${regionName} (${locs.length} locations) ---`);
  console.log(`  final iter overlap (with ${MARGIN_FACTOR}x margin): ${lastMaxOverlap.toFixed(3)}`);
  if (worstOverlap > 0) {
    console.log(`  WARN: hard overlap remains: ${worstPair}`);
  } else {
    console.log(`  no hard overlaps remain`);
  }
}

function main() {
  const json = JSON.parse(fs.readFileSync(TABS_PATH, "utf8"));
  const byRegion = new Map();
  for (const [name, loc] of Object.entries(json.locations)) {
    if (!TARGETS.has(loc.region)) continue;
    if (!byRegion.has(loc.region)) byRegion.set(loc.region, []);
    byRegion.get(loc.region).push({
      name,
      x: loc.x,
      y: loc.y,
      radius: loc.radius || 1,
      ref: loc,
    });
  }

  for (const [regionName, locs] of byRegion) {
    relaxRegion(regionName, locs);
    for (const l of locs) {
      l.ref.x = l.x;
      l.ref.y = l.y;
    }
  }

  fs.writeFileSync(TABS_PATH, JSON.stringify(json, null, 2) + "\n");
  console.log(`\nWrote ${TABS_PATH}`);
}

main();
