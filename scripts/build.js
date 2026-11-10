/**
 * @fileoverview Script de build para preparar os artefatos de publicação no diretório dist/
 * compatível com @google/clasp (rootDir: "dist").
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

/**
 * Remove recursivamente o diretório de destino e o recria limpo.
 * @param {string} dirPath Caminho do diretório.
 */
function resetDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Copia arquivos recursivamente de src/ para dist/.
 * Também gera cópias na raiz de dist/ para os arquivos HTML a fim de garantir
 * compatibilidade total com HtmlService no Google Apps Script.
 *
 * @param {string} currentSrc Diretório de origem atual.
 * @param {string} currentDist Diretório de destino atual.
 */
function copyFiles(currentSrc, currentDist) {
  const entries = fs.readdirSync(currentSrc, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(currentSrc, entry.name);
    const distPath = path.join(currentDist, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(distPath, { recursive: true });
      copyFiles(srcPath, distPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, distPath);

      // Se for um arquivo HTML dentro de subpastas (ex: src/html/Index.html),
      // copia também para a raiz de dist/ para resolução direta no GAS
      if (path.extname(entry.name).toLowerCase() === '.html' && currentDist !== DIST_DIR) {
        const rootHtmlPath = path.join(DIST_DIR, entry.name);
        fs.copyFileSync(srcPath, rootHtmlPath);
      }
    }
  }
}

function main() {
  console.log('[Build] Limpando diretório dist/...');
  resetDirectory(DIST_DIR);

  console.log('[Build] Copiando artefatos de src/ para dist/...');
  copyFiles(SRC_DIR, DIST_DIR);

  console.log('[Build] Build concluído com sucesso em dist/.');
}

main();

