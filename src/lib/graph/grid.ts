/** The grid behind the graph, and behind a diagram, which moves and scales with the view. */

/** Distance between the fine lines of the background grid, in world pixels. */
const GRID_SIZE = 24;
/** Every this many fine lines there is a stronger one. */
const GRID_MAJOR = 5;
/** Fine lines closer together than this on screen are not drawn. */
const GRID_MIN_PX = 8;

/**
 * Opacity of grid lines that are `spacing` pixels apart on screen. It rises
 * with the spacing and is continuous where one level of the grid takes over
 * from the next, so lines fade in and out as the view zooms instead of popping.
 */
function gridAlpha(spacing: number): number {
	const major = GRID_MIN_PX * GRID_MAJOR;
	const alpha =
		spacing < major
			? (0.5 * (spacing - GRID_MIN_PX)) / (major - GRID_MIN_PX)
			: 0.5 + (0.5 * (spacing - major)) / (major * (GRID_MAJOR - 1));
	return Math.min(Math.max(alpha, 0), 1);
}

/**
 * A blueprint grid behind the graph or a diagram, in `colour`: fine lines
 * with a stronger line every `GRID_MAJOR`th. It moves and scales with the
 * view; as the view zooms out the fine lines fade away and the stronger ones
 * become the fine lines of a grid `GRID_MAJOR` times coarser.
 */
export function drawGrid(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	width: number,
	height: number,
	view: { x: number; y: number; k: number },
	colour: string
) {
	let step = GRID_SIZE * view.k;
	if (!(step > 0) || !Number.isFinite(step)) return;
	while (step < GRID_MIN_PX) step *= GRID_MAJOR;

	ctx.strokeStyle = colour;
	ctx.lineWidth = 1;
	for (const major of [false, true]) {
		const spacing = major ? step * GRID_MAJOR : step;
		ctx.beginPath();
		// Lines are numbered from the world origin; every `GRID_MAJOR`th fine
		// line is left for the pass that draws the stronger ones.
		for (let n = Math.ceil(-view.x / spacing); n * spacing + view.x <= width; n++) {
			if (!major && n % GRID_MAJOR === 0) continue;
			const x = Math.round(n * spacing + view.x) + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
		}
		for (let n = Math.ceil(-view.y / spacing); n * spacing + view.y <= height; n++) {
			if (!major && n % GRID_MAJOR === 0) continue;
			const y = Math.round(n * spacing + view.y) + 0.5;
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
		}
		ctx.globalAlpha = gridAlpha(spacing);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
}
