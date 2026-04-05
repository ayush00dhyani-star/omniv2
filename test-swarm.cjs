const http = require('http');

const data = JSON.stringify({
  goal: 'Launch a new SaaS product in 30 days'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/swarm/breakdown',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  console.log(`statusCode: ${res.statusCode}`);
  let body = '';
  res.on('data', d => {
    body += d;
  });
  res.on('end', () => {
    console.log(body);
  });
});

req.on('error', error => {
  console.error(error);
});

req.write(data);
req.end();
