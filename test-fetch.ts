async function test() {
  const res = await fetch('http://localhost:3000/api/health');
  const json = await res.json();
  console.log(json);
}
test();
