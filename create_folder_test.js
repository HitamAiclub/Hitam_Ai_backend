
// using global fetch

async function testCreate() {
    try {
        const response = await fetch('http://localhost:5000/api/cloudinary/create-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folderPath: 'hitam_ai',
                folderName: 'node_test_folder'
            })
        });
        const data = await response.json();
        console.log('Response:', data);
    } catch (e) {
        console.error('Error:', e);
    }
}

testCreate();
