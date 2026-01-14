
const http = require('http');

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
    console.log('Checking files...');
    const files = await get('/api/cloudinary/files?folder=hitam_ai');
    console.log('Files found:', files.map ? files.map(f => f.name) : files);
}

verify();
