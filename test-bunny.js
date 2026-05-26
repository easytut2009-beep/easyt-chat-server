const https = require('https');

function downloadFromBunny(zone, password, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'storage.bunnycdn.com',
      path: `/${zone}/${path}`,
      method: 'GET',
      headers: { 'AccessKey': password }
    };
    const req = https.request(options, (res) => {
      console.log('Download Status:', res.statusCode);
      if (res.statusCode !== 200) return reject(new Error(`Download ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || 'application/octet-stream'
      }));
      res.on('error', reject);
    });
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function uploadToBunny(zone, password, path, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'storage.bunnycdn.com',
      path: `/${zone}/${path}`,
      method: 'PUT',
      headers: {
        'AccessKey': password,
        'Content-Type': contentType,
        'Content-Length': buffer.length
      }
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        console.log('Upload Status:', res.statusCode, b);
        if (res.statusCode === 201 || res.statusCode === 200) resolve();
        else reject(new Error(`Upload ${res.statusCode}: ${b}`));
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

async function main() {
  try {
    console.log('Testing download...');
    const { buffer, contentType } = await downloadFromBunny(
      'easyt-images-storage',
      '63cbe42f-467f-4434-85577319466a-03cb-4d85',
      'attachments/606.pdf'
    );
    console.log('Downloaded:', buffer.length, 'bytes, type:', contentType);

    console.log('Testing upload...');
    await uploadToBunny(
      'easyt-files-storage',
      '9e58dca2-404a-4e96-88fda6910173-461a-4929',
      'test/606-test.pdf',
      buffer,
      contentType
    );
    console.log('Upload SUCCESS!');
  } catch (err) {
    console.error('ERROR:', err.message);
  }
}

main();
