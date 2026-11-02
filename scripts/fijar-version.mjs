// Fija la versión de una entrega en todas sus piezas: `npm run version:fijar -- 0.3.1`.
// Después: commit, `git tag v0.3.1` y push del tag; el workflow «Publicar» hace el resto.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Uso: npm run version:fijar -- X.Y.Z');
  process.exit(1);
}

// package.json y package-lock.json, como lo hace npm (sin commit ni tag). Se llama al npm que corre este script, sin pasar por el shell.
const npm = process.env.npm_execpath;
if (!npm) {
  console.error('Ejecútalo con: npm run version:fijar -- X.Y.Z');
  process.exit(1);
}
execFileSync(process.execPath, [npm, 'version', version, '--no-git-tag-version', '--allow-same-version', '--ignore-scripts'], { cwd: RAIZ, stdio: 'inherit' });

const SEMVER = String.raw`\d+\.\d+\.\d+`;
/** Cambia solo los textos de versión, sin reformatear el archivo. */
const piezas = [
  ['server.json', [[new RegExp(`"version": "${SEMVER}"`, 'g'), `"version": "${version}"`]]],
  ['.claude-plugin/plugin.json', [[new RegExp(`"version": "${SEMVER}"`), `"version": "${version}"`], [new RegExp(`mi-sii-mcp@${SEMVER}`, 'g'), `mi-sii-mcp@${version}`]]],
  ['gemini-extension.json', [[new RegExp(`"version": "${SEMVER}"`), `"version": "${version}"`], [new RegExp(`mi-sii-mcp@${SEMVER}`, 'g'), `mi-sii-mcp@${version}`]]],
  ['mcp.json', [[new RegExp(`mi-sii-mcp@${SEMVER}`, 'g'), `mi-sii-mcp@${version}`]]],
  ['docs/index.html', [[new RegExp(`"softwareVersion": "${SEMVER}"`), `"softwareVersion": "${version}"`]]],
];
for (const [archivo, cambios] of piezas) {
  const ruta = resolve(RAIZ, archivo);
  let texto = readFileSync(ruta, 'utf8');
  for (const [patron, nuevo] of cambios) {
    if (!patron.test(texto)) throw new Error(`No encontré la versión en ${archivo}.`);
    patron.lastIndex = 0;
    texto = texto.replace(patron, nuevo);
  }
  writeFileSync(ruta, texto);
}
console.log(`Versión ${version} en package.json, package-lock.json, server.json, el plugin, la extensión, mcp.json y el sitio.`);
