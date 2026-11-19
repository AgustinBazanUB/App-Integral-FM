import WebSocket from 'ws';

const targetId = process.argv[2] || '6DA9F5DB81ACF2D7602E1778ABBF9F16';
const expr = process.argv[3] || 'location.href';

const ws = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${targetId}`);

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    }
  }));
});

ws.on('message', data => {
  const res = JSON.parse(data.toString());
  console.log(JSON.stringify(res.result?.result?.value ?? res, null, 2));
  process.exit(0);
});

ws.on('error', err => {
  console.error(err);
  process.exit(1);
});
setTimeout(() => {
  console.error('Timeout');
  process.exit(1);
}, 10000);
