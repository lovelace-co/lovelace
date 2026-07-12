/**
 * The live-work ring: a comet that circles a card or row's border while an
 * agent is working it. A conic gradient (the previous approach) sweeps by
 * angle, so on anything but a square it moves unevenly, fast across short
 * edges and corners, slow through long-edge middles. An SVG rounded-rect
 * path is parameterised by arc length instead (`pathLength={1}` normalises
 * it to 0-1 regardless of the rect's real size), so animating stroke-dashoffset
 * moves the comet at constant speed for any aspect ratio. Geometry and
 * colour live entirely in the stylesheet; this component only lays out the
 * two rects the ring is built from.
 */
export function LiveRing() {
  return (
    <svg className="live-ring" aria-hidden="true">
      <rect className="live-ring-tail" pathLength={1} />
      <rect className="live-ring-head" pathLength={1} />
    </svg>
  );
}
