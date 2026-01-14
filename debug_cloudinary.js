
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();

cloudinary.config({
    cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.VITE_CLOUDINARY_API_KEY,
    api_secret: process.env.VITE_CLOUDINARY_API_SECRET
});

const checkFolders = async () => {
    try {
        console.log('--- Root Folders ---');
        const rootFolders = await cloudinary.api.sub_folders('/');
        console.log(rootFolders.folders.map(f => `${f.name} (${f.path})`));

        console.log('\n--- hitam_ai children ---');
        try {
            const hitamChildren = await cloudinary.api.sub_folders('hitam_ai');
            console.log(hitamChildren.folders.map(f => `${f.name} (${f.path})`));

            // Check if there is a nested hitam_ai
            const nested = hitamChildren.folders.find(f => f.name === 'hitam_ai');
            if (nested) {
                console.log('\n!!! FOUND NESTED hitam_ai !!!');
                console.log('Path:', nested.path);

                console.log('\n--- hitam_ai/hitam_ai children ---');
                const nestedChildren = await cloudinary.api.sub_folders('hitam_ai/hitam_ai');
                console.log(nestedChildren.folders.map(f => `${f.name} (${f.path})`));
            }

        } catch (e) {
            console.log('Error fetching hitam_ai children:', e.message);
        }

    } catch (error) {
        console.error('Error:', error);
    }
};

checkFolders();
