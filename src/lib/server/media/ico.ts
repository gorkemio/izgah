/**
 * Minimal ICO reader for site icons (docs/designs/izgah-ui-v5.md §10.1). Modern favicon.ico files
 * usually embed PNG images; this returns the largest embedded PNG and ignores BMP entries, so the
 * result goes through the same magic-byte and sharp checks as any other image.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isIco(bytes: Uint8Array): boolean {
	return bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
}

export function extractPngFromIco(bytes: Uint8Array): Uint8Array | null {
	if (!isIco(bytes)) {
		return null;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint16(4, true);
	if (count === 0 || count > 64 || bytes.length < 6 + count * 16) {
		return null;
	}
	let best: { offset: number; size: number; pixels: number } | null = null;
	for (let i = 0; i < count; i += 1) {
		const entry = 6 + i * 16;
		const width = bytes[entry] || 256;
		const height = bytes[entry + 1] || 256;
		const size = view.getUint32(entry + 8, true);
		const offset = view.getUint32(entry + 12, true);
		if (size < PNG_SIGNATURE.length || offset + size > bytes.length) {
			continue;
		}
		const isPng = PNG_SIGNATURE.every((byte, index) => bytes[offset + index] === byte);
		if (!isPng) {
			continue;
		}
		const pixels = width * height;
		if (!best || pixels > best.pixels) {
			best = { offset, size, pixels };
		}
	}
	return best ? bytes.slice(best.offset, best.offset + best.size) : null;
}
