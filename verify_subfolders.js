
// global fetch
async function verify() {
    const folderName = 'verify_' + Date.now();
    console.log('Creating folder:', folderName);

    // 1. Create
    await fetch('http://localhost:5000/api/cloudinary/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            folderPath: 'hitam_ai',
            folderName: folderName
        })
    });

    // 2. List subfolders of hitam_ai
    const res = await fetch('http://localhost:5000/api/cloudinary/folders?parent=hitam_ai');
    const folders = await res.json();
    console.log('Subfolders:', folders.map(f => f.name));

    const found = folders.find(f => f.name === folderName);
    console.log('Found new folder?', !!found);
}

verify();
