// Visuels de la fiche Play Store, à partir des sources de store/source/ :
//   store/icone-512.png (512 × 512) et store/banniere-1024x500.png (1024 × 500).
// Usage : node scripts/store_assets.mjs   (Playwright et Chromium requis)
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'store', 'source');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// icône : SVG rendu à 512 × 512, sans transparence
const icon = await browser.newPage({ viewport: { width: 512, height: 512 } });
await icon.goto(`file://${path.join(src, 'icone.svg')}`);
await icon.screenshot({ path: path.join(root, 'store', 'icone-512.png'), omitBackground: false });
await icon.screenshot({ path: path.join(src, 'icone.png') }); // utilisée par la bannière

// bannière : page HTML rendue à 1024 × 500
const banner = await browser.newPage({ viewport: { width: 1024, height: 500 } });
await banner.goto(`file://${path.join(src, 'banniere.html')}`);
await banner.waitForTimeout(300);
await banner.screenshot({ path: path.join(root, 'store', 'banniere-1024x500.png') });

await browser.close();
console.log('store/icone-512.png et store/banniere-1024x500.png générés');
