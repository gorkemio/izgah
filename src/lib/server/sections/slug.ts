/** URL slug for a section name, Turkish-aware (also used to match `#section` hashtags). */
export function slugifySectionName(input: string): string {
	const transliterated = input
		.trim()
		.replace(/Ç/g, 'c')
		.replace(/ç/g, 'c')
		.replace(/Ğ/g, 'g')
		.replace(/ğ/g, 'g')
		.replace(/İ/g, 'i')
		.replace(/I/g, 'i')
		.replace(/ı/g, 'i')
		.replace(/Ö/g, 'o')
		.replace(/ö/g, 'o')
		.replace(/Ş/g, 's')
		.replace(/ş/g, 's')
		.replace(/Ü/g, 'u')
		.replace(/ü/g, 'u')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

	return transliterated
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 64)
		.replace(/-+$/g, '');
}
