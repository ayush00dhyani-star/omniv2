async function fetchTrending() {
  try {
    const res = await fetch('https://clawhub.com/api/trpc/skills.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22limit%22%3A10%2C%22sort%22%3A%22trending%22%7D%7D%7D');
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}
fetchTrending();
