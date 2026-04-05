const keys = Object.keys(process.env).filter(k => k.includes('GEMINI') || k.includes('API'));
for (const k of keys) {
  const val = process.env[k] || '';
  console.log(`${k}: ${val.substring(0, 10)}... (len: ${val.length})`);
}
