
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();

cloudinary.config({
    cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.VITE_CLOUDINARY_API_KEY,
    api_secret: process.env.VITE_CLOUDINARY_API_SECRET
});

const uploadDemo = async (folder, publicIdSuffix) => {
    try {
        console.log(`Uploading to ${folder}...`);
        // Use a real placeholder image URL (random nature image)
        const imageUrl = "https://picsum.photos/400/300";

        await cloudinary.uploader.upload(imageUrl, {
            folder: folder,
            public_id: publicIdSuffix,
            resource_type: 'image'
        });
        console.log(`Uploaded to ${folder}/${publicIdSuffix}`);
    } catch (e) {
        console.error("Upload failed:", e);
    }
};

const run = async () => {
    // Upload to root (hitam_ai)
    await uploadDemo('hitam_ai', 'demo_image_root');

    // Upload to sample folder
    await uploadDemo('hitam_ai/sample_demo_folder', 'demo_image_sub');

    console.log("Demo content populated.");
};

run();
