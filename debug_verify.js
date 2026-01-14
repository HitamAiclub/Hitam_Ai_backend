
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();

cloudinary.config({
    cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.VITE_CLOUDINARY_API_KEY,
    api_secret: process.env.VITE_CLOUDINARY_API_SECRET
});

const verify = async () => {
    try {
        const timestamp = Date.now();
        const folderName = `verify_es_${timestamp}`;
        const fullPath = `hitam_ai/${folderName}/.keep`;

        console.log(`Creating image at ${fullPath}...`);

        // Manual upload to mimic create-folder endpoint logic
        const transparentPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        await cloudinary.uploader.upload(transparentPng, {
            public_id: fullPath,
            resource_type: 'image' // We put it as image
        });

        console.log('Upload done. Checking subfolders of hitam_ai...');

        const result = await cloudinary.api.sub_folders('hitam_ai');
        const folders = result.folders.map(f => f.name);
        console.log('Folders:', folders);

        if (folders.includes(folderName)) {
            console.log('SUCCESS: New folder found.');
        } else {
            console.log('FAILURE: New folder NOT found.');
        }

    } catch (error) {
        console.error('Error:', error);
    }
};

verify();
