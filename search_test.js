
// global fetch
async function testSearch() {
    try {
        const response = await fetch('http://localhost:5000/api/cloudinary/files?folder=hitam_ai/node_test_folder');
        const data = await response.json();
        console.log('Files in new folder:', data);
    } catch (e) {
        console.error('Error:', e);
    }
}

testSearch();
