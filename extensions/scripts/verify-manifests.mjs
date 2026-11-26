import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXTENSIONS_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_ROOT = path.join(EXTENSIONS_ROOT, '.output');

const REQUIRED_PERMISSIONS = ['activeTab', 'contextMenus', 'storage'];
const REQUIRED_ICON_SIZES = ['16', '32', '48', '128'];
const HOST_PERMISSION_RE = /^(https|http):\/\/(\[[0-9a-fA-F:]+\]|[^/:*]+)\/api\/v1\/\*$/;
// Size budget, measured the way the stores count it (docs/designs/izgah-extensions.md): the zip a
// user downloads and the gzip-compressed JS and CSS. Source maps are not shipped in store builds.
const BUDGET_ZIP_BYTES = 150 * 1024;
const BUDGET_CODE_GZIP_BYTES = 30 * 1024;
const ZIP_LOCAL_HEADER = 30;
const ZIP_CENTRAL_HEADER = 46;
const ZIP_END_RECORD = 22;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TARGET_DIRS = {
	chrome: 'chrome-mv3',
	firefox: 'firefox-mv3',
	safari: 'safari-mv3'
};

function parseCliFlags(argv) {
	let requireHttpsOrigin = false;
	let storeBuild = false;
	let onlyTarget = null;

	for (const arg of argv) {
		if (arg === '--') {
			continue;
		}
		if (arg === '--require-https-origin') {
			requireHttpsOrigin = true;
			continue;
		}
		if (arg === '--store') {
			storeBuild = true;
			continue;
		}
		if (arg.startsWith('--only=')) {
			const target = arg.slice('--only='.length).trim();
			if (!(target in TARGET_DIRS)) {
				throw new Error(
					`Unsupported --only target "${target}". Expected one of: ${Object.keys(TARGET_DIRS).join(', ')}.`
				);
			}
			onlyTarget = target;
			continue;
		}
		throw new Error(`Unknown CLI argument: "${arg}".`);
	}

	return { requireHttpsOrigin, storeBuild, onlyTarget };
}

function readPngDimensions(filePath) {
	const data = readFileSync(filePath);
	if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
		throw new Error(`File is not a valid PNG binary: ${filePath}`);
	}
	const chunkType = data.subarray(12, 16).toString('ascii');
	if (chunkType !== 'IHDR') {
		throw new Error(`PNG missing leading IHDR chunk: ${filePath}`);
	}
	return {
		width: data.readUInt32BE(16),
		height: data.readUInt32BE(20)
	};
}

function assertSortedEqual(actual, expected, label, errors) {
	if (!Array.isArray(actual)) {
		errors.push(`${label}: expected an array, got ${typeof actual}`);
		return;
	}
	const sortedActual = [...actual].sort();
	const sortedExpected = [...expected].sort();
	if (
		sortedActual.length !== sortedExpected.length ||
		sortedActual.some((item, idx) => item !== sortedExpected[idx])
	) {
		errors.push(
			`${label}: expected [${sortedExpected.join(', ')}], got [${sortedActual.join(', ')}]`
		);
	}
}

function resolveInsideOutput(outputDir, relativeAssetPath) {
	const cleanRel = relativeAssetPath.replace(/^\/+/, '');
	const resolved = path.resolve(outputDir, cleanRel);
	const normalizedRoot = `${outputDir}${path.sep}`;
	if (resolved !== outputDir && !resolved.startsWith(normalizedRoot)) {
		throw new Error(`Path escapes output directory: ${relativeAssetPath}`);
	}
	return resolved;
}

function verifyIconMap(iconMap, fieldName, outputDir, errors) {
	if (!iconMap || typeof iconMap !== 'object' || Array.isArray(iconMap)) {
		errors.push(`${fieldName}: missing or invalid icon map`);
		return;
	}

	for (const size of REQUIRED_ICON_SIZES) {
		const relPath = iconMap[size];
		if (typeof relPath !== 'string' || relPath.trim() === '') {
			errors.push(`${fieldName}.${size}: missing icon path`);
			continue;
		}

		let absPath;
		try {
			absPath = resolveInsideOutput(outputDir, relPath);
		} catch (error) {
			errors.push(`${fieldName}.${size}: ${error.message}`);
			continue;
		}

		if (!existsSync(absPath)) {
			errors.push(`${fieldName}.${size}: file does not exist at ${relPath}`);
			continue;
		}

		try {
			const dims = readPngDimensions(absPath);
			const expectedDim = Number(size);
			if (dims.width !== expectedDim || dims.height !== expectedDim) {
				errors.push(
					`${fieldName}.${size}: expected ${expectedDim}x${expectedDim} PNG, got ${dims.width}x${dims.height}`
				);
			}
		} catch (error) {
			errors.push(`${fieldName}.${size}: ${error.message}`);
		}
	}
}

