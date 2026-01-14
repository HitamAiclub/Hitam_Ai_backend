#!/bin/bash
# Upload System Verification Script

echo "🔍 Checking Upload System Configuration..."
echo ""

# Check .env file
echo "1. ✅ Checking .env file..."
if grep -q "VITE_CLOUDINARY_CLOUD_NAME" ".env"; then
    echo "   ✓ VITE_CLOUDINARY_CLOUD_NAME found"
else
    echo "   ✗ VITE_CLOUDINARY_CLOUD_NAME missing"
fi

if grep -q "VITE_CLOUDINARY_UPLOAD_PRESET" ".env"; then
    echo "   ✓ VITE_CLOUDINARY_UPLOAD_PRESET found"
else
    echo "   ✗ VITE_CLOUDINARY_UPLOAD_PRESET missing"
fi

if grep -q "VITE_CLOUDINARY_API_KEY" ".env"; then
    echo "   ✓ VITE_CLOUDINARY_API_KEY found"
else
    echo "   ✗ VITE_CLOUDINARY_API_KEY missing"
fi

echo ""
echo "2. ✅ Checking component files..."
if [ -f "src/components/ui/FileUpload.jsx" ]; then
    echo "   ✓ FileUpload.jsx exists"
else
    echo "   ✗ FileUpload.jsx missing"
fi

if [ -f "src/pages/admin/MediaManagementEnhanced.jsx" ]; then
    echo "   ✓ MediaManagementEnhanced.jsx exists"
else
    echo "   ✗ MediaManagementEnhanced.jsx missing"
fi

echo ""
echo "3. ✅ Checking utility files..."
if grep -q "uploadToCloudinary" "src/utils/cloudinary.js"; then
    echo "   ✓ uploadToCloudinary function found"
else
    echo "   ✗ uploadToCloudinary function missing"
fi

if grep -q "getAllCloudinaryFiles" "src/utils/cloudinary.js"; then
    echo "   ✓ getAllCloudinaryFiles function found"
else
    echo "   ✗ getAllCloudinaryFiles function missing"
fi

echo ""
echo "4. ✅ Checking server files..."
if grep -q "api/cloudinary/all-files" "server/index.js"; then
    echo "   ✓ /api/cloudinary/all-files endpoint found"
else
    echo "   ✗ /api/cloudinary/all-files endpoint missing"
fi

if grep -q "api/cloudinary/delete" "server/index.js"; then
    echo "   ✓ /api/cloudinary/delete endpoint found"
else
    echo "   ✗ /api/cloudinary/delete endpoint missing"
fi

echo ""
echo "5. ✅ Checking documentation..."
if [ -f "00_START_HERE.md" ]; then
    echo "   ✓ 00_START_HERE.md found"
else
    echo "   ✗ 00_START_HERE.md missing"
fi

if [ -f "CODE_EXAMPLES.md" ]; then
    echo "   ✓ CODE_EXAMPLES.md found"
else
    echo "   ✗ CODE_EXAMPLES.md missing"
fi

if [ -f "UPLOAD_TESTING.md" ]; then
    echo "   ✓ UPLOAD_TESTING.md found"
else
    echo "   ✗ UPLOAD_TESTING.md missing"
fi

echo ""
echo "✅ Verification complete!"
echo ""
echo "Next steps:"
echo "1. Run: npm run dev"
echo "2. In another terminal: node server/index.js"
echo "3. Go to: http://localhost:5173/test-upload"
echo "4. Try uploading a file"
