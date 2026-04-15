#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

const THRESHOLD = 0.85;

async function analyzeImage(filePath) {
    try {
        const img = sharp(filePath).resize(16, 16, { fit: "inside" }).ensureAlpha();
        const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        const channels = info.channels; // expect 3 or 4
        let sum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += channels) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            sum += lum;
            count++;
        }
        return count > 0 ? sum / count : 0;
    } catch (e) {
        return null;
    }
}

async function processFile(jsonPath) {
    const fullPath = path.join(process.cwd(), jsonPath);
    const txt = await fs.readFile(fullPath, "utf8");
    const data = JSON.parse(txt);
    let updated = false;
    let analyzed = 0;
    for (const item of data) {
        const logo = item.logo;
        if (!logo || typeof logo !== "string") {
            item.logo_is_light = false;
            continue;
        }
        // resolve logo path relative to public/
        let logoPath = logo.startsWith("/") ? logo.slice(1) : logo;
        let candidate = path.join(process.cwd(), "public", logoPath);
        let exists = false;
        try {
            await fs.access(candidate);
            exists = true;
        } catch (e) {
            exists = false;
        }
        if (!exists) {
            // try as-is under public/logo/
            candidate = path.join(process.cwd(), "public", "logo", path.basename(logoPath));
            try {
                await fs.access(candidate);
                exists = true;
            } catch (e) {
                exists = false;
            }
        }

        if (!exists) {
            item.logo_is_light = false;
            continue;
        }

        const avg = await analyzeImage(candidate);
        if (avg === null) {
            item.logo_is_light = false;
        } else {
            item.logo_is_light = avg >= THRESHOLD;
        }
        analyzed++;
        updated = true;
    }

    if (updated) {
        await fs.writeFile(fullPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }
    return { total: data.length, analyzed };
}

async function main() {
    const targets = ["src/data/partners.json", "src/data/organizations.json"];
    for (const t of targets) {
        try {
            const res = await processFile(t);
            console.log(`Updated ${t}: total=${res.total} analyzed=${res.analyzed}`);
        } catch (e) {
            console.error(`Failed processing ${t}:`, e.message);
        }
    }
}

main();
