import v2 from 'cloudinary';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const cloudinary = v2.v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const folderPath = 'home/hitam_ai/test folder with spaces 1770712263068'; // The stubborn folder

async function checkFolder() {
    console.log(`Checking folder: "${folderPath}"`);

    // 1. Check for images
    try {
        const res = await cloudinary.api.resources({
            type: 'upload',
            prefix: folderPath + '/',
            resource_type: 'image',
            max_results: 500
        });
        console.log(`Found ${res.resources.length} images.`);
        res.resources.forEach(r => console.log(` - ${r.public_id}`));
    } catch (e) {
        console.log('Error checking images:', e.message);
    }

    // 2. Check for videos
    try {
        const res = await cloudinary.api.resources({
            type: 'upload',
            prefix: folderPath + '/',
            resource_type: 'video',
            max_results: 500
        });
        console.log(`Found ${res.resources.length} videos.`);
        res.resources.forEach(r => console.log(` - ${r.public_id}`));
    } catch (e) {
        console.log('Error checking videos:', e.message);
    }

    // 3. Check for raw files
    try {
        const res = await cloudinary.api.resources({
            type: 'upload',
            prefix: folderPath + '/',
            resource_type: 'raw',
            max_results: 500
        });
        console.log(`Found ${res.resources.length} raw files.`);
        res.resources.forEach(r => console.log(` - ${r.public_id}`));
    } catch (e) {
        console.log('Error checking raw files:', e.message);
    }

    // 4. Check for sub-folders
    try {
        const res = await cloudinary.api.sub_folders(folderPath);
        console.log(`Found ${res.folders.length} subfolders.`);
        res.folders.forEach(f => console.log(` - ${f.path}`));
    } catch (e) {
        console.log('Error checking subfolders:', e.message);
    }
}

checkFolder();
