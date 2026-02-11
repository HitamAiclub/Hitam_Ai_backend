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
// Helper to delete folder recursively (Robust Version)
const deleteFolderRecursive = async (path) => {
  console.log(`🗑️ Deleting folder recursive: ${path}`);

  // 1. Find all resources in the folder using Search API (Recursive by default for search? No, strictly folder:path)
  // We need to delete resources in THIS folder first.
  // Search API "folder" expression matches exact folder.
  // We need to check both "path" and potentially "home/path" if the prefix is ambiguous, 
  // but to be safe we will just search for the exact folder strings we believe exist.

  const pathsToCheck = [path];
  // Helper to normalize path for search. 
  // If path is "hitam_ai", we search folder:"hitam_ai".

  for (const folderPath of pathsToCheck) {
    let cursor = null;
    do {
      const result = await cloudinary.search
        .expression(`folder:"${folderPath}"`)
        .max_results(500)
        .next_cursor(cursor)
        .execute();

      const resources = result.resources;
      cursor = result.next_cursor;

      if (resources.length > 0) {
        const publicIds = resources.map(r => r.public_id);
        console.log(`   - Found ${publicIds.length} assets in ${folderPath}. Deleting...`);

        // Delete in batches of 100 using Admin API
        for (let i = 0; i < publicIds.length; i += 100) {
          const batch = publicIds.slice(i, i + 100);
          try {
            await cloudinary.api.delete_resources(batch);
          } catch (err) {
            console.error(`   ! Bulk delete failed for batch starting ${batch[0]}: ${err.message}`);
            // Fallback: Destroy one by one (Upload API) - slower but different rate limits
            for (const pid of batch) {
              await cloudinary.uploader.destroy(pid).catch(e => console.error(`     - Failed to destroy ${pid}: ${e.message}`));
            }
          }
        }
      }
    } while (cursor);
  }

  // 2. Find and Process Subfolders
  // We must use Admin API for this.
  try {
    const result = await cloudinary.api.sub_folders(path);
    const subFolders = result.folders;

    if (subFolders.length > 0) {
      console.log(`   - Found ${subFolders.length} subfolders in ${path}. Recursing...`);
      // Delete subfolders sequentially to avoid rate limits
      for (const subFolder of subFolders) {
        await deleteFolderRecursive(subFolder.path);
      }
    }
  } catch (err) {
    if (err.http_code !== 404) {
      console.warn(`   ! Error fetching subfolders for ${path}: ${err.message}`);
      // If we can't list subfolders, we might fail to delete strictly empty folder later, but we continue.
    }
  }

  // 3. Delete the folder itself
  console.log(`   - Deleting empty folder: ${path}`);
  try {
    await cloudinary.api.delete_folder(path);
  } catch (err) {
    // Ignore 404 (already gone)
    if (err.http_code !== 404) {
      console.error(`   ! Failed to delete folder ${path}: ${err.message}`);
      throw err; // Propagate error
    }
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

// Helper to rename folder recursively
const renameFolderRecursive = async (fromPath, toPath) => {
  console.log(`🔄 Rename Recursive: ${fromPath} -> ${toPath}`);

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
    console.log(`   - Search found 0 files. Checking Admin API fallback for ${fromPath}...`);
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
          console.log(`   - Fallback: Found ${res.resources.length} ${type}s via Admin API.`);
          filesFound += res.resources.length;
          for (const file of res.resources) {
            await renameAsset(file, fromPath, toPath);
          }
        }
      }
    } catch (e) {
      console.warn(`   ! Admin API fallback check warning: ${e.message}`);
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
    if (e.http_code !== 404) console.warn(`   ! Subfolder fetch warning for ${fromPath}:`, e.message);
  }

  // 3. If empty (no files found in either Search or Admin API, and no subfolders), explicitly create target folder
  // This handles the case of renaming a strictly empty folder placeholder
  if (filesFound === 0 && subfoldersFound === 0) {
    console.log(`   - Empty folder detected (no files/subs). Creating target placeholder: ${toPath}`);
    try {
      await cloudinary.api.create_folder(toPath);
    } catch (e) {
      console.warn(`   ! Failed to create target folder ${toPath}:`, e.message);
    }
  }

  // 4. Delete old folder (cleanup)
  try {
    await cloudinary.api.delete_folder(fromPath);
  } catch (e) {
    if (e.http_code !== 404) console.warn(`   ! Cleanup delete failed for ${fromPath}:`, e.message);
  }
};

// Helper to rename a single asset
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
    console.warn(`   ! Warning: File ${currentPublicId} found in search but does not match expected folder prefix ${fromPath}/`);
    return;
  }

  if (targetPublicId === currentPublicId) return;

  try {
    await cloudinary.uploader.rename(currentPublicId, targetPublicId, { resource_type: file.resource_type });
  } catch (e) {
    console.error(`   ! Failed to rename asset ${currentPublicId}:`, e.message);
  }
};

// Rename folder (Bulk rename assets)
app.post("/api/cloudinary/rename-folder", async (req, res) => {
  try {
    const { fromPath, toPath } = req.body;
    if (!fromPath || !toPath) return res.status(400).json({ error: 'Paths required' });

    console.log(`📂 Renaming folder request: "${fromPath}" -> "${toPath}"`);

    await renameFolderRecursive(fromPath, toPath);

    clearCache();
    res.json({ success: true, message: 'Folder renamed successfully' });

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

    // Ensure folder starts with 'home/' unless it is 'hitam_ai'
    const targetFolder = (folder.startsWith('home/') || folder.startsWith('hitam_ai')) ? folder : `home/${folder}`;

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