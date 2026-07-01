# 2TOCH Backend — démarrage

## 1. Reality Defender (deepfake audio)
- Créer un compte gratuit : https://realitydefender.com/api (50 scans/mois)
- Copier la clé API dans `.env` → `REALITY_DEFENDER_API_KEY`

## 2. Lancer le serveur Node (proxy API)
```
cd backend
cp .env.example .env   # puis remplir la clé
npm install
npm start               # → http://localhost:4000
```

## 3. Lancer le micro-service Python (émotion visage, DeepFace)
```
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python face_emotion_service.py   # → http://localhost:5001
```

## 4. Tester
```
curl -X POST http://localhost:4000/api/ai/deepfake-check -F "audio=@test.wav"
curl -X POST http://localhost:4000/api/ai/face-emotion   -F "image=@test.jpg"
```

Sans clé Reality Defender → réponse 503 explicite (pas de crash).
Sans micro-service Python lancé → réponse 502 explicite (pas de crash).

## Front-end (app.html)
Aux endroits marqués `// TODO[API]` dans app.html, remplacer l'appel mocké par :
```js
const form = new FormData();
form.append('audio', audioBlob);
fetch('http://localhost:4000/api/ai/deepfake-check', { method: 'POST', body: form })
  .then(r => r.json())
  .then(data => { /* data.deepfakeScore, data.isDeepfake */ });
```
