import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXTENSIONS_ROOT = path.resolve(SCRIPT_DIR, '..');
const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';

function parseCliFlags(argv) {
	let requireXcode = false;
	for (const arg of argv) {
		if (arg === '--') {
			continue;
		}
		if (arg === '--require-xcode') {
			requireXcode = true;
			continue;
		}
		throw new Error(`Unknown CLI argument: "${arg}". Supported flag: --require-xcode`);
	}
	return { requireXcode };
}

function loadLocalEnv() {
	const envPath = path.join(EXTENSIONS_ROOT, '.env');
	if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
		process.loadEnvFile(envPath);
	}
}

function runCheckedCommand(command, args, label) {
	const result = spawnSync(command, args, {
		cwd: EXTENSIONS_ROOT,
		env: process.env,
		stdio: 'inherit'
	});

	if (result.error) {
		throw new Error(`${label} failed to launch: ${result.error.message}`);
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function locateSafariConverter() {
	const direct = spawnSync('xcrun', ['--find', 'safari-web-extension-converter'], {
		cwd: EXTENSIONS_ROOT,
		env: process.env,
		encoding: 'utf8'
	});

	if (direct.status === 0 && direct.stdout.trim() !== '') {
		return {
			converterPath: direct.stdout.trim(),
			developerDir: process.env.DEVELOPER_DIR ?? null
		};
	}

	if (existsSync(XCODE_DEVELOPER_DIR)) {
		const fallbackEnv = { ...process.env, DEVELOPER_DIR: XCODE_DEVELOPER_DIR };
		const fallback = spawnSync('xcrun', ['--find', 'safari-web-extension-converter'], {
			cwd: EXTENSIONS_ROOT,
			env: fallbackEnv,
			encoding: 'utf8'
		});
		if (fallback.status === 0 && fallback.stdout.trim() !== '') {
			return {
				converterPath: fallback.stdout.trim(),
				developerDir: XCODE_DEVELOPER_DIR
			};
		}
	}

	return null;
}

function main() {
	const { requireXcode } = parseCliFlags(process.argv.slice(2));
	process.chdir(EXTENSIONS_ROOT);
	loadLocalEnv();

	const wxtBin = path.join(EXTENSIONS_ROOT, 'node_modules', '.bin', 'wxt');
	console.log('[build-safari] Building Safari MV3 bundle with WXT...');
	runCheckedCommand(wxtBin, ['build', '-b', 'safari'], 'wxt build -b safari');

	console.log('[build-safari] Verifying .output/safari-mv3 manifest...');
	runCheckedCommand(
		process.execPath,
		[path.join(SCRIPT_DIR, 'verify-manifests.mjs'), '--only=safari'],
		'verify-manifests --only=safari'
	);

	const bundleId = (process.env.SAFARI_BUNDLE_ID ?? '').trim() || 'com.izgah.extension';
	const developmentTeam = (process.env.DEVELOPMENT_TEAM ?? '').trim();
	const converter = locateSafariConverter();

	if (!converter) {
		const message = [
			'[build-safari] Web bundle .output/safari-mv3/ built and verified.',
			'[build-safari] Full Xcode / safari-web-extension-converter was not found; skipping Xcode wrapper generation.',
			'  - Install Xcode from the Mac App Store, then select it:',
			`    sudo xcode-select -s ${XCODE_DEVELOPER_DIR}`,
			'  - Re-run this command (or pass --require-xcode in CI release jobs) to generate extensions/safari/.'
		].join('\n');

		if (requireXcode) {
			console.error(message);
			process.exitCode = 1;
			return;
		}
		console.warn(message);
		return;
	}

	const safariProjectRoot = path.join(EXTENSIONS_ROOT, 'safari');
	mkdirSync(safariProjectRoot, { recursive: true });
	const xcrunEnv = converter.developerDir
		? { ...process.env, DEVELOPER_DIR: converter.developerDir }
		: process.env;

	console.log(
		`[build-safari] Converting .output/safari-mv3 -> extensions/safari/ (bundle: ${bundleId})...`
	);
	const convertResult = spawnSync(
		'xcrun',
		[
			'safari-web-extension-converter',
			'.output/safari-mv3',
			'--project-location',
			'./safari',
			'--app-name',
			'Izgah',
			'--bundle-identifier',
			bundleId,
			'--swift',
			'--macos-only',
			'--no-open',
			'--no-prompt',
			'--force'
		],
		{
			cwd: EXTENSIONS_ROOT,
			env: xcrunEnv,
			stdio: 'inherit'
		}
	);

	if (convertResult.error) {
		throw new Error(`safari-web-extension-converter failed: ${convertResult.error.message}`);
	}
	if (convertResult.status !== 0) {
		process.exit(convertResult.status ?? 1);
	}

	if (developmentTeam !== '') {
		console.log('[build-safari] Apple Developer Team detected. Signed release command:');
		console.log(
			`  xcodebuild -project ./safari/Izgah/Izgah.xcodeproj -scheme "Izgah (macOS)" -configuration Release DEVELOPMENT_TEAM=${developmentTeam}`
		);
	} else {
		console.log(
			'[build-safari] DEVELOPMENT_TEAM is unset. Open extensions/safari/ in Xcode to sign locally or set DEVELOPMENT_TEAM in .env for release archiving.'
		);
	}
}

try {
	main();
} catch (error) {
	console.error(`[build-safari] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
