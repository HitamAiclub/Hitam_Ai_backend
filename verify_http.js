
const http = require('http');

function post(path, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path: path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

function get(path) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path: path,
            method: 'GET'
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.end();
    });
}

async function verify() {
    const folderName = 'verify_http_' + Date.now();
    console.log('Creating id:', folderName);

    await post('/api/cloudinary/create-folder', {
        folderPath: 'hitam_ai',
        folderName: folderName
    });

    const folders = await get('/api/cloudinary/folders?parent=hitam_ai');
    console.log('Subfolders found:', folders.map(f => f.name));

    const found = folders.find(f => f.name === folderName);
    console.log('Found:', !!found);
}

verify();
