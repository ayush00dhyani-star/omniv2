async function test() {
  const keys = Object.keys(process.env).filter(k => k.includes('GEMINI') || k.includes('API') || k.includes('KEY'));
  console.log(keys.map(k => `${k}=${process.env[k] ? process.env[k].substring(0, 5) + '...' : 'undefined'}`));
}
test();
