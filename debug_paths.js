import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});


async function debugPaths() {
    console.log("--- Cloudinary Folder Path Debug ---");
    const output = { folders: [], assets: [] };

    try {
        const rootFolders = await cloudinary.api.root_folders();
        output.folders = rootFolders.folders;

        console.log("Root Folders fetched.");

        try {
            // Search without folder restriction to find where 06-02-2026 is
            const srch = await cloudinary.search
                .expression('resource_type:image AND public_id:*06-02-2026*')
                .max_results(50)
                .execute();

            output.assets = srch.resources.map(r => ({ public_id: r.public_id, folder: r.folder }));
            console.log(`Found ${output.assets.length} matching assets.`);

        } catch (e) {
            console.error("Search failed", e);
            output.searchError = e.message;
        }

        fs.writeFileSync('debug_output.json', JSON.stringify(output, null, 2));
        console.log("Debug output written to debug_output.json");

    } catch (e) {
        console.error("Error:", e);
    }
}

debugPaths();
