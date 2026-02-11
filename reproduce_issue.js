import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const TEST_FOLDER = 'hitam_ai/upcoming-activities/Test Debug Folder';
const RENAMED_FOLDER = 'hitam_ai/upcoming-activities/Test Debug Folder Renamed';

async function test() {
    console.log("--- Starting Cloudinary Folder Test (With Spaces & Files) ---");

    // 1. Create Folder
    try {
        console.log(`1. Creating folder: ${TEST_FOLDER}`);
        await cloudinary.api.create_folder(TEST_FOLDER);
        console.log("   Create success.");
    } catch (e) {
        console.error("   Create failed:", e.message);
    }

    // 1b. Upload a dummy file
    try {
        console.log(`1b. Uploading file to: ${TEST_FOLDER}`);
        // Create a dummy base64 image
        const dummyImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKw66AAAAABJRU5ErkJggg==';
        await cloudinary.uploader.upload(dummyImage, {
            folder: TEST_FOLDER,
            public_id: 'test_image'
        });
        console.log("   Upload success.");
    } catch (e) {
        console.error("   Upload failed:", e.message);
    }

    // 2. Rename Folder
    // Note: Backend rename-folder endpoint uses complex logic. We should probably simulate calling that function directly or mimic it more closely.
    // But for now, let's just try to delete the folder with content, as that's the primary complaint (delete/rename failing).
    // If delete fails, rename will also likely fail (as it deletes old folder).

    // 3. Delete Folder (Recursive)
    try {
        console.log(`3. Deleting folder: ${TEST_FOLDER}`);

        // Mimic the backend's deleteFolderRecursive logic
        const path = TEST_FOLDER;
        const pathsToCheck = [path];
        const altPath = path.startsWith('home/') ? path.replace(/^home\//, '') : `home/${path}`;
        if (altPath !== path) pathsToCheck.push(altPath);

        console.log(`   Deleting resources in: ${pathsToCheck.join(', ')}`);

        for (const p of pathsToCheck) {
            await Promise.all([
                cloudinary.api.delete_resources_by_prefix(p + "/", { resource_type: 'image' }).catch(e => console.log('   Del res error:', e.message)),
                cloudinary.api.delete_resources_by_prefix(p + "/", { resource_type: 'video' }).catch(e => console.log('   Del res error:', e.message)),
                cloudinary.api.delete_resources_by_prefix(p + "/", { resource_type: 'raw' }).catch(e => console.log('   Del res error:', e.message))
            ]);
        }

        console.log("   Deleting folder itself...");
        await cloudinary.api.delete_folder(path).catch(e => console.log("   Delete main folder error:", e.message));
        try {
            await cloudinary.api.delete_folder(altPath);
        } catch (e) { console.log("   Delete alt folder error (expected if main succeeded):", e.message); }

        console.log("   Delete logic finished.");

    } catch (e) {
        console.error("   Delete failed hard:", e.message);
    }
}

test();
