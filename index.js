import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Production readiness
const isProduction = process.env.NODE_ENV === 'production';

// ✅ CORS: Allow both development and production origins
const corsOptions = {
  origin: (origin, callback) => {
    // Allow these origins
    const allowedOrigins = [
      'http://localhost:5173',           // Local frontend (Vite dev server)
      'http://localhost:3000',           // Alternative local port
      'https://hitam-ai-club.vercel.app', // Production frontend
      process.env.FRONTEND_URL,           // Env var for production
    ].filter(Boolean);

    // Allow requests with no origin (mobile apps, curl requests)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  optionsSuccessStatus: 200
};

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dwva5ae36',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ✅ In-Memory Cache to prevent Rate Limiting
const cache = {
  data: new Map(),
  ttl: 5 * 60 * 1000, // 5 minutes default TTL
};

const getFromCache = (key) => {
  if (cache.data.has(key)) {
    const { value, expiry } = cache.data.get(key);
    if (Date.now() < expiry) {
      console.log(`⚡ Serving from cache: ${key}`);
      return value;
    }
    cache.data.delete(key); // Expired
  }
  return null;
};

const setCache = (key, value, ttl = cache.ttl) => {
  cache.data.set(key, {
    value,
    expiry: Date.now() + ttl
  });
};

const clearCache = () => {
  console.log('🧹 Clearing Cloudinary cache');
  cache.data.clear();
};

// Helper function to map Cloudinary folders to UI folders
const mapFolderToUI = (publicId) => {
  const pathParts = publicId.split('/');
  let folderName = 'general';

  if (pathParts.length > 1) {
    const cloudinaryFolder = pathParts[1];
    switch (cloudinaryFolder) {
      case 'committee_members':
        folderName = 'commitymembers';
        break;
      case 'events':
      case 'upcoming_events':
        folderName = 'events';
        break;
      case 'form_register':
      case 'form_builder':
        folderName = 'formregister';
        break;
      case 'user_profiles':
      case 'community_members':
        folderName = 'profiles';
        break;
      case 'general':
        folderName = 'general';
        break;
      default:
        folderName = 'general';
    }
  }

  return folderName;
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Root route
app.get("/", (req, res) => {
  res.send("HITAM AI API is running");
});

// Cloudinary API endpoints

// Get all images (for backward compatibility)
app.get("/api/cloudinary/all-images", async (req, res) => {
  try {
    const cached = getFromCache('all_images');
    if (cached) return res.json(cached);

    const result = await cloudinary.search
      .expression('resource_type:image')
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute();

    const images = result.resources.map(resource => {
      return {
        id: resource.public_id,
        url: resource.secure_url,
        publicId: resource.public_id,
        name: resource.public_id.split('/').pop(),
        folder: mapFolderToUI(resource.public_id),
        size: resource.bytes,
        width: resource.width,
        height: resource.height,
        format: resource.format,
        type: 'image',
        resourceType: 'image',
        createdAt: resource.created_at,
        originalFolder: resource.public_id.split('/')[1] || 'general',
      };
    });

    setCache('all_images', images);
    res.json(images);
  } catch (error) {
    console.error('Error fetching all images:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// Get all files (images, PDFs, documents, etc.)
app.get("/api/cloudinary/all-files", async (req, res) => {
  try {
    const cached = getFromCache('all_files');
    if (cached) return res.json(cached);

    // Fetch all resources under home folder hierarchy
    const result = await cloudinary.search
      .expression('folder:home*')
      .sort_by('created_at', 'desc')
      .max_results(500)
      .execute();

    const files = result.resources.map(resource => {
      let fileType = 'document';
      if (resource.type === 'image') {
        fileType = 'image';
      } else if (resource.format === 'pdf') {
        fileType = 'pdf';
      } else if (['doc', 'docx', 'docm'].includes(resource.format)) {
        fileType = 'document';
      } else if (['xls', 'xlsx', 'xlsm', 'csv'].includes(resource.format)) {
        fileType = 'spreadsheet';
      } else if (['ppt', 'pptx'].includes(resource.format)) {
        fileType = 'presentation';
      }

      return {
        id: resource.public_id,
        url: resource.secure_url,
        publicId: resource.public_id,
        name: resource.public_id.split('/').pop(),
        folder: mapFolderToUI(resource.public_id),
        actualFolder: resource.folder || 'home',
        size: resource.bytes,
        width: resource.width || null,
        height: resource.height || null,
        format: resource.format,
        type: fileType,
        resourceType: resource.resource_type,
        createdAt: resource.created_at,
        originalFolder: resource.public_id.split('/')[1] || 'home',
      };
    });

    setCache('all_files', files);
    res.json(files);
  } catch (error) {
    console.error('Error fetching all files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Get files in a folder (all types)
app.get("/api/cloudinary/files", async (req, res) => {
  try {
    const { folder, refresh } = req.query;
    // If folder is undefined, default to 'hitam_ai', but if it's empty string, use it (root)
    const folderQuery = folder !== undefined ? folder : 'hitam_ai';
    const cacheKey = `files_${folderQuery}`;

    if (refresh !== 'true') {
      const cached = getFromCache(cacheKey);
      if (cached) return res.json(cached);
    }

    // Cloudinary Search API allows fetching mixed types
    // We add folder: query.
    const result = await cloudinary.search
      .expression(`folder:"${folderQuery}"`)
      .sort_by('created_at', 'desc')
      .max_results(500)
      .execute();

    const files = result.resources.map(file => ({
      id: file.asset_id,
      name: file.filename, // Note: raw files might behave differently
      publicId: file.public_id,
      url: file.secure_url,
      format: file.format,
      width: file.width,
      height: file.height,
      size: file.bytes,
      createdAt: file.created_at,
      resourceType: file.resource_type
    }));

    res.json(files);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Delete folder (and its contents)
// Helper to delete folder recursively
const deleteFolderRecursive = async (path) => {
  try {
    // 1. Delete all files in this folder (and subfolders mostly if prefix matches?) 
    // Note: delete_resources_by_prefix deletes files in subfolders too! 
    // So we don't need to recursively delete files, just folder entries.

    await Promise.all([
      cloudinary.api.delete_resources_by_prefix(path + "/", { resource_type: 'image' }),
      cloudinary.api.delete_resources_by_prefix(path + "/", { resource_type: 'video' }),
      cloudinary.api.delete_resources_by_prefix(path + "/", { resource_type: 'raw' })
    ]);

    // 2. Get Subfolders
    try {
      // sub_folders API returns immediate children
      const result = await cloudinary.api.sub_folders(path);
      const subFolders = result.folders;

      // 3. Delete subfolders recursively
      // We do this serially or parallel? Parallel is faster.
      await Promise.all(subFolders.map(folder => deleteFolderRecursive(folder.path)));
    } catch (e) {
      // sub_folders might 404 if no subfolders or path invalid, ignore
    }

    // 4. Delete the folder itself
    await cloudinary.api.delete_folder(path);

  } catch (error) {
    // If folder is already gone or other issue, log but don't crash main flow if possible
    console.error(`Failed to delete folder path: ${path}`, error.message);
    throw error; // Propagate up if needed
  }
};

// Delete folder (recursive)
app.delete("/api/cloudinary/delete-folder", async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Folder path required' });

    await deleteFolderRecursive(folderPath);
    clearCache();

    res.json({ success: true, message: 'Folder deleted' });
  } catch (error) {
    console.error('Error deleting folder:', error);
    res.status(500).json({ error: `Failed to delete folder: ${error.message}` });
  }
});

// Rename folder (Bulk rename assets)
app.post("/api/cloudinary/rename-folder", async (req, res) => {
  try {
    const { fromPath, toPath } = req.body;
    if (!fromPath || !toPath) return res.status(400).json({ error: 'Paths required' });

    // 1. Get all resources in old folder
    const result = await cloudinary.search
      .expression(`folder:"${fromPath}"`)
      .max_results(500)
      .execute();

    const resources = result.resources;

    if (resources.length === 0) {
      // Just empty folder?
      try {
        await cloudinary.api.create_folder(toPath);
        await cloudinary.api.delete_folder(fromPath);
      } catch (e) { /* ignore */ }
      return res.json({ success: true, message: 'Empty folder renamed' });
    }

    // 2. Rename each asset
    // Note: This matches partial paths too if strict not used, but folder search is usually good.
    // We limit concurrency to avoid rate limits
    const results = await Promise.allSettled(resources.map(async (file) => {
      const newPublicId = file.public_id.replace(fromPath, toPath);
      return cloudinary.uploader.rename(file.public_id, newPublicId, { resource_type: file.resource_type });
    }));

    // 3. Cleanup logic (optional, folder usually disappears if empty)
    try {
      await cloudinary.api.delete_folder(fromPath);
    } catch (e) {
      console.log("Could not delete old folder (might not be empty)", e.message);
    }

    clearCache();
    res.json({ success: true, message: `Renamed folder and ${resources.length} assets` });

  } catch (error) {
    console.error('Error renaming folder:', error);
    res.status(500).json({ error: `Failed to rename folder: ${error.message}` });
  }
});

// Get all folders
app.get("/api/cloudinary/folders", async (req, res) => {
  try {
    const { parent, refresh } = req.query;
    const cacheKey = `folders_${parent || 'root'}`;

    if (refresh !== 'true') {
      const cached = getFromCache(cacheKey);
      if (cached) return res.json(cached);
    }

    let result;

    if (parent) {
      result = await cloudinary.api.sub_folders(parent);
    } else {
      result = await cloudinary.api.root_folders();
    }

    const folders = result.folders.map(folder => ({
      name: folder.name,
      path: folder.path,
      filesCount: folder.files_count || 0
    }));

    setCache(cacheKey, folders);
    res.json(folders);
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// Upload file to Cloudinary (backend endpoint - preferred method)
app.post("/api/cloudinary/upload", async (req, res) => {
  try {
    const { file, folder = 'home' } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'File is required' });
    }

    // Ensure folder starts with 'home/'
    const targetFolder = folder.startsWith('home/') ? folder : `home/${folder}`;

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(file, {
      folder: targetFolder,
      resource_type: 'auto',
      use_filename: true,
    });

    clearCache();
    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      folder: targetFolder,
      originalName: result.original_filename || result.public_id.split('/').pop(),
      format: result.format,
      type: result.type === 'image' ? 'image' : result.resource_type || 'document',
      resourceType: result.resource_type,
      uploadedAt: new Date().toISOString(),
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: `Upload failed: ${error.message}` });
  }
});

// Create a new folder by uploading a .keep file
app.post("/api/cloudinary/create-folder", async (req, res) => {
  try {
    const { folderPath, folderName } = req.body;

    if (!folderPath || !folderName) {
      return res.status(400).json({ error: 'Folder path and name are required' });
    }

    // Create folder explicitly using Admin API
    const targetFolder = `${folderPath}/${folderName}`;
    console.log(`📂 Creating folder via API: ${targetFolder}`);

    const result = await cloudinary.api.create_folder(targetFolder);
    console.log('✅ Folder created:', result);

    clearCache();
    res.json({
      success: true,
      message: `Folder '${folderName}' created successfully`,
      folderPath: result.path || targetFolder,
      publicId: null // No file created
    });
  } catch (error) {
    console.error('❌ Error creating folder:', error);
    res.status(500).json({ error: `Failed to create folder: ${error.message}` });
  }
});

// Rename file
app.post("/api/cloudinary/rename", async (req, res) => {
  try {
    const { fromPublicId, toPublicId } = req.body;

    if (!fromPublicId || !toPublicId) {
      return res.status(400).json({ error: 'Both fromPublicId and toPublicId are required' });
    }

    const result = await cloudinary.uploader.rename(fromPublicId, toPublicId);
    clearCache();

    res.json({
      success: true,
      message: 'File renamed successfully',
      publicId: result.public_id,
      url: result.secure_url
    });
  } catch (error) {
    console.error('Error renaming file:', error);
    res.status(500).json({ error: `Failed to rename file: ${error.message}` });
  }
});

// Delete file
app.delete("/api/cloudinary/delete", async (req, res) => {
  try {
    const { publicId, resourceType } = req.body;

    if (!publicId) {
      return res.status(400).json({ error: 'Public ID is required' });
    }

    // resource_type must be: image, video, or raw. 'auto' is not allowed for destroy.
    const type = resourceType || 'image';

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: type });

    if (result.result === 'ok' || result.result === 'not found') {
      clearCache();
      res.json({ success: true, message: 'File deleted successfully' });
    } else {
      console.error('Delete result:', result);
      res.status(400).json({ error: 'Failed to delete file', result });
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Start server with port fallback
const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📍 Environment: ${isProduction ? 'Production' : 'Development'}`);
    if (process.env.FRONTEND_URL) {
      console.log(`🌐 CORS enabled for: ${process.env.FRONTEND_URL}`);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Port ${port} is busy, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('❌ Server error:', err);
      process.exit(1);
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    process.exit(0);
  });
}


// Only listen if not running on Vercel (Vercel exports the app)
if (!process.env.VERCEL) {
  startServer(PORT);
}

export default app;