function verifyTargetManifest(target, { requireHttpsOrigin, storeBuild }) {
	const errors = [];
	const outputDir = path.join(OUTPUT_ROOT, TARGET_DIRS[target]);
	const manifestPath = path.join(outputDir, 'manifest.json');

	if (!existsSync(manifestPath)) {
		return {
			target,
			hostPermission: null,
			errors: [`Missing manifest.json at ${path.relative(EXTENSIONS_ROOT, manifestPath)}`]
		};
	}

	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		return {
			target,
			hostPermission: null,
			errors: [`Failed to parse manifest.json: ${error.message}`]
		};
	}

	if (manifest.manifest_version !== 3) {
		errors.push(`manifest_version: expected 3, got ${manifest.manifest_version}`);
	}

	assertSortedEqual(manifest.permissions, REQUIRED_PERMISSIONS, 'permissions', errors);

	if (Array.isArray(manifest.optional_permissions) && manifest.optional_permissions.length > 0) {
		errors.push('optional_permissions: must not be declared');
	}
	if (
		Array.isArray(manifest.optional_host_permissions) &&
		manifest.optional_host_permissions.length > 0
	) {
		errors.push('optional_host_permissions: must not be declared');
	}
	if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0) {
		errors.push('content_scripts: must not be declared');
	}
	if (
		Array.isArray(manifest.web_accessible_resources) &&
		manifest.web_accessible_resources.length > 0
	) {
		errors.push('web_accessible_resources: must not be declared');
	}
	if (manifest.externally_connectable) {
		errors.push('externally_connectable: must not be declared');
	}

	let hostPermission = null;
	if (storeBuild) {
		// Store builds work with any instance through CORS and must not request host access.
		if (manifest.host_permissions !== undefined) {
			errors.push(
				`host_permissions: store builds must not declare host permissions, got ${JSON.stringify(manifest.host_permissions)}`
			);
		}
		hostPermission = '(store build: none)';
	} else if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.length !== 1) {
		errors.push(
			`host_permissions: expected a single-element array, got ${JSON.stringify(manifest.host_permissions)}`
		);
	} else {
		hostPermission = manifest.host_permissions[0];
		if (typeof hostPermission !== 'string' || !HOST_PERMISSION_RE.test(hostPermission)) {
			errors.push(
				`host_permissions[0]: invalid portless API origin pattern "${String(hostPermission)}"`
			);
		} else if (requireHttpsOrigin && !hostPermission.startsWith('https://')) {
			errors.push(
				`host_permissions[0]: --require-https-origin requires https:// origin, got "${hostPermission}"`
			);
		}
	}

	if (manifest.action?.default_popup !== 'popup.html') {
		errors.push(
			`action.default_popup: expected "popup.html", got ${manifest.action?.default_popup}`
		);
	} else if (!existsSync(path.join(outputDir, 'popup.html'))) {
		errors.push('popup.html referenced by action.default_popup is missing from build output');
	}

	if (target === 'safari') {
		if (manifest.options_ui?.page !== 'options.html') {
			errors.push(
				`options_ui: expected { page: "options.html" } on Safari, got ${JSON.stringify(manifest.options_ui)}`
			);
		} else if (!existsSync(path.join(outputDir, 'options.html'))) {
			errors.push('options.html referenced by options_ui.page is missing from build output');
		}
	} else if (
		manifest.options_ui?.page !== 'options.html' ||
		manifest.options_ui?.open_in_tab !== true
	) {
		errors.push(
			`options_ui: expected { page: "options.html", open_in_tab: true }, got ${JSON.stringify(manifest.options_ui)}`
		);
	} else if (!existsSync(path.join(outputDir, 'options.html'))) {
		errors.push('options.html referenced by options_ui.page is missing from build output');
	}

	const suggestedKey = manifest.commands?._execute_action?.suggested_key;
	if (suggestedKey?.default !== 'Alt+Shift+I' || suggestedKey?.mac !== 'Alt+Shift+I') {
		errors.push(
			`commands._execute_action.suggested_key: expected { default: "Alt+Shift+I", mac: "Alt+Shift+I" }, got ${JSON.stringify(suggestedKey)}`
		);
	}

	const csp = manifest.content_security_policy?.extension_pages;
	if (csp !== "script-src 'self'; object-src 'none'") {
		errors.push(
			`content_security_policy.extension_pages: expected "script-src 'self'; object-src 'none'", got ${JSON.stringify(csp)}`
		);
	}

	verifyIconMap(manifest.icons, 'icons', outputDir, errors);
	verifyIconMap(manifest.action?.default_icon, 'action.default_icon', outputDir, errors);

	if (target === 'firefox') {
		const scripts = manifest.background?.scripts;
		if (!Array.isArray(scripts) || scripts.length === 0) {
			errors.push('background.scripts: Firefox MV3 build must define background.scripts');
		} else {
			for (const relScript of scripts) {
				if (typeof relScript !== 'string') {
					errors.push(`background.scripts: invalid script entry "${String(relScript)}"`);
					continue;
				}
				try {
					const scriptPath = resolveInsideOutput(outputDir, relScript);
					if (!existsSync(scriptPath)) {
						errors.push(`background.scripts: missing script "${relScript}"`);
					}
				} catch (error) {
					errors.push(`background.scripts: ${error.message}`);
				}
			}
		}
		if (manifest.background?.service_worker) {
			errors.push('background.service_worker: must not be set on Firefox build');
		}

		const gecko = manifest.browser_specific_settings?.gecko;
		if (typeof gecko?.id !== 'string' || gecko.id.trim() === '') {
			errors.push('browser_specific_settings.gecko.id: must be a non-empty add-on ID');
		}
		if (gecko?.strict_min_version !== '128.0') {
			errors.push(
				`browser_specific_settings.gecko.strict_min_version: expected "128.0", got ${JSON.stringify(gecko?.strict_min_version)}`
			);
		}
		assertSortedEqual(
			gecko?.data_collection_permissions?.required,
			['none'],
			'browser_specific_settings.gecko.data_collection_permissions.required',
			errors
		);
	} else {
		const serviceWorker = manifest.background?.service_worker;
		if (typeof serviceWorker !== 'string' || serviceWorker.trim() === '') {
			errors.push(`background.service_worker: missing on ${target} build`);
		} else {
			try {
				const swPath = resolveInsideOutput(outputDir, serviceWorker);
				if (!existsSync(swPath)) {
					errors.push(`background.service_worker: missing script "${serviceWorker}"`);
				}
			} catch (error) {
				errors.push(`background.service_worker: ${error.message}`);
			}
		}
		if (manifest.background?.scripts) {
			errors.push(`background.scripts: must not be set on ${target} build`);
		}
		if (manifest.browser_specific_settings) {
			errors.push(`browser_specific_settings: must not be set on ${target} build`);
		}
	}

	return { target, hostPermission, errors };
}

