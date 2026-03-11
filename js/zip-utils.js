/**
 * zip-utils.js — Shared ZIP extraction utility.
 *
 * Used by dashboard.js and editor.js. Extracted from both to eliminate
 * duplication (previously defined identically in each file).
 *
 * Requires the JSZip global (loaded via vendor/jszip.min.js as a non-module
 * script before any module scripts).
 */

/**
 * Extract YAML files (and theme.css) from a ZIP ArrayBuffer.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<Array<{ path: string, text: string }>>}
 */
export async function unzipToFiles(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files = [];
  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    const entryName = relativePath.split('/').pop();
    if (!entryName.endsWith('.yaml') && entryName !== 'theme.css') continue;
    const text = await zipEntry.async('string');
    files.push({ path: relativePath, text });
  }
  return files;
}
