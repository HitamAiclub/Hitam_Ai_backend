
// global fetch
async function testGet() {
    try {
        const response = await fetch('http://localhost:5000/api/cloudinary/folders?parent=hitam_ai');
        const data = await response.json();
        console.log('Folders in hitam_ai:', data.map(f => f.name));
    } catch (e) {
        console.error('Error:', e);
    }
}

testGet();
