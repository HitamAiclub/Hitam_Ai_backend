import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const logFile = 'reproduce_log_node.txt';
if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
const log = (msg) => {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
};
const error = (msg, err) => {
    console.error(msg, err);
    fs.appendFileSync(logFile, `ERROR: ${msg} ${err || ''}\n`);
};

// Helper to rename a single asset (Mock)
const renameAsset = async (file, fromPath, toPath) => {
    let currentPublicId = file.public_id;
    let targetPublicId = null;

    // Check strict directory prefix to avoid partial matching (e.g. folder vs folder_suffix)
    const candidates = [fromPath];
    if (!fromPath.startsWith('home/')) candidates.push(`home/${fromPath}`);

    for (const prefix of candidates) {
        // Require trailing slash for strict folder match
        const dirPrefix = prefix + '/';

        if (currentPublicId.startsWith(dirPrefix)) {
            let targetBase = toPath;
            if (prefix.startsWith('home/') && !toPath.startsWith('home/')) {
                targetBase = `home/${toPath}`;
            }

            const relativePath = currentPublicId.substring(dirPrefix.length);
            targetPublicId = `${targetBase}/${relativePath}`;
            break;
        }
    }

    if (!targetPublicId) {
        // Only warn if checks were strict
        // But for reproduction logging, let's see why
        log(`   ! Warning: File ${currentPublicId} found in search but does not match expected folder prefix ${fromPath}/`);
        return;
    }

    if (targetPublicId === currentPublicId) return;

    try {
        log(`   Renaming ${currentPublicId} -> ${targetPublicId}`);
        await cloudinary.uploader.rename(currentPublicId, targetPublicId, { resource_type: file.resource_type });
    } catch (e) {
        error(`   ! Failed to rename asset ${currentPublicId}:`, e.message);
    }
};

// Mock function for renameFolderRecursive (exact copy from server/index.js)
const renameFolderRecursive = async (fromPath, toPath) => {
    log(`🔄 Rename Recursive: ${fromPath} -> ${toPath}`);

    let filesFound = 0;
    let subfoldersFound = 0;

    // 1. Rename files in this folder
    // Use Search API as primary method
    let cursor = null;
    do {
        const result = await cloudinary.search
            .expression(`folder:"${fromPath}"`)
            .max_results(500)
            .next_cursor(cursor)
            .execute();
        cursor = result.next_cursor;

        if (result.resources.length > 0) {
            filesFound += result.resources.length;
            for (const file of result.resources) {
                await renameAsset(file, fromPath, toPath);
            }
        }
    } while (cursor);

    // 1b. Fallback: If no files found via Search, check Admin API (handling indexing delays)
    if (filesFound === 0) {
        log(`   - Search found 0 files. Checking Admin API fallback for ${fromPath}...`);
        try {
            // Check images, video, raw
            const types = ['image', 'video', 'raw'];
            for (const type of types) {
                const res = await cloudinary.api.resources({
                    type: 'upload',
                    prefix: fromPath + '/', // Important: prefix must have trailing slash to target folder contents
                    resource_type: type,
                    max_results: 500
                });

                if (res.resources && res.resources.length > 0) {
                    log(`   - Fallback: Found ${res.resources.length} ${type}s via Admin API.`);
                    filesFound += res.resources.length;
                    for (const file of res.resources) {
                        await renameAsset(file, fromPath, toPath);
                    }
                } else {
                    log(`   - Fallback: No ${type}s found.`);
                }
            }
        } catch (e) {
            error(`   ! Admin API fallback check warning:`, e.message);
        }
    }

    // 2. Process subfolders
    try {
        const subRes = await cloudinary.api.sub_folders(fromPath);
        subfoldersFound = subRes.folders.length;

        for (const sub of subRes.folders) {
            const subName = sub.name;
            const newSubFrom = sub.path;
            const newSubTo = `${toPath}/${subName}`;

            await renameFolderRecursive(newSubFrom, newSubTo);
        }
    } catch (e) {
        if (e.http_code !== 404) error(`   ! Subfolder fetch warning for ${fromPath}:`, e.message);
    }

    // 3. If empty (no files found in either Search or Admin API, and no subfolders), explicitly create target folder
    // This handles the case of renaming a strictly empty folder placeholder
    if (filesFound === 0 && subfoldersFound === 0) {
        log(`   - Empty folder detected (no files/subs). Creating target placeholder: ${toPath}`);
        try {
            await cloudinary.api.create_folder(toPath);
        } catch (e) {
            error(`   ! Failed to create target folder ${toPath}:`, e.message);
        }
    }

    // 4. Delete old folder (cleanup)
    try {
        await cloudinary.api.delete_folder(fromPath);
        log(`   Deleted old folder: ${fromPath}`);
    } catch (e) {
        if (e.http_code !== 404) error(`   ! Cleanup delete failed for ${fromPath}:`, e.message);
        else log(`   Old folder ${fromPath} already gone (empty).`);
    }
};


const TEST_FOLDER = 'hitam_ai/session_report/06-02-2026';
const RENAMED_FOLDER = 'hitam_ai/session_report/06-02-2026_new era of hitam ai';

async function test() {
    log("--- Reproduction Test: Nested Folder Rename ---");

    // 1. Setup: Create Folder & File
    try {
        log(`1. Setting up: ${TEST_FOLDER}`);
        // Create new unique name to avoid conflicts from previous runs
        const uniqueSuffix = Date.now();
        const setupFile = `${TEST_FOLDER}/sample_${uniqueSuffix}`;

        // Create parent first to ensure path exists for strict APIs? Cloudinary create_folder creates parents usually.
        await cloudinary.api.create_folder(TEST_FOLDER).catch(e => log(`Create folder info: ${e.message}`));

        await cloudinary.uploader.upload('https://res.cloudinary.com/demo/image/upload/sample.jpg', {
            folder: TEST_FOLDER,
            public_id: `sample_${uniqueSuffix}`
        });
        log(`   Setup done. File: ${setupFile}`);
    } catch (e) {
        error("   Setup failed:", e.message);
    }

    // 2. Execute Rename
    try {
        log(`2. Executing rename...`);
        // Note: ensure renameFolderRecursive logic matches server/index.js exactly (including latest updates)
        await renameFolderRecursive(TEST_FOLDER, RENAMED_FOLDER);
        log("   Rename Execution Finished.");
    } catch (e) {
        error("   Rename failed:", e.message);
    }

    // 3. Verify
    try {
        log("3. Verifying...");
        // We uploaded `sample_${uniqueSuffix}`
        // Check if it exists in NEW folder
        // Need to find what `uniqueSuffix` was used if possible? No, closure scope.
        // But wait, the upload above used `sample_${uniqueSuffix}`.
        // The rename logic should have moved it.

        // Let's just search for ANY file in RENAMED_FOLDER
        const newFiles = await cloudinary.search.expression(`folder:"${RENAMED_FOLDER}"`).execute();

        if (newFiles.total_count > 0) {
            log(`SUCCESS: File moved correctly. Found ${newFiles.total_count} files.`);
        } else {
            error(`FAILURE: File not found at new location.`);
            const oldFiles = await cloudinary.search.expression(`folder:"${TEST_FOLDER}"`).execute();
            log(`Old location count: ${oldFiles.total_count}`);
        }
    } catch (e) {
        error("Verify check failed (might mean file not found):", e.message);
    }

    // Cleanup
    log("4. Cleanup...");
    try { await cloudinary.api.delete_folder(RENAMED_FOLDER); } catch (e) { }
    try { await cloudinary.api.delete_folder(TEST_FOLDER); } catch (e) { }
}

test();
