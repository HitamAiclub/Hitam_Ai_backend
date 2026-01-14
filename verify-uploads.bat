@echo off
REM Upload System Verification Script (Windows)

echo.
echo 🔍 Checking Upload System Configuration...
echo.

REM Check .env file
echo 1. Checking .env file...
findstr /M "VITE_CLOUDINARY_CLOUD_NAME" .env >nul
if %ERRORLEVEL% EQU 0 (
    echo    ✓ VITE_CLOUDINARY_CLOUD_NAME found
) else (
    echo    ✗ VITE_CLOUDINARY_CLOUD_NAME missing
)

findstr /M "VITE_CLOUDINARY_UPLOAD_PRESET" .env >nul
if %ERRORLEVEL% EQU 0 (
    echo    ✓ VITE_CLOUDINARY_UPLOAD_PRESET found
) else (
    echo    ✗ VITE_CLOUDINARY_UPLOAD_PRESET missing
)

echo.
echo 2. Checking component files...
if exist "src\components\ui\FileUpload.jsx" (
    echo    ✓ FileUpload.jsx exists
) else (
    echo    ✗ FileUpload.jsx missing
)

if exist "src\pages\admin\MediaManagementEnhanced.jsx" (
    echo    ✓ MediaManagementEnhanced.jsx exists
) else (
    echo    ✗ MediaManagementEnhanced.jsx missing
)

echo.
echo 3. Checking utility files...
findstr /M "uploadToCloudinary" "src\utils\cloudinary.js" >nul
if %ERRORLEVEL% EQU 0 (
    echo    ✓ uploadToCloudinary function found
) else (
    echo    ✗ uploadToCloudinary function missing
)

echo.
echo 4. Checking server files...
if exist "server\index.js" (
    echo    ✓ server/index.js exists
) else (
    echo    ✗ server/index.js missing
)

echo.
echo 5. Checking documentation...
if exist "00_START_HERE.md" (
    echo    ✓ 00_START_HERE.md found
) else (
    echo    ✗ 00_START_HERE.md missing
)

if exist "CODE_EXAMPLES.md" (
    echo    ✓ CODE_EXAMPLES.md found
) else (
    echo    ✗ CODE_EXAMPLES.md missing
)

if exist "UPLOAD_TESTING.md" (
    echo    ✓ UPLOAD_TESTING.md found
) else (
    echo    ✗ UPLOAD_TESTING.md missing
)

echo.
echo ✅ Verification complete!
echo.
echo Next steps:
echo 1. Run: npm run dev
echo 2. In another terminal: node server/index.js
echo 3. Go to: http://localhost:5173/test-upload
echo 4. Try uploading a file
echo.
pause
