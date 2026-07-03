const { WebSocketServer } = require('ws');

function attachSignalingServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Map();

  function send(ws, obj) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  const RELAYED_TYPES = ['call-invite', 'call-accept', 'call-decline', 'offer', 'answer', 'ice-candidate', 'hangup'];

  wss.on('connection', (ws) => {
    ws.uid = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      if (msg.type === 'register') {
        ws.uid = msg.uid;
        clients.set(msg.uid, ws);
        send(ws, { type: 'registered', uid: msg.uid });
        return;
      }

      if (!msg.to || !RELAYED_TYPES.includes(msg.type)) return;

      const target = clients.get(msg.to);
      if (!target) {
        if (msg.type === 'call-invite') send(ws, { type: 'call-unavailable', to: msg.to });
        return;
      }
      send(target, Object.assign({}, msg, { from: ws.uid }));
    });

    ws.on('close', () => {
      if (ws.uid && clients.get(ws.uid) === ws) clients.delete(ws.uid);
    });
  });

  return wss;
}

module.exports = { attachSignalingServer };
