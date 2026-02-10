import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env from root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

console.log("Checking Cloudinary Config...");
console.log("Cloud Name:", process.env.VITE_CLOUDINARY_CLOUD_NAME);
console.log("API Key:", process.env.VITE_CLOUDINARY_API_KEY ? "Set" : "Missing");
console.log("Preset to test:", process.env.VITE_CLOUDINARY_UPLOAD_PRESET);

cloudinary.config({
    cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.VITE_CLOUDINARY_API_KEY,
    api_secret: process.env.VITE_CLOUDINARY_API_SECRET,
});

async function checkPreset() {
    try {
        console.log("\nAttempting to list presets...");
        const result = await cloudinary.api.upload_presets({ max_results: 500 });

        const preset = result.presets.find(p => p.name === process.env.VITE_CLOUDINARY_UPLOAD_PRESET);

        if (preset) {
            console.log("✅ Preset Found!");
            console.log("Name:", preset.name);
            console.log("Unsigned:", preset.unsigned);
            console.log("Folder Mode:", preset.settings.folder ? "Fixed" : "Dynamic Allowed (maybe)");

            if (!preset.unsigned) {
                console.error("❌ ERROR: Preset is SIGNED. It must be UNSIGNED for client-side uploads.");
            } else {
                console.log("✅ Preset configuration looks correct for unsigned upload.");
            }
        } else {
            console.error(`❌ Preset '${process.env.VITE_CLOUDINARY_UPLOAD_PRESET}' NOT found.`);
            console.log("Available presets:", result.presets.map(p => p.name).join(", "));
        }
    } catch (error) {
        console.error("Error accessing Cloudinary API:", error.message);
    }
}

checkPreset();
