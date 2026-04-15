#!/usr/bin/env node
import fs from 'fs';
import Jimp from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = [
    'public/logo/partners/ahec-northwest.png',
    'public/logo/partners/ahec-interior.png',
    'public/logo/partners/ykhc-partner.png',
    'public/logo/partners/ahec-southcentral.jpg',
    'public/logo/partners/ahec-southeast.png',
    'public/logo/partners/ahec-southwest.png'
];

async function process(file) {
    if (!fs.existsSync(file)) {
        console.warn('Missing:', file);
        return;
    }

    const ext = path.extname(file).toLowerCase();
    const base = file.replace(ext, '');

    const image = await Jimp.read(file);

    // Create display version (max width 400)
    const display = image.clone();
    if (display.getWidth() > 400) {
        display.resize(400, Jimp.AUTO);
    }
    if (ext === '.jpg' || ext === '.jpeg') {
        await display.quality(85).writeAsync(base + '-400.jpg');
    } else {
        await display.deflateLevel(9).writeAsync(base + '-400.png');
    }

    // Create favicon 32x32 PNG
    const favicon = image.clone().contain(32, 32, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
    await favicon.deflateLevel(9).writeAsync(base + '-32.png');

    // Create apple-touch 180x180
    const touch = image.clone().contain(180, 180, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
    await touch.deflateLevel(9).writeAsync(base + '-180.png');

    console.log('Processed', file);
}

(async () => {
    for (const f of files) {
        try {
            await process(path.join(__dirname, '..', f.replace(/^public\//, 'public/')));
        } catch (err) {
            console.error('Error processing', f, err);
        }
    }
})();