function listFiles(dir, base = dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
	});
}

/** Zip size from deflate-compressed entries plus zip headers; JS+CSS size after gzip. */
export function measurePackage(outputDir) {
	let zipBytes = ZIP_END_RECORD;
	let codeGzipBytes = 0;
	for (const relPath of listFiles(outputDir)) {
		if (relPath.endsWith('.map')) {
			continue;
		}
		const data = readFileSync(path.join(outputDir, relPath));
		const name = Buffer.byteLength(relPath.split(path.sep).join('/'));
		const stored = Math.min(data.length, deflateRawSync(data, { level: 9 }).length);
		zipBytes += stored + ZIP_LOCAL_HEADER + ZIP_CENTRAL_HEADER + 2 * name;
		if (/\.(js|css)$/.test(relPath)) {
			codeGzipBytes += gzipSync(data, { level: 9 }).length;
		}
	}
	return { zipBytes, codeGzipBytes };
}

function checkSizeBudget(target) {
	const { zipBytes, codeGzipBytes } = measurePackage(path.join(OUTPUT_ROOT, TARGET_DIRS[target]));
	const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
	const errors = [];
	if (zipBytes > BUDGET_ZIP_BYTES) {
		errors.push(`size: zip ${kb(zipBytes)} is over the ${kb(BUDGET_ZIP_BYTES)} budget`);
	}
	if (codeGzipBytes > BUDGET_CODE_GZIP_BYTES) {
		errors.push(
			`size: JS+CSS gzip ${kb(codeGzipBytes)} is over the ${kb(BUDGET_CODE_GZIP_BYTES)} budget`
		);
	}
	return { summary: `zip ${kb(zipBytes)}, JS+CSS gzip ${kb(codeGzipBytes)}`, errors };
}

function main() {
	const flags = parseCliFlags(process.argv.slice(2));
	const targets = flags.onlyTarget
		? [flags.onlyTarget]
		: [
				'chrome',
				'firefox',
				...(existsSync(path.join(OUTPUT_ROOT, TARGET_DIRS.safari, 'manifest.json'))
					? ['safari']
					: [])
			];

	const results = targets.map((target) => {
		const result = verifyTargetManifest(target, flags);
		const size = checkSizeBudget(target);
		return { ...result, size: size.summary, errors: [...result.errors, ...size.errors] };
	});
	const hostPermissionsSeen = new Set(
		results.map((r) => r.hostPermission).filter((value) => typeof value === 'string')
	);

	let hasErrors = false;
	for (const result of results) {
		if (result.errors.length > 0) {
			hasErrors = true;
			console.error(`[verify-manifests] FAILED for ${result.target}:`);
			for (const err of result.errors) {
				console.error(`  - ${err}`);
			}
		} else {
			console.log(
				`[verify-manifests] OK ${result.target} (${TARGET_DIRS[result.target]}/manifest.json -> ${result.hostPermission}; ${result.size})`
			);
		}
	}

	if (hostPermissionsSeen.size > 1) {
		hasErrors = true;
		console.error(
			`[verify-manifests] FAILED: cross-target host_permissions mismatch (${[...hostPermissionsSeen].join(' vs ')})`
		);
	}

	if (hasErrors) {
		process.exitCode = 1;
	}
}

try {
	main();
} catch (error) {
	console.error(`[verify-manifests] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
