# ════════════════════════════════════════════════════════════
# 2TOCH — Micro-service émotion du visage (DeepFace, gratuit, open-source)
# Lancer : pip install -r requirements.txt && python face_emotion_service.py
# ════════════════════════════════════════════════════════════
from flask import Flask, request, jsonify
from deepface import DeepFace
import numpy as np
import cv2

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({"error": {"code": "NO_FILE", "message": "Champ 'image' manquant"}}), 400

    file = request.files['image']
    npimg = np.frombuffer(file.read(), np.uint8)
    img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)

    if img is None:
        return jsonify({"error": {"code": "BAD_IMAGE", "message": "Image illisible"}}), 400

    try:
        result = DeepFace.analyze(img_path=img, actions=['emotion'], enforce_detection=False)
        # DeepFace renvoie une liste si plusieurs visages détectés
        face = result[0] if isinstance(result, list) else result

        dominant = face['dominant_emotion']
        scores = face['emotion']  # ex: {angry: 1.2, happy: 80.3, sad: 3.1, ...}

        # Conversion en score "stabilité/sincérité" simple (0-100) — à ajuster
        # selon votre logique métier réelle. Ici : neutral+happy = positif.
        face_score = round(scores.get('happy', 0) + scores.get('neutral', 0), 2)

        return jsonify({
            "dominant_emotion": dominant,
            "scores": scores,
            "faceScore": face_score
        })
    except Exception as e:
        return jsonify({"error": {"code": "DEEPFACE_ERROR", "message": str(e)}}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